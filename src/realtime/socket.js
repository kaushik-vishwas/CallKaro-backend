const jwt = require('jsonwebtoken');
const {Server} = require('socket.io');
const {config} = require('../config');
const chatService = require('../services/chat.service');
const Conversation = require('../models/Conversation');
const {
  setIo,
  markConnected,
  markDisconnected,
  touchPresence,
} = require('./io');

function parseAuth(socket) {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
    null;

  if (!token) {
    throw new Error('Unauthorized');
  }

  const payload = jwt.verify(token, config.jwtSecret);
  const role = payload.role || 'caller';

  if (role === 'receiver') {
    return {role: 'receiver', receiverId: payload.sub, email: payload.email};
  }
  if (role === 'caller') {
    return {role: 'caller', userId: payload.sub, email: payload.email};
  }
  throw new Error('Caller or receiver access required');
}

function personalRoom(auth) {
  return auth.role === 'caller'
    ? `caller:${auth.userId}`
    : `receiver:${auth.receiverId}`;
}

function roleRoom(auth) {
  return auth.role === 'receiver' ? 'role:receiver' : 'role:caller';
}

function authUserId(auth) {
  return auth.role === 'caller' ? auth.userId : auth.receiverId;
}

function attachChatSocket(httpServer, app) {
  const io = new Server(httpServer, {
    cors: {origin: '*', methods: ['GET', 'POST']},
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    pingInterval: 20000,
    pingTimeout: 15000,
  });

  app.set('io', io);
  setIo(io);

  io.use((socket, next) => {
    try {
      socket.auth = parseAuth(socket);
      return next();
    } catch (error) {
      return next(new Error(error.message || 'Unauthorized'));
    }
  });

  io.on('connection', socket => {
    const auth = socket.auth;
    const userId = authUserId(auth);
    void Promise.resolve(
      Promise.all([socket.join(personalRoom(auth)), socket.join(roleRoom(auth))]),
    ).then(() => {
      markConnected(auth.role, userId, socket.id);
      touchPresence(auth.role, userId);
      chatService.broadcastPresence(io, auth, true).catch(() => undefined);
    });

    /** Throttle peer rebroadcast so chat lists refresh even if a connect event was missed. */
    let lastPresenceBroadcastAt = 0;
    socket.on('presence:ping', () => {
      touchPresence(auth.role, userId);
      markConnected(auth.role, userId, socket.id);
      const now = Date.now();
      if (now - lastPresenceBroadcastAt >= 20_000) {
        lastPresenceBroadcastAt = now;
        chatService.broadcastPresence(io, auth, true).catch(() => undefined);
      }
    });

    socket.on('disconnect', reason => {
      const stillOnline = markDisconnected(auth.role, userId, socket.id);
      if (!stillOnline) {
        // Delay offline broadcast so brief reconnects don't flash Offline in chat.
        setTimeout(() => {
          const {
            isCallerConnected,
            isReceiverConnected,
          } = require('./io');
          const connected =
            auth.role === 'caller'
              ? isCallerConnected(userId)
              : isReceiverConnected(userId);
          if (!connected) {
            chatService
              .broadcastPresence(io, auth, false)
              .catch(() => undefined);
          }
        }, 4_000);
      }
      if (config.enableLogging || process.env.DEBUG_SOCKET === '1') {
        console.log(
          `[socket] disconnect ${auth.role}:${userId} (${reason}) stillOnline=${stillOnline}`,
        );
      }
    });

    socket.on('join:conversation', async (payload, ack) => {
      try {
        const conversationId = String(payload?.conversationId || '').trim();
        if (!conversationId) {
          throw new Error('conversationId is required');
        }
        const conversation = await Conversation.findOne({id: conversationId});
        if (!conversation) {
          throw new Error('Conversation not found');
        }
        await chatService.assertParticipant(conversation, auth);
        socket.join(`conversation:${conversationId}`);
        touchPresence(auth.role, userId);

        let peerOnline = true;
        if (auth.role === 'receiver') {
          const Receiver = require('../models/Receiver');
          const receiver = await Receiver.findOne({id: userId})
            .select('isOnline status')
            .lean();
          peerOnline =
            receiver?.status === 'active' && receiver?.isOnline === true;
        }

        const peerRoom =
          auth.role === 'caller'
            ? `receiver:${conversation.receiverId}`
            : `caller:${conversation.callerId}`;
        const presencePayload = {
          conversationId,
          userId,
          role: auth.role,
          receiverId:
            auth.role === 'receiver' ? userId : conversation.receiverId,
          online: peerOnline,
          status: peerOnline ? 'online' : 'offline',
        };
        io.to(peerRoom).emit('presence:update', presencePayload);
        io.to(`conversation:${conversationId}`).emit(
          'presence:update',
          presencePayload,
        );
        if (typeof ack === 'function') {
          ack({ok: true});
        }
      } catch (error) {
        if (typeof ack === 'function') {
          ack({ok: false, error: error.message});
        }
      }
    });

    socket.on('leave:conversation', payload => {
      const conversationId = String(payload?.conversationId || '').trim();
      if (conversationId) {
        socket.leave(`conversation:${conversationId}`);
      }
    });

    socket.on('message:send', async (payload, ack) => {
      try {
        const conversationId = String(payload?.conversationId || '').trim();
        const text = payload?.text;
        const clientId = payload?.clientId || null;
        const result = await chatService.sendMessage(auth, conversationId, text);
        chatService.broadcastMessage(io, result, {clientId});
        if (typeof ack === 'function') {
          ack({
            ok: true,
            clientId,
            message: result.message,
            conversation: result.conversation,
            coinsCharged: result.coinsCharged || 0,
            callerBalance: result.callerBalance || null,
          });
        }
      } catch (error) {
        if (typeof ack === 'function') {
          ack({ok: false, error: error.message || 'Send failed'});
        }
      }
    });

    socket.on('conversation:read', async (payload, ack) => {
      try {
        const conversationId = String(payload?.conversationId || '').trim();
        const conversation = await chatService.markRead(auth, conversationId);
        chatService.broadcastRead(io, auth, conversation);
        if (typeof ack === 'function') {
          ack({ok: true, conversation});
        }
      } catch (error) {
        if (typeof ack === 'function') {
          ack({ok: false, error: error.message});
        }
      }
    });

    socket.on('typing:update', async payload => {
      try {
        const conversationId = String(payload?.conversationId || '').trim();
        if (!conversationId) {
          return;
        }
        const conversation = await Conversation.findOne({id: conversationId});
        if (!conversation) {
          return;
        }
        await chatService.assertParticipant(conversation, auth);
        const isTyping = Boolean(payload?.isTyping);
        socket.to(`conversation:${conversationId}`).emit('typing:update', {
          conversationId,
          isTyping,
          role: auth.role,
          userId: auth.role === 'caller' ? auth.userId : auth.receiverId,
        });
      } catch {
        // Ignore typing errors — non-critical
      }
    });

    // Call signaling — REST remains source of truth; sockets for low-latency actions.
    const callService = require('../services/call.service');

    socket.on('call:accept', async (payload, ack) => {
      try {
        const call = await callService.acceptCall(
          auth,
          String(payload?.callId || ''),
        );
        if (typeof ack === 'function') {
          ack({ok: true, call});
        }
      } catch (error) {
        if (typeof ack === 'function') {
          ack({ok: false, error: error.message});
        }
      }
    });

    socket.on('call:reject', async (payload, ack) => {
      try {
        const call = await callService.rejectCall(
          auth,
          String(payload?.callId || ''),
        );
        if (typeof ack === 'function') {
          ack({ok: true, call});
        }
      } catch (error) {
        if (typeof ack === 'function') {
          ack({ok: false, error: error.message});
        }
      }
    });

    socket.on('call:end', async (payload, ack) => {
      try {
        const call = await callService.endCall(
          auth,
          String(payload?.callId || ''),
          payload?.reason,
        );
        if (typeof ack === 'function') {
          ack({ok: true, call});
        }
      } catch (error) {
        if (typeof ack === 'function') {
          ack({ok: false, error: error.message});
        }
      }
    });
  });

  return io;
}

module.exports = {attachChatSocket};
