const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Waiting callers who requested a callback while the receiver was offline or busy.
 * VIP callers are sorted first when listing the queue.
 */
const callQueueSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `Q-${crypto.randomUUID()}`,
    },
    callerId: {type: String, required: true, index: true},
    receiverId: {type: String, required: true, index: true},
    reason: {
      type: String,
      enum: ['offline', 'busy'],
      required: true,
    },
    status: {
      type: String,
      enum: ['waiting', 'calling', 'cancelled', 'fulfilled'],
      default: 'waiting',
      index: true,
    },
    isVip: {type: Boolean, default: false, index: true},
    /** Active callback call id while status === 'calling'. */
    callId: {type: String, default: null, index: true},
    callerSnapshot: {
      name: {type: String, default: 'Caller'},
      avatarUrl: {type: String, default: ''},
      level: {type: Number, default: 1},
    },
  },
  {timestamps: true, collection: 'call_queue'},
);

callQueueSchema.index({receiverId: 1, status: 1, isVip: -1, createdAt: 1});
callQueueSchema.index({callerId: 1, receiverId: 1, status: 1});

module.exports = mongoose.model('CallQueue', callQueueSchema);
