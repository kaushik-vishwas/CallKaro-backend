const mongoose = require('mongoose');
const crypto = require('crypto');

const NOTIFICATION_TYPES = [
  // Caller
  'recharge_success',
  'recharge_failed',
  'vip_success',
  'vip_failed',
  'daily_checkin',
  'out_of_coins',
  'receiver_online',
  // Shared
  'new_message',
  // Receiver
  'withdraw_submitted',
  'withdraw_under_review',
  'withdraw_success',
  'withdraw_failed',
  'earnings_credit',
  'payment_received',
];

const notificationSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `NTF-${crypto.randomUUID()}`,
    },
    callerId: {type: String, default: null, index: true},
    receiverId: {type: String, default: null, index: true},
    audience: {
      type: String,
      enum: ['caller', 'receiver'],
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
      index: true,
    },
    title: {type: String, required: true, trim: true},
    body: {type: String, required: true, trim: true},
    data: {type: mongoose.Schema.Types.Mixed, default: {}},
    readAt: {type: Date, default: null},
  },
  {timestamps: true, collection: 'notifications'},
);

notificationSchema.index({callerId: 1, createdAt: -1});
notificationSchema.index({callerId: 1, readAt: 1});
notificationSchema.index({receiverId: 1, createdAt: -1});
notificationSchema.index({receiverId: 1, readAt: 1});

module.exports = mongoose.model('Notification', notificationSchema);
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
