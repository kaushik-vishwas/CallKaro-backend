const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Caller = require('../models/Caller');
const Receiver = require('../models/Receiver');
const storageService = require('./storage.service');

function formatTime(date) {
  if (!date) {
    return '';
  }
  return new Date(date).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function publicMessage(doc, viewerRole) {
  return {
    id: doc.id,
    conversationId: doc.conversationId,
    kind: 'text',
    text: doc.text,
    sentByMe: doc.senderRole === viewerRole,
    fromMe: doc.senderRole === viewerRole,
    time: formatTime(doc.createdAt),
    isRead: Boolean(doc.readAt),
    senderRole: doc.senderRole,
    createdAt: doc.createdAt,
    coinsCharged: Number(doc.coinsCharged || 0),
    earningsInr: Number(doc.earningsInr || 0),
  };
}

function wireMessage(doc) {
  return {
    id: doc.id,
    conversationId: doc.conversationId,
    kind: 'text',
    text: doc.text,
    time: formatTime(doc.createdAt),
    isRead: Boolean(doc.readAt),
    senderRole: doc.senderRole,
    createdAt: doc.createdAt,
    coinsCharged: Number(doc.coinsCharged || 0),
    earningsInr: Number(doc.earningsInr || 0),
  };
}

async function assertParticipant(conversation, auth) {
  if (auth.role === 'caller' && conversation.callerId === auth.userId) {
    return 'caller';
  }
  if (auth.role === 'receiver' && conversation.receiverId === auth.receiverId) {
    return 'receiver';
  }
  const err = new Error('Not allowed to access this chat.');
  err.statusCode = 403;
  throw err;
}

async function getOrCreateConversation({callerId, receiverId}) {
  const receiver = await Receiver.findOne({
    id: receiverId,
    status: 'active',
  }).lean();
  if (!receiver) {
    const err = new Error('Receiver not found.');
    err.statusCode = 404;
    throw err;
  }
  const caller = await Caller.findOne({id: callerId}).lean();
  if (!caller) {
    const err = new Error('Caller not found.');
    err.statusCode = 404;
    throw err;
  }

  let conversation = await Conversation.findOne({callerId, receiverId});
  if (!conversation) {
    conversation = await Conversation.create({callerId, receiverId});
  }
  return conversation;
}

async function mapConversationForViewer(conversation, viewerRole) {
  const otherId =
    viewerRole === 'caller' ? conversation.receiverId : conversation.callerId;
  let name = 'User';
  let age = 0;
  let avatarUrl = '';
  let online = false;

  if (viewerRole === 'caller') {
    const receiver = await Receiver.findOne({id: otherId})
      .select('name age photos isOnline')
      .lean();
    if (receiver) {
      name = receiver.name;
      age = Number(receiver.age) || 0;
      const rawPhotos = Array.isArray(receiver.photos) ? receiver.photos : [];
      // Prefer first photo immediately; signing is best-effort and must not block chat.
      avatarUrl = rawPhotos[0] || '';
      try {
        const photos = await storageService.mapAccessUrls(rawPhotos.slice(0, 1));
        if (photos[0]) {
          avatarUrl = photos[0];
        }
      } catch {
        /* keep raw URL */
      }
      online = Boolean(receiver.isOnline);
    }
  } else {
    const caller = await Caller.findOne({id: otherId})
      .select('name avatarUrl')
      .lean();
    if (caller) {
      name = caller.name;
      avatarUrl = caller.avatarUrl || '';
      try {
        if (avatarUrl) {
          avatarUrl = await storageService.toAccessUrl(avatarUrl);
        }
      } catch {
        /* keep raw */
      }
    }
  }

  const unread =
    viewerRole === 'caller'
      ? conversation.callerUnread
      : conversation.receiverUnread;

  return {
    id: conversation.id,
    callerId: conversation.callerId,
    receiverId: conversation.receiverId,
    name,
    age,
    avatarUrl,
    lastMessage: conversation.lastMessage || '',
    time: formatTime(conversation.lastMessageAt || conversation.updatedAt),
    lastMessageAt: conversation.lastMessageAt || conversation.updatedAt,
    unreadCount: Math.max(0, Number(unread) || 0),
    unread: Math.max(0, Number(unread) || 0),
    status: online ? 'online' : 'offline',
    online,
  };
}

async function attachBlockState(mapped, conversation, viewerRole) {
  const ChatBlock = require('../models/ChatBlock');
  const viewerId =
    viewerRole === 'caller' ? conversation.callerId : conversation.receiverId;
  const peer =
    viewerRole === 'caller'
      ? {role: 'receiver', id: conversation.receiverId}
      : {role: 'caller', id: conversation.callerId};
  const iBlocked = await ChatBlock.findOne({
    blockerRole: viewerRole,
    blockerId: viewerId,
    blockedRole: peer.role,
    blockedId: peer.id,
  }).lean();
  return {
    ...mapped,
    blockedByMe: Boolean(iBlocked),
  };
}

async function listConversations(auth) {
  const filter =
    auth.role === 'caller'
      ? {callerId: auth.userId}
      : {receiverId: auth.receiverId};
  const viewerRole = auth.role === 'caller' ? 'caller' : 'receiver';
  const rows = await Conversation.find(filter)
    .sort({lastMessageAt: -1, updatedAt: -1})
    .lean();
  return Promise.all(
    rows.map(async row => {
      const mapped = await mapConversationForViewer(row, viewerRole);
      return attachBlockState(mapped, row, viewerRole);
    }),
  );
}

async function getConversation(auth, conversationId) {
  const conversation = await Conversation.findOne({id: conversationId});
  if (!conversation) {
    const err = new Error('Conversation not found.');
    err.statusCode = 404;
    throw err;
  }
  const viewerRole = await assertParticipant(conversation, auth);
  const mapped = await mapConversationForViewer(
    conversation.toObject(),
    viewerRole,
  );
  return attachBlockState(mapped, conversation.toObject(), viewerRole);
}

async function listMessages(auth, conversationId, {limit = 50, before} = {}) {
  const conversation = await Conversation.findOne({id: conversationId});
  if (!conversation) {
    const err = new Error('Conversation not found.');
    err.statusCode = 404;
    throw err;
  }
  const viewerRole = await assertParticipant(conversation, auth);
  const query = {conversationId};
  const clearedAt =
    viewerRole === 'caller'
      ? conversation.callerClearedAt
      : conversation.receiverClearedAt;
  if (clearedAt || before) {
    query.createdAt = {};
    if (clearedAt) {
      query.createdAt.$gt = new Date(clearedAt);
    }
    if (before) {
      query.createdAt.$lt = new Date(before);
    }
  }
  const rows = await Message.find(query)
    .sort({createdAt: -1})
    .limit(Math.min(100, Math.max(1, Number(limit) || 50)))
    .lean();
  return rows.reverse().map(row => publicMessage(row, viewerRole));
}

async function sendMessage(auth, conversationId, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    const err = new Error('Message text is required.');
    err.statusCode = 400;
    throw err;
  }
  if (trimmed.length > 2000) {
    const err = new Error('Message is too long.');
    err.statusCode = 400;
    throw err;
  }

  const conversation = await Conversation.findOne({id: conversationId});
  if (!conversation) {
    const err = new Error('Conversation not found.');
    err.statusCode = 404;
    throw err;
  }
  const viewerRole = await assertParticipant(conversation, auth);

  const {assertNotBlocked} = require('./chatModeration.service');
  await assertNotBlocked(conversation, auth);

  const senderId =
    viewerRole === 'caller' ? auth.userId : auth.receiverId;

  let coinsCharged = 0;
  let earningsInr = 0;
  let callerBalance = null;

  // Non-VIP callers pay per message; VIP chat is free. Receiver messages are free.
  if (viewerRole === 'caller') {
    const {config} = require('../config');
    const cost = Math.max(0, Number(config.coinsPerChatMessage) || 10);
    const caller = await Caller.findOne({id: auth.userId});
    if (!caller) {
      const err = new Error('Caller not found.');
      err.statusCode = 404;
      throw err;
    }

    const isVip = Boolean(
      caller.vipExpiresAt &&
        new Date(caller.vipExpiresAt).getTime() > Date.now(),
    );

    if (!isVip && cost > 0) {
      const wallet = Number(caller.coins || 0);
      if (wallet < cost) {
        const err = new Error(
          'Not enough coins to send a message. Recharge or upgrade to VIP for free chat.',
        );
        err.statusCode = 402;
        throw err;
      }

      caller.coins = wallet - cost;
      await caller.save();
      coinsCharged = cost;

      const earningsService = require('./earnings.service');
      const credit = await earningsService.creditReceiverFromCoins({
        receiverId: conversation.receiverId,
        callerId: auth.userId,
        coins: cost,
        source: 'chat',
        referenceId: conversation.id,
        meta: {conversationId: conversation.id},
      });
      earningsInr = credit.amountInr || 0;
    }

    callerBalance = {
      coins: Number(caller.coins || 0),
      rewardCoins: Number(caller.rewardCoins || 0),
      isVip,
    };
  }

  const message = await Message.create({
    conversationId,
    senderRole: viewerRole,
    senderId,
    text: trimmed,
    coinsCharged,
    earningsInr,
  });

  conversation.lastMessage = trimmed;
  conversation.lastMessageAt = message.createdAt;
  if (viewerRole === 'caller') {
    conversation.receiverUnread = Math.max(0, conversation.receiverUnread) + 1;
  } else {
    conversation.callerUnread = Math.max(0, conversation.callerUnread) + 1;
  }
  await conversation.save();

  const plain = message.toObject();
  const convPlain = conversation.toObject();
  return {
    message: publicMessage(plain, viewerRole),
    wireMessage: wireMessage(plain),
    conversation: await mapConversationForViewer(convPlain, viewerRole),
    conversationDoc: convPlain,
    viewerRole,
    callerBalance,
    coinsCharged,
    earningsInr,
  };
}

