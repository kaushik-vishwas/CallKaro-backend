const chatService = require('../services/chat.service');
const {ok, fail} = require('../utils/response');

function statusOf(error) {
  return error.statusCode || 500;
}

async function listConversations(req, res) {
  try {
    const conversations = await chatService.listConversations(req.auth);
    return ok(res, {conversations}, 'Conversations loaded');
  } catch (error) {
    return fail(res, error.message || 'Failed to load conversations.', statusOf(error));
  }
}

async function openConversation(req, res) {
  try {
    const {receiverId, callerId} = req.body || {};
    let conversation;
    if (req.auth.role === 'caller') {
      conversation = await chatService.openWithReceiver(req.auth, receiverId);
    } else if (callerId) {
      conversation = await chatService.openWithCaller(req.auth, callerId);
    } else {
      return fail(res, 'receiverId or callerId is required.');
    }
    return ok(res, {conversation}, 'Conversation ready');
  } catch (error) {
    return fail(res, error.message || 'Failed to open conversation.', statusOf(error));
  }
}

async function getConversation(req, res) {
  try {
    const conversation = await chatService.getConversation(
      req.auth,
      req.params.id,
    );
    return ok(res, {conversation}, 'Conversation loaded');
  } catch (error) {
    return fail(res, error.message || 'Failed to load conversation.', statusOf(error));
  }
}

async function listMessages(req, res) {
  try {
    const messages = await chatService.listMessages(req.auth, req.params.id, {
      limit: req.query.limit,
      before: req.query.before,
    });
    return ok(res, {messages}, 'Messages loaded');
  } catch (error) {
    return fail(res, error.message || 'Failed to load messages.', statusOf(error));
  }
}

async function sendMessage(req, res) {
  try {
    const result = await chatService.sendMessage(
      req.auth,
      req.params.id,
      req.body?.text,
    );
    const io = req.app.get('io');
    if (io) {
      chatService.broadcastMessage(io, result);
    }
    return ok(
      res,
      {
        message: result.message,
        conversation: result.conversation,
      },
      'Message sent',
      201,
    );
  } catch (error) {
    return fail(res, error.message || 'Failed to send message.', statusOf(error));
  }
}

async function markRead(req, res) {
  try {
    const conversation = await chatService.markRead(req.auth, req.params.id);
    const io = req.app.get('io');
    if (io) {
      chatService.broadcastRead(io, req.auth, conversation);
    }
    return ok(res, {conversation}, 'Marked as read');
  } catch (error) {
    return fail(res, error.message || 'Failed to mark as read.', statusOf(error));
  }
}

async function getBlockState(req, res) {
  try {
    const chatModeration = require('../services/chatModeration.service');
    const data = await chatModeration.getBlockState(req.auth, req.params.id);
    return ok(res, data, 'Block state loaded');
  } catch (error) {
    return fail(res, error.message || 'Failed to load block state.', statusOf(error));
  }
}

async function blockUser(req, res) {
  try {
    const chatModeration = require('../services/chatModeration.service');
    const data = await chatModeration.blockUser(req.auth, req.params.id);
    return ok(res, data, 'User blocked');
  } catch (error) {
    return fail(res, error.message || 'Failed to block user.', statusOf(error));
  }
}

async function unblockUser(req, res) {
  try {
    const chatModeration = require('../services/chatModeration.service');
    const data = await chatModeration.unblockUser(req.auth, req.params.id);
    return ok(res, data, 'User unblocked');
  } catch (error) {
    return fail(res, error.message || 'Failed to unblock user.', statusOf(error));
  }
}

async function reportUser(req, res) {
  try {
    const chatModeration = require('../services/chatModeration.service');
    const data = await chatModeration.reportUser(req.auth, {
      conversationId: req.params.id,
      reason: req.body?.reason,
      details: req.body?.details,
    });
    return ok(res, {report: data}, 'Report submitted', 201);
  } catch (error) {
    return fail(res, error.message || 'Failed to submit report.', statusOf(error));
  }
}

async function clearChat(req, res) {
  try {
    const chatModeration = require('../services/chatModeration.service');
    const data = await chatModeration.clearChat(req.auth, req.params.id);
    return ok(res, data, 'Chat cleared');
  } catch (error) {
    return fail(res, error.message || 'Failed to clear chat.', statusOf(error));
  }
}

module.exports = {
  listConversations,
  openConversation,
  getConversation,
  listMessages,
  sendMessage,
  markRead,
  getBlockState,
  blockUser,
  unblockUser,
  reportUser,
  clearChat,
};
