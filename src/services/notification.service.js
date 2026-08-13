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
    case 'gift_received':
    case 'level_up':
    case 'milestone_reached':
      return 'earningsUpdates';
    case 'payment_received':
      return 'paymentNotifications';
    case 'missed_call':
      return 'incomingCallAlerts';
    case 'new_message':
    case 'admin_blocked':
    case 'admin_suspended':
    case 'admin_warned':
    case 'admin_activated':
      return null; // always notify
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
    if (data?.callId) {
      query['data.callId'] = data.callId;
    }
    if (data?.amountInr != null) {
      query['data.amountInr'] = data.amountInr;
    }
    if (data?.level != null) {
      query['data.level'] = data.level;
    }
    if (data?.milestone != null) {
      query['data.milestone'] = data.milestone;
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

function formatInr(amount) {
  return `₹${Math.round(Number(amount) || 0).toLocaleString('en-IN')}`;
}

async function notifyReceiverEarnings({
  receiverId,
  amountInr,
  source = 'video_call',
  callId = null,
  conversationId = null,
}) {
  const amount = Number(amountInr) || 0;
  if (!receiverId || amount <= 0) {
    return null;
  }
  const isChat = source === 'chat';
  return createForReceiver({
    receiverId,
    type: 'earnings_credit',
    title: isChat ? 'Chat earnings credited' : 'Call earnings credited',
    body: `${formatInr(amount)} added to your wallet from ${
      isChat ? 'chat' : 'your video call'
    }.`,
    data: {
      amountInr: amount,
      source,
      callId,
      conversationId,
    },
    dedupeMinutes: isChat ? 5 : 0,
  });
}

async function notifyReceiverGift({
  receiverId,
  giftName,
  emoji,
  amountInr,
  coins,
  callId,
  callerName,
}) {
  if (!receiverId) {
    return null;
  }
  const amount = Number(amountInr) || 0;
  const label = `${emoji || '🎁'} ${giftName || 'Gift'}`.trim();
  return createForReceiver({
    receiverId,
    type: 'gift_received',
    title: `You received ${label}`,
    body:
      amount > 0
        ? `${callerName || 'A caller'} sent you a gift. ${formatInr(
            amount,
          )} added to your wallet.`
        : `${callerName || 'A caller'} sent you a gift on your video call.`,
    data: {
      giftName,
      emoji,
      amountInr: amount,
      coins: Number(coins) || 0,
      callId,
      callerName,
    },
  });
}

async function notifyReceiverMissedCall({
  receiverId,
  callerName,
  callId,
  callerId,
}) {
  if (!receiverId) {
    return null;
  }
  const name = callerName || 'A caller';
  return createForReceiver({
    receiverId,
    type: 'missed_call',
    title: 'Missed video call',
    body: `${name} tried to reach you. Go online to take the next one.`,
    data: {callId, callerId, callerName: name},
    dedupeMinutes: 2,
  });
}

async function notifyReceiverAdminAction({
  receiverId,
  action,
  reason = '',
}) {
  if (!receiverId || !action) {
    return null;
  }
  const map = {
    block: {
      type: 'admin_blocked',
      title: 'Account blocked',
      body:
        reason ||
        'Your account was blocked by admin due to a policy issue. Contact support for help.',
    },
    suspend: {
      type: 'admin_suspended',
      title: 'Account suspended',
      body:
        reason ||
        'Your account was suspended by admin. You cannot go online until reactivated.',
    },
    warn: {
      type: 'admin_warned',
      title: 'Account warning',
      body:
        reason ||
        'You received a warning from admin. Please follow Callkaro community guidelines.',
    },
    activate: {
      type: 'admin_activated',
      title: 'Account reactivated',
      body: 'Your account is active again. You can go online and accept calls.',
    },
  };
  const copy = map[action];
  if (!copy) {
    return null;
  }
  return createForReceiver({
    receiverId,
    type: copy.type,
    title: copy.title,
    body: copy.body,
    data: {action, reason},
  });
}

async function notifyReceiverLevelUp({receiverId, level}) {
  const next = Number(level) || 0;
  if (!receiverId || next < 2) {
    return null;
  }
  return createForReceiver({
    receiverId,
    type: 'level_up',
    title: `Level ${next} unlocked!`,
    body: `Congratulations — you reached Level ${next}. Keep taking calls to earn more.`,
    data: {level: next},
    dedupeMinutes: 60,
  });
}

const CALL_MILESTONES = [10, 25, 50, 100, 250, 500];

async function notifyReceiverCallMilestone({receiverId, totalCalls}) {
  const count = Number(totalCalls) || 0;
  if (!receiverId || !CALL_MILESTONES.includes(count)) {
    return null;
  }
  return createForReceiver({
    receiverId,
    type: 'milestone_reached',
    title: `${count} calls milestone!`,
    body: `Amazing — you’ve completed ${count} video calls on Callkaro.`,
    data: {milestone: count, totalCalls: count},
    dedupeMinutes: 1440,
  });
}

module.exports = {
  createForCaller,
  createForReceiver,
  listForCaller,
  listForReceiver,
  markRead,
  markAllRead,
  notifyFollowersReceiverOnline,
  notifyReceiverEarnings,
  notifyReceiverGift,
  notifyReceiverMissedCall,
  notifyReceiverAdminAction,
  notifyReceiverLevelUp,
  notifyReceiverCallMilestone,
  publicNotification,
};
