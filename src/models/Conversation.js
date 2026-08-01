const mongoose = require('mongoose');
const crypto = require('crypto');

const conversationSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `CNV-${crypto.randomUUID()}`,
    },
    callerId: {type: String, required: true, index: true},
    receiverId: {type: String, required: true, index: true},
    lastMessage: {type: String, default: ''},
    lastMessageAt: {type: Date, default: null},
    callerUnread: {type: Number, default: 0},
    receiverUnread: {type: Number, default: 0},
    /** Soft clear — messages before this time are hidden for the viewer. */
    callerClearedAt: {type: Date, default: null},
    receiverClearedAt: {type: Date, default: null},
  },
  {timestamps: true, collection: 'conversations'},
);

conversationSchema.index({callerId: 1, receiverId: 1}, {unique: true});

module.exports = mongoose.model('Conversation', conversationSchema);