async function markRead(auth, conversationId) {
  const conversation = await Conversation.findOne({id: conversationId});
  if (!conversation) {
    const err = new Error('Conversation not found.');
    err.statusCode = 404;
    throw err;
  }
  const viewerRole = await assertParticipant(conversation, auth);
  const otherRole = viewerRole === 'caller' ? 'receiver' : 'caller';

  await Message.updateMany(
    {
      conversationId,
      senderRole: otherRole,
      readAt: null,
    },
    {$set: {readAt: new Date()}},
  );

  if (viewerRole === 'caller') {
    conversation.callerUnread = 0;
  } else {
    conversation.receiverUnread = 0;
  }
  await conversation.save();

  return mapConversationForViewer(conversation.toObject(), viewerRole);
}

async function openWithReceiver(auth, receiverId) {
  if (auth.role !== 'caller') {
    const err = new Error('Only callers can start chats with receivers.');
    err.statusCode = 403;
    throw err;
  }
  const conversation = await getOrCreateConversation({
    callerId: auth.userId,
    receiverId: String(receiverId || '').trim(),
  });
  return mapConversationForViewer(conversation.toObject(), 'caller');
}

async function openWithCaller(auth, callerId) {
  if (auth.role !== 'receiver') {
    const err = new Error('Only receivers can start chats with callers.');
    err.statusCode = 403;
    throw err;
  }
  const conversation = await getOrCreateConversation({
    callerId: String(callerId || '').trim(),
    receiverId: auth.receiverId,
  });
  return mapConversationForViewer(conversation.toObject(), 'receiver');
}

