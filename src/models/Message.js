const mongoose = require('mongoose');
const crypto = require('crypto');

const messageSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `MSG-${crypto.randomUUID()}`,
    },
    conversationId: {type: String, required: true, index: true},
    senderRole: {
      type: String,
      enum: ['caller', 'receiver'],
      required: true,
    },
    senderId: {type: String, required: true, index: true},
    text: {type: String, required: true, trim: true, maxlength: 2000},
    readAt: {type: Date, default: null},
  },
  {timestamps: true, collection: 'messages'},
);

messageSchema.index({conversationId: 1, createdAt: -1});

module.exports = mongoose.model('Message', messageSchema);
