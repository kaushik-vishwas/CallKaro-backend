const mongoose = require('mongoose');

const chatBlockSchema = new mongoose.Schema(
  {
    blockerRole: {
      type: String,
      enum: ['caller', 'receiver'],
      required: true,
      index: true,
    },
    blockerId: {type: String, required: true, index: true},
    blockedRole: {
      type: String,
      enum: ['caller', 'receiver'],
      required: true,
      index: true,
    },
    blockedId: {type: String, required: true, index: true},
    conversationId: {type: String, default: null, index: true},
  },
  {timestamps: true, collection: 'chat_blocks'},
);

chatBlockSchema.index(
  {blockerRole: 1, blockerId: 1, blockedRole: 1, blockedId: 1},
  {unique: true},
);

module.exports = mongoose.model('ChatBlock', chatBlockSchema);
