const mongoose = require('mongoose');

/**
 * Tracks 7-day daily check-in window starting from account creation.
 * Reward coins live on Caller.rewardCoins (not wallet `coins`).
 */
const dailyRewardSchema = new mongoose.Schema(
  {
    userId: {type: String, required: true, unique: true, index: true},
    lastClaimDate: {type: String, default: null},
    streak: {type: Number, default: 0},
    claimedDates: {type: [String], default: []},
  },
  {timestamps: true},
);

module.exports = mongoose.model('DailyReward', dailyRewardSchema);
