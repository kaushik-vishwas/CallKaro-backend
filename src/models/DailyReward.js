const mongoose = require('mongoose');

const dailyRewardSchema = new mongoose.Schema(
  {
    userId: {type: String, required: true, unique: true, index: true},
    lastClaimDate: {type: String, default: null},
    streak: {type: Number, default: 0},
  },
  {timestamps: true},
);

module.exports = mongoose.model('DailyReward', dailyRewardSchema);
