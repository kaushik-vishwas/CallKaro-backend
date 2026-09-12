const mongoose = require('mongoose');

const bankSchema = new mongoose.Schema(
  {
    holderName: {type: String, default: ''},
    accountNumber: {type: String, default: ''},
    ifsc: {type: String, default: ''},
    upiId: {type: String, default: ''},
    bankName: {type: String, default: ''},
    branch: {type: String, default: ''},
    accountType: {type: String, default: 'Savings'},
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
    /** Face still used for Rekognition (from KYC video frame). */
    faceImageUrl: {type: String, default: ''},
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
    /** @deprecated Free 5‑min discover uses top leaderboard rankers, not this flag. */
    isSpecial: {type: Boolean, default: false, index: true},
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
    /**
     * Caller-facing privacy proxy (agent-managed).
     * When enabled, callers see these fields instead of real name/photos.
     * Receiver app and agent "real profile" stay unchanged.
     */
    proxyProfile: {
      enabled: {type: Boolean, default: false},
      name: {type: String, default: '', trim: true},
      bio: {type: String, default: ''},
      photos: {type: [String], default: []},
      videoUrl: {type: String, default: ''},
      videoThumb: {type: String, default: ''},
    },
    bank: {type: bankSchema, default: () => ({})},
    kyc: {type: kycSchema, default: () => ({})},
    /** AWS Rekognition FaceId from KYC video face frame. */
    faceId: {type: String, default: '', index: true},
    faceIndexedAt: {type: Date, default: null},
    totalHours: {type: Number, default: 0},
    earnings: {type: Number, default: 0},
    /** Available wallet balance (INR). */
    walletBalance: {type: Number, default: 0},
    /** Earnings awaiting clearance (INR). */
    pendingEarnings: {type: Number, default: 0},
    totalCalls: {type: Number, default: 0},
    /** Rank metrics (Figma Rank Improvement rules). */
    answeredCalls: {type: Number, default: 0},
    missedCalls: {type: Number, default: 0},
    onlineMinutes: {type: Number, default: 0},
    peakOnlineMinutes: {type: Number, default: 0},
    /** Set when receiver toggles Online — used to accumulate online minutes. */
    onlineStartedAt: {type: Date, default: null},
    /**
     * Today's engagement (online + talk) in minutes — IST day.
     * Ideal profile when ≤ 90 (1.5h); otherwise non-ideal.
     */
    dailyEngagementMinutes: {type: Number, default: 0},
    dailyEngagementDate: {type: String, default: ''},
    /** Start of continuous non-idle (busy) stretch; cleared when idle again. */
    busyStartedAt: {type: Date, default: null},
    profileViews: {type: Number, default: 0},
    followers: {type: Number, default: 0},
    isOnline: {type: Boolean, default: false},
    /** Last chat/socket presence ping — used for Online indicators. */
    chatLastSeenAt: {type: Date, default: null, index: true},
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