async function broadcastMessage(io, result, {clientId = null} = {}) {
  if (!io || !result) {
    return;
  }
  const {conversationDoc, wireMessage: payload, viewerRole} = result;
  const event = {
    ...payload,
    clientId,
  };

  // Personal rooms only — avoids double delivery when also joined to conversation
  io.to(`caller:${conversationDoc.callerId}`).emit('message:new', event);
  io.to(`receiver:${conversationDoc.receiverId}`).emit('message:new', event);

  const forCaller = await mapConversationForViewer(conversationDoc, 'caller');
  const forReceiver = await mapConversationForViewer(
    conversationDoc,
    'receiver',
  );
  io.to(`caller:${conversationDoc.callerId}`).emit(
    'conversation:updated',
    forCaller,
  );
  io.to(`receiver:${conversationDoc.receiverId}`).emit(
    'conversation:updated',
    forReceiver,
  );

  // Notify caller inbox when a receiver sends a message
  if (viewerRole === 'receiver') {
    const notificationService = require('./notification.service');
    const senderName = forCaller?.name || 'Receiver';
    notificationService
      .createForCaller({
        callerId: conversationDoc.callerId,
        type: 'new_message',
        title: `${senderName} sent you a message`,
        body: 'Tap to continue your conversation.',
        data: {
          conversationId: conversationDoc.id,
          receiverId: conversationDoc.receiverId,
          receiverName: senderName,
          avatarUrl: forCaller?.avatarUrl || '',
        },
        dedupeMinutes: 0,
      })
      .catch(() => undefined);
  }

  // Notify receiver inbox when a caller sends a message
  if (viewerRole === 'caller') {
    const notificationService = require('./notification.service');
    const preview =
      String(payload.text || '').slice(0, 80) || 'New message';
    const senderName = forReceiver?.name || 'Caller';
    notificationService
      .createForReceiver({
        receiverId: conversationDoc.receiverId,
        type: 'new_message',
        title: `Message from ${senderName}`,
        body: preview,
        data: {
          conversationId: conversationDoc.id,
          callerId: conversationDoc.callerId,
          callerName: senderName,
        },
        dedupeMinutes: 0,
      })
      .catch(() => undefined);
  }
}

function broadcastRead(io, auth, conversation) {
  if (!io || !conversation) {
    return;
  }
  const targetRoom =
    auth.role === 'caller'
      ? `receiver:${conversation.receiverId}`
      : `caller:${conversation.callerId}`;
  io.to(targetRoom).emit('conversation:read', {
    conversationId: conversation.id,
    readerRole: auth.role,
  });
  io.to(`conversation:${conversation.id}`).emit('conversation:read', {
    conversationId: conversation.id,
    readerRole: auth.role,
  });
}

module.exports = {
  listConversations,
  getConversation,
  listMessages,
  sendMessage,
  markRead,
  openWithReceiver,
  openWithCaller,
  publicMessage,
  mapConversationForViewer,
  assertParticipant,
  broadcastMessage,
  broadcastRead,
};
