const mongoose = require('mongoose');

/**
 * Caller = end-user of the mobile caller app (formerly User).
 * Collection: callers
 *
 * Wallet coins (`coins`) are paid/recharged balance.
 * Welcome talk minutes and daily check-in reward coins are SEPARATE rewards.
 */
const callerSchema = new mongoose.Schema(
  {
    id: {type: String, required: true, unique: true, index: true},
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: {type: String, required: true, trim: true},
    phone: {type: String, default: ''},
    profile: {type: String, default: ''},
    avatarUrl: {type: String, default: ''},
    passwordHash: {type: String, required: true},
    /** Paid / recharged wallet coins — not used for welcome/check-in rewards. */
    coins: {type: Number, default: 0},
    isVerified: {type: Boolean, default: false},

    /** Welcome reward: free talk minutes (separate from wallet). */
    welcomeTalkMinutes: {type: Number, default: 0},
    welcomeTalkClaimed: {type: Boolean, default: false},

    /**
     * Daily check-in reward coins (separate from wallet).
     * Fresh 1600 each claim day; previous day's unused balance expires next day.
     */
    rewardCoins: {type: Number, default: 0},
    rewardCoinsDate: {type: String, default: null},
    dailyCheckInClaimedDates: {type: [String], default: []},

    /**
     * Lifetime connected talk time (seconds) across all calls.
     * Used for 30 / 60 / 120 minute milestone rewards.
     */
    lifetimeTalkSeconds: {type: Number, default: 0},
    /** Claimed milestone minute thresholds, e.g. [30, 60]. */
    claimedTalkMilestones: {type: [Number], default: []},
    /** Milestones already notified as unlocked. */
    notifiedTalkMilestones: {type: [Number], default: []},

    /** VIP membership — active while vipExpiresAt is in the future. */
    vipPlan: {type: String, default: null},
    vipExpiresAt: {type: Date, default: null},

    /**
     * Lifetime coins credited via wallet recharge (not welcome/check-in/VIP bonus).
     * Caller level = floor(lifetimeRechargedCoins / 5000) + 1 (max 10).
     */
    lifetimeRechargedCoins: {type: Number, default: 0},

    /** Admin moderation — blocked callers cannot login or chat. */
    isBlocked: {type: Boolean, default: false, index: true},

    /** Last chat/socket presence ping — used for Online indicators. */
    chatLastSeenAt: {type: Date, default: null, index: true},
  },
  {timestamps: true, collection: 'callers'},
);

module.exports = mongoose.model('Caller', callerSchema);
