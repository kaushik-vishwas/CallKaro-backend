const path = require('path');
require('dotenv').config({path: path.join(__dirname, '..', '.env')});

const config = {
  port: Number(process.env.PORT || 5000),
  host: process.env.HOST || '0.0.0.0',
  mongoUri: process.env.MONGODB_URI || '',
  jwtSecret: process.env.JWT_SECRET || 'callkaro-local-dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES || 10),
  otpLength: Number(process.env.OTP_LENGTH || 4),
  // Used only when EMAIL is not configured (local fallback)
  devOtp: process.env.DEV_OTP || '1234',
  emailUser: (process.env.EMAIL_USER || '').trim(),
  // Gmail app passwords are often pasted with spaces — strip them
  emailAppPassword: (process.env.EMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_local_key',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || 'rzp_test_local_secret',
  /** Dev-only: allow fake Expo Go signatures. Keep false with real Razorpay keys. */
  razorpayAllowTestBypass:
    String(process.env.RAZORPAY_ALLOW_TEST_BYPASS || '').toLowerCase() ===
    'true',
  coinsPer100Inr: Number(process.env.COINS_PER_100_INR || 2500),
  /** Welcome free talk minutes (separate from wallet). */
  welcomeFreeMinutes: Number(process.env.WELCOME_FREE_MINUTES || 5),
  /** Daily check-in free coins (separate from wallet). 1600 coins = 1 min video. */
  dailyCheckInCoins: Number(process.env.DAILY_CHECKIN_COINS || 1600),
  dailyCheckInDays: Number(process.env.DAILY_CHECKIN_DAYS || 7),
  /** Fallback caller charge when receiver level is unknown. */
  rewardCoinsPerVideoMinute: Number(
    process.env.REWARD_COINS_PER_VIDEO_MINUTE || 1600,
  ),
  /**
   * Caller charge / category rate by receiver level (coins per minute).
   * Level 1 = 2000, Level 2 = 1800, Level 3 = 1600.
   */
  receiverCoinRatesByLevel: {
    1: Number(process.env.RECEIVER_COIN_RATE_LEVEL_1 || 2000),
    2: Number(process.env.RECEIVER_COIN_RATE_LEVEL_2 || 1800),
    3: Number(process.env.RECEIVER_COIN_RATE_LEVEL_3 || 1600),
  },
  /**
   * Receiver share units per video minute (internal fallback).
   * Prefer level-based share = 50% of category rate when level is known.
   * Converted to INR via coinsPer100Inr for wallet/withdraw.
   */
  receiverCoinsPerVideoMinute: Number(
    process.env.RECEIVER_COINS_PER_VIDEO_MINUTE || 800,
  ),
  /**
   * Caller lifetime talk-minute milestones → wallet coin rewards.
   * Thresholds are cumulative connected minutes.
   */
  talkMilestones: [
    {
      minutes: 30,
      coins: Number(process.env.MILESTONE_30_COINS || 50),
    },
    {
      minutes: 60,
      coins: Number(process.env.MILESTONE_60_COINS || 100),
    },
    {
      minutes: 120,
      coins: Number(process.env.MILESTONE_120_COINS || 150),
    },
  ],
  /** Non-VIP callers pay this many coins per outbound chat message. VIP = free. */
  coinsPerChatMessage: Number(process.env.COINS_PER_CHAT_MESSAGE || 10),
  /** VIP plans (INR). Weekly gets activation bonus wallet coins. */
  vipPlans: {
    weekly: {
      id: 'weekly',
      label: 'Weekly',
      title: 'Weekly VIP',
      priceInr: Number(process.env.VIP_WEEKLY_PRICE_INR || 149),
      originalInr: Number(process.env.VIP_WEEKLY_ORIGINAL_INR || 149),
      days: Number(process.env.VIP_WEEKLY_DAYS || 7),
      bonusCoins: Number(process.env.VIP_WEEKLY_BONUS_COINS || 1000),
      perDayLabel: '₹21/day · try it out',
    },
    monthly: {
      id: 'monthly',
      label: 'Monthly',
      title: 'Monthly VIP',
      priceInr: Number(process.env.VIP_MONTHLY_PRICE_INR || 399),
      originalInr: Number(process.env.VIP_MONTHLY_ORIGINAL_INR || 596),
      days: Number(process.env.VIP_MONTHLY_DAYS || 30),
      bonusCoins: Number(process.env.VIP_MONTHLY_BONUS_COINS || 0),
      perDayLabel: '₹13/day · best value',
      saveBadge: 'SAVE 30%',
    },
  },
  // Used when generating receiver onboarding links for the agent panel
  onboardingBaseUrl:
    process.env.ONBOARDING_BASE_URL || 'http://localhost:5174',
  // AWS S3 — file storage
  s3Bucket: (process.env.AWS_S3_BUCKET || '').trim(),
  s3Region: (process.env.AWS_S3_REGION || 'ap-south-1').trim(),
  s3AccessKeyId: (process.env.AWS_ACCESS_KEY_ID || '').trim(),
  s3SecretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || '').trim(),
  s3Endpoint: (process.env.AWS_S3_ENDPOINT || '').trim() || undefined,
  s3CdnUrl: (process.env.AWS_S3_CDN_URL || '').trim() || undefined,
  // Private buckets (default): serve via pre-signed GET URLs.
  // Set AWS_S3_PUBLIC_READ=true only if the bucket/objects are publicly readable.
  s3PublicRead: String(process.env.AWS_S3_PUBLIC_READ || '').toLowerCase() === 'true',
  s3SignedUrlExpires: Number(process.env.AWS_S3_SIGNED_URL_EXPIRES || 604800),

  /**
   * KYC face de-duplication (AWS Rekognition Face Collection).
   * Only runs on receiver onboarding video KYC — other flows untouched.
   */
  rekognitionFaceDedup:
    String(process.env.AWS_REKOGNITION_FACE_DEDUP || 'true').toLowerCase() !==
    'false',
  rekognitionCollectionId: (
    process.env.AWS_REKOGNITION_COLLECTION_ID || 'callkaro-receivers'
  ).trim(),
  rekognitionFaceMatchThreshold: Number(
    process.env.AWS_REKOGNITION_FACE_MATCH_THRESHOLD || 95,
  ),
  rekognitionRegion: (
    process.env.AWS_REKOGNITION_REGION ||
    process.env.AWS_S3_REGION ||
    'ap-south-1'
  ).trim(),

  /**
   * Video calling media provider.
   * VIDEO_CALL_PROVIDER=auto|mock|getstream
   * auto = use GetStream when STREAM_API_KEY + STREAM_API_SECRET are set.
   */
  videoCallProvider: (process.env.VIDEO_CALL_PROVIDER || 'auto').trim(),
  streamApiKey: (process.env.STREAM_API_KEY || '').trim(),
  streamApiSecret: (process.env.STREAM_API_SECRET || '').trim(),
  streamTokenTtl: (process.env.STREAM_TOKEN_TTL || '6h').trim(),
  /**
   * Dev convenience: one verified caller per device IP (quick.*@callkaro.dev).
   * Disabled in production unless ENABLE_QUICK_LOGIN=true.
   */
  enableQuickLogin:
    String(process.env.ENABLE_QUICK_LOGIN || '').toLowerCase() === 'true' ||
    process.env.NODE_ENV !== 'production',
};

if (!config.mongoUri) {
  console.warn('Warning: MONGODB_URI is not set in .env');
}
if (!config.emailUser || !config.emailAppPassword) {
  console.warn(
    'Warning: EMAIL_USER / EMAIL_APP_PASSWORD not set — OTP will be logged to console',
  );
}
if (!config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
  console.warn(
    'Warning: AWS S3 is not fully configured — set AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in .env',
  );
}
if (config.streamApiKey && config.streamApiSecret) {
  console.log(
    `[video] GetStream credentials loaded (provider mode: ${config.videoCallProvider})`,
  );
} else {
  console.warn(
    '[video] STREAM_API_KEY / STREAM_API_SECRET not set — video calls use mock media',
  );
}

module.exports = {config};
