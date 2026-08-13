const mongoose = require('mongoose');
const crypto = require('crypto');

const WITHDRAWAL_STATUSES = [
  'otp_pending',
  'pending_review',
  'paid',
  'failed',
  'cancelled',
];

const withdrawalSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `WDR-${crypto.randomUUID()}`,
    },
    receiverId: {type: String, required: true, index: true},
    amountInr: {type: Number, required: true, min: 1},
    feeInr: {type: Number, required: true, min: 0},
    feeRate: {type: Number, required: true, min: 0},
    netInr: {type: Number, required: true, min: 0},
    status: {
      type: String,
      enum: WITHDRAWAL_STATUSES,
      default: 'otp_pending',
      index: true,
    },
    bankSnapshot: {
      holderName: {type: String, default: ''},
      bankName: {type: String, default: ''},
      accountType: {type: String, default: 'Savings'},
      accountMasked: {type: String, default: ''},
      accountNumber: {type: String, default: ''},
      ifsc: {type: String, default: ''},
      branch: {type: String, default: ''},
    },
    otpHash: {type: String, default: ''},
    otpExpiresAt: {type: Date, default: null},
    utr: {type: String, default: ''},
    paidAt: {type: Date, default: null},
    failureReason: {type: String, default: ''},
    walletBalanceAfter: {type: Number, default: null},
  },
  {timestamps: true, collection: 'withdrawals'},
);

withdrawalSchema.index({receiverId: 1, createdAt: -1});

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
module.exports.WITHDRAWAL_STATUSES = WITHDRAWAL_STATUSES;
