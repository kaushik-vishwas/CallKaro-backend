const mongoose = require('mongoose');
const crypto = require('crypto');

const CALL_STATUSES = [
  'ringing',
  'accepted',
  'connected',
  'ended',
  'rejected',
  'missed',
  'busy',
  'failed',
];

const END_REASONS = [
  'caller_hangup',
  'receiver_hangup',
  'rejected',
  'missed',
  'busy',
  'insufficient_coins',
  'timeout',
  'failed',
];

const callSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `CALL-${crypto.randomUUID()}`,
    },
    callerId: {type: String, required: true, index: true},
    receiverId: {type: String, required: true, index: true},
    status: {
      type: String,
      enum: CALL_STATUSES,
      default: 'ringing',
      index: true,
    },
    /** Media provider — 'mock' now; swap to 'getstream' later without flow changes. */
    provider: {
      type: String,
      enum: ['mock', 'getstream'],
      default: 'mock',
    },
    providerPayload: {type: mongoose.Schema.Types.Mixed, default: {}},
    coinRatePerMinute: {type: Number, required: true, min: 1},
    startedAt: {type: Date, default: Date.now},
    ringingAt: {type: Date, default: Date.now},
    acceptedAt: {type: Date, default: null},
    connectedAt: {type: Date, default: null},
    endedAt: {type: Date, default: null},
    lastHeartbeatAt: {type: Date, default: null},
    durationSeconds: {type: Number, default: 0},
    billedMinutes: {type: Number, default: 0},
    coinsCharged: {type: Number, default: 0},
    welcomeMinutesUsed: {type: Number, default: 0},
    rewardCoinsUsed: {type: Number, default: 0},
    walletCoinsUsed: {type: Number, default: 0},
    giftsCoinsCharged: {type: Number, default: 0},
    /** Internal coin units credited to receiver (800/min share). */
    receiverCoinsCredited: {type: Number, default: 0},
    /** INR credited to receiver wallet from this call. */
    receiverEarningsInr: {type: Number, default: 0},
    gifts: {
      type: [
        {
          id: {type: String, required: true},
          giftId: {type: String, required: true},
          name: {type: String, required: true},
          emoji: {type: String, default: '🎁'},
          category: {type: String, default: 'Flowers'},
          coins: {type: Number, required: true, min: 1},
          sentAt: {type: Date, default: Date.now},
        },
      ],
      default: [],
    },
    endReason: {
      type: String,
      enum: END_REASONS,
      default: null,
    },
    callerSnapshot: {
      name: {type: String, default: 'Caller'},
      avatarUrl: {type: String, default: ''},
    },
    receiverSnapshot: {
      name: {type: String, default: 'Receiver'},
      avatarUrl: {type: String, default: ''},
      age: {type: Number, default: null},
    },
  },
  {timestamps: true, collection: 'calls'},
);

callSchema.index({callerId: 1, createdAt: -1});
callSchema.index({receiverId: 1, createdAt: -1});
callSchema.index({status: 1, startedAt: -1});

module.exports = mongoose.model('Call', callSchema);
module.exports.CALL_STATUSES = CALL_STATUSES;
module.exports.END_REASONS = END_REASONS;
