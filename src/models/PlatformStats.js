const mongoose = require('mongoose');

/**
 * Singleton-ish platform totals (admin share of call/gift INR).
 */
const platformStatsSchema = new mongoose.Schema(
  {
    id: {type: String, required: true, unique: true, default: 'global'},
    /** Cumulative admin share (40% of gross INR from receiver earnings). */
    adminEarningsInr: {type: Number, default: 0},
    /** One-shot: legacy ledger credited 100% to receiver → 40/20/40 split. */
    earningsSplitMigratedV1: {type: Boolean, default: false},
  },
  {timestamps: true, collection: 'platform_stats'},
);

module.exports = mongoose.model('PlatformStats', platformStatsSchema);
