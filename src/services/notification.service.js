const Notification = require('../models/Notification');
const {getIo} = require('../realtime/io');

function formatTime(date) {
  if (!date) {
    return '';
  }
  const d = new Date(date);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

function publicNotification(doc) {
  const row = doc.toObject ? doc.toObject() : doc;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: row.data || {},
    read: Boolean(row.readAt),
    time: formatTime(row.createdAt),
    createdAt: row.createdAt,
    audience: row.audience || (row.receiverId ? 'receiver' : 'caller'),
  };
}

async function createForCaller({
  callerId,
  type,
  title,
  body,
  data = {},
  dedupeMinutes = 0,
}) {
  if (!callerId || !type || !title || !body) {
    return null;
  }

  if (dedupeMinutes > 0) {
    const since = new Date(Date.now() - dedupeMinutes * 60 * 1000);
    const query = {
      callerId,
      audience: 'caller',
      type,
      createdAt: {$gte: since},
    };
    if (data?.receiverId) {
      query['data.receiverId'] = data.receiverId;
    }
    if (data?.conversationId) {
      query['data.conversationId'] = data.conversationId;
    }
    const existing = await Notification.findOne(query).lean();
    if (existing) {
      return publicNotification(existing);
    }
  }

  const doc = await Notification.create({
    callerId,
    receiverId: null,
    audience: 'caller',
    type,
    title,
    body,
    data,
  });
  const payload = publicNotification(doc);
  const io = getIo();
  if (io) {
    io.to(`caller:${callerId}`).emit('notification:new', payload);
  }
  return payload;
}

async function shouldNotifyReceiver(receiverId, preferenceKey) {
  if (!preferenceKey) {
    return true;
  }
  try {
    const Receiver = require('../models/Receiver');
    const receiver = await Receiver.findOne({id: receiverId})
      .select('notificationPreferences')
      .lean();
    const prefs = receiver?.notificationPreferences || {};
    if (typeof prefs[preferenceKey] === 'boolean') {
      return prefs[preferenceKey];
    }
  } catch {
    // default allow
  }
  return true;
}

function preferenceKeyForType(type) {
  switch (type) {
    case 'withdraw_submitted':
    case 'withdraw_under_review':
    case 'withdraw_success':
    case 'withdraw_failed':
      return 'withdrawalUpdates';
    case 'earnings_credit':
      return 'earningsUpdates';
    case 'payment_received':
      return 'paymentNotifications';
    case 'new_message':
      return null; // always notify for chat
    default:
      return null;
  }
}

async function createForReceiver({
  receiverId,
  type,
  title,
  body,
  data = {},
  dedupeMinutes = 0,
}) {
  if (!receiverId || !type || !title || !body) {
    return null;
  }

  const prefKey = preferenceKeyForType(type);
  const allowed = await shouldNotifyReceiver(receiverId, prefKey);
  if (!allowed) {
    return null;
  }

  if (dedupeMinutes > 0) {
    const since = new Date(Date.now() - dedupeMinutes * 60 * 1000);
    const query = {
      receiverId,
      audience: 'receiver',
      type,
      createdAt: {$gte: since},
    };
    if (data?.conversationId) {
      query['data.conversationId'] = data.conversationId;
    }
    if (data?.amountInr != null) {
      query['data.amountInr'] = data.amountInr;
    }
    const existing = await Notification.findOne(query).lean();
    if (existing) {
      return publicNotification(existing);
    }
  }

  const doc = await Notification.create({
    callerId: null,
    receiverId,
    audience: 'receiver',
    type,
    title,
    body,
    data,
  });
  const payload = publicNotification(doc);
  const io = getIo();
  if (io) {
    io.to(`receiver:${receiverId}`).emit('notification:new', payload);
  }
  return payload;
}

async function listForCaller(callerId, {limit = 50} = {}) {
  const rows = await Notification.find({callerId})
    .sort({createdAt: -1})
    .limit(Math.min(100, Math.max(1, Number(limit) || 50)))
    .lean();
  const unreadCount = await Notification.countDocuments({
    callerId,
    readAt: null,
  });
  return {
    notifications: rows.map(publicNotification),
    unreadCount,
  };
}

async function listForReceiver(receiverId, {limit = 50} = {}) {
  const rows = await Notification.find({receiverId})
    .sort({createdAt: -1})
    .limit(Math.min(100, Math.max(1, Number(limit) || 50)))
    .lean();
  const unreadCount = await Notification.countDocuments({
    receiverId,
    readAt: null,
  });
  return {
    notifications: rows.map(publicNotification),
    unreadCount,
  };
}

async function markRead(ownerId, notificationId, audience) {
  const filter =
    audience === 'receiver'
      ? {id: notificationId, receiverId: ownerId}
      : {id: notificationId, callerId: ownerId};

  const doc = await Notification.findOneAndUpdate(
    filter,
    {$set: {readAt: new Date()}},
    {new: true},
  );
  if (!doc) {
    const err = new Error('Notification not found.');
    err.statusCode = 404;
    throw err;
  }
  return publicNotification(doc);
}

async function markAllRead(ownerId, audience) {
  if (audience === 'receiver') {
    await Notification.updateMany(
      {receiverId: ownerId, readAt: null},
      {$set: {readAt: new Date()}},
    );
    return listForReceiver(ownerId);
  }
  await Notification.updateMany(
    {callerId: ownerId, readAt: null},
    {$set: {readAt: new Date()}},
  );
  return listForCaller(ownerId);
}

async function notifyFollowersReceiverOnline(receiver) {
  if (!receiver?.id || !receiver.isOnline) {
    return;
  }
  const Follow = require('../models/Follow');
  const follows = await Follow.find({receiverId: receiver.id})
    .select('callerId')
    .lean();
  if (!follows.length) {
    return;
  }
  const name = receiver.name || 'Your saved receiver';
  const avatarUrl =
    (Array.isArray(receiver.photos) && receiver.photos[0]) ||
    receiver.avatarUrl ||
    '';
  await Promise.all(
    follows.map(row =>
      createForCaller({
        callerId: row.callerId,
        type: 'receiver_online',
        title: `${name} is online now`,
        body: 'Start a video call before she gets busy.',
        data: {
          receiverId: receiver.id,
          receiverName: name,
          avatarUrl,
        },
        dedupeMinutes: 30,
      }),
    ),
  );
}

module.exports = {
  createForCaller,
  createForReceiver,
  listForCaller,
  listForReceiver,
  markRead,
  markAllRead,
  notifyFollowersReceiverOnline,
  publicNotification,
};
