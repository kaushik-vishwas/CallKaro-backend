const mongoose = require('mongoose');
const crypto = require('crypto');

const earningLedgerSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `ERN-${crypto.randomUUID()}`,
    },
    receiverId: {type: String, required: true, index: true},
    callerId: {type: String, default: null, index: true},
    source: {
      type: String,
      enum: ['chat', 'video_call', 'gift', 'adjustment'],
      required: true,
      index: true,
    },
    /** Internal coin units credited (never shown to receiver as coins). */
    coins: {type: Number, required: true, min: 0},
    /** INR credited to receiver wallet. */
    amountInr: {type: Number, required: true, min: 0},
    referenceId: {type: String, default: null, index: true},
    meta: {type: mongoose.Schema.Types.Mixed, default: {}},
  },
  {timestamps: true, collection: 'earning_ledger'},
);

earningLedgerSchema.index({receiverId: 1, createdAt: -1});

module.exports = mongoose.model('EarningLedger', earningLedgerSchema);
