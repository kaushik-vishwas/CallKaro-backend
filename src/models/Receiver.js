const mongoose = require('mongoose');

const bankSchema = new mongoose.Schema(
  {
    holderName: {type: String, default: ''},
    accountNumber: {type: String, default: ''},
    ifsc: {type: String, default: ''},
    upiId: {type: String, default: ''},
  },
  {_id: false},
);

const kycDocumentSchema = new mongoose.Schema(
  {
    id: {type: String, required: true},
    title: {type: String, required: true},
    sizeLabel: {type: String, default: ''},
    url: {type: String, default: ''},
    thumbnail: {type: String, default: ''},
  },
  {_id: false},
);

const kycSchema = new mongoose.Schema(
  {
    videoUrl: {type: String, default: ''},
    videoThumb: {type: String, default: ''},
    documents: {type: [kycDocumentSchema], default: []},
  },
  {_id: false},
);

/**
 * Receiver = talent profile managed by an agent.
 * Created from agent-panel with basic info + onboarding link.
 */
const receiverSchema = new mongoose.Schema(
  {
    id: {type: String, required: true, unique: true, index: true},
    agentId: {type: String, required: true, index: true},
    name: {type: String, required: true, trim: true},
    age: {type: Number, required: true, min: 18, max: 80},
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
      required: true,
    },
    level: {type: Number, enum: [1, 2, 3], required: true},
    status: {
      type: String,
      enum: [
        'draft',
        'pending_onboarding',
        'pending_review',
        'active',
        'inactive',
        'rejected',
      ],
      default: 'pending_onboarding',
      index: true,
    },
    onboardingToken: {type: String, required: true, unique: true, index: true},
    loginEmail: {type: String, lowercase: true, trim: true, default: ''},
    temporaryPassword: {type: String, default: ''},
    passwordHash: {type: String, default: ''},
    /** True until receiver sets their own password in the app. */
    mustChangePassword: {type: Boolean, default: true},
    bio: {type: String, default: ''},
    languages: {type: [String], default: []},
    photos: {type: [String], default: []},
    bank: {type: bankSchema, default: () => ({})},
    kyc: {type: kycSchema, default: () => ({})},
    totalHours: {type: Number, default: 0},
    earnings: {type: Number, default: 0},
    /** Available wallet balance (INR). */
    walletBalance: {type: Number, default: 0},
    /** Earnings awaiting clearance (INR). */
    pendingEarnings: {type: Number, default: 0},
    totalCalls: {type: Number, default: 0},
    profileViews: {type: Number, default: 0},
    followers: {type: Number, default: 0},
    isOnline: {type: Boolean, default: false},
    /** Last known leaderboard rank (for "moved up" UI). */
    previousRank: {type: Number, default: null},
    notificationPreferences: {
      incomingCallAlerts: {type: Boolean, default: true},
      callReminderAlerts: {type: Boolean, default: false},
      withdrawalUpdates: {type: Boolean, default: true},
      earningsUpdates: {type: Boolean, default: true},
      paymentNotifications: {type: Boolean, default: true},
    },
    deletionRequestedAt: {type: Date, default: null},
    deletionReason: {type: String, default: ''},
    submittedAt: {type: Date, default: null},
    activatedAt: {type: Date, default: null},
    rejectionReason: {type: String, default: ''},
  },
  {timestamps: true, collection: 'receivers'},
);

module.exports = mongoose.model('Receiver', receiverSchema);
