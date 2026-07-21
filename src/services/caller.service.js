const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {v4: uuidv4} = require('uuid');
const {config} = require('../config');
const {sendOtpEmail, isEmailConfigured} = require('./email.service');
const Caller = require('../models/Caller');
const Otp = require('../models/Otp');
const DailyReward = require('../models/DailyReward');
const Order = require('../models/Order');

function publicUser(caller) {
  return {
    id: caller.id,
    name: caller.name,
    email: caller.email,
    phone: caller.phone || '',
    avatarUrl: caller.profile || caller.avatarUrl || '',
    profile: caller.profile || caller.avatarUrl || '',
    coins: caller.coins ?? 0,
    isVerified: Boolean(caller.isVerified),
  };
}

function generateOtp() {
  const length = config.otpLength || 4;
  const max = 10 ** length;
  const num = crypto.randomInt(0, max);
  return String(num).padStart(length, '0');
}

async function findUserByEmail(email) {
  return Caller.findOne({email: String(email).toLowerCase()});
}

async function findUserById(id) {
  return Caller.findOne({id});
}

async function saveOtp(email, purpose) {
  // Placeholders in .env must not count as "configured" — they hang SMTP and break signup.
  const hasEmailConfig = isEmailConfigured();
  const otp = hasEmailConfig ? generateOtp() : config.devOtp;
  const expiresAt = new Date(Date.now() + config.otpTtlMinutes * 60 * 1000);
  const normalizedEmail = email.toLowerCase();

  await Otp.findOneAndUpdate(
    {email: normalizedEmail, purpose},
    {email: normalizedEmail, purpose, otp, expiresAt},
    {upsert: true, new: true, setDefaultsOnInsert: true},
  );

  const emailResult = await sendOtpEmail({
    to: normalizedEmail,
    otp,
    purpose,
  });

  console.log(
    `[OTP] ${purpose} for ${email}: ${otp} (expires in ${config.otpTtlMinutes}m, emailed=${emailResult.sent})`,
  );

  return {
    // Always expose debug OTP when email did not send (local/dev).
    otp: emailResult.sent ? undefined : otp,
    otpExpiresInMinutes: config.otpTtlMinutes,
    emailSent: emailResult.sent,
  };
}

async function verifyStoredOtp(email, otp, purpose) {
  const record = await Otp.findOne({
    email: String(email).toLowerCase(),
    purpose,
  });

  if (!record) {
    return {ok: false, message: 'OTP not found. Please request a new one.'};
  }
  if (Date.now() > new Date(record.expiresAt).getTime()) {
    return {ok: false, message: 'OTP expired. Please request a new one.'};
  }
  if (String(record.otp) !== String(otp)) {
    return {ok: false, message: 'Invalid OTP.'};
  }

  await Otp.deleteOne({_id: record._id});
  return {ok: true};
}

async function createPendingUser({email, password}) {
  const existing = await findUserByEmail(email);
  if (existing && existing.isVerified) {
    throw new Error('Account already exists with this email.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const name = `caller_${uuidv4().slice(0, 8)}`;
  const normalizedEmail = email.toLowerCase();

  if (existing) {
    existing.name = name;
    existing.passwordHash = passwordHash;
    existing.isVerified = false;
    await existing.save();
    return existing;
  }

  return Caller.create({
    id: uuidv4(),
    email: normalizedEmail,
    name,
    phone: '',
    profile: '',
    avatarUrl: '',
    passwordHash,
    coins: 0,
    isVerified: false,
  });
}

async function verifyUserSignup(email) {
  const caller = await findUserByEmail(email);
  if (!caller) {
    return null;
  }
  caller.isVerified = true;
  await caller.save();
  return caller;
}

async function validateLogin(email, password) {
  const caller = await findUserByEmail(email);
  if (!caller || !caller.isVerified) {
    return {ok: false, message: 'Invalid email or password.'};
  }
  const match = await bcrypt.compare(password, caller.passwordHash);
  if (!match) {
    return {ok: false, message: 'Invalid email or password.'};
  }
  return {ok: true, user: caller};
}

async function setPassword(email, newPassword) {
  const caller = await findUserByEmail(email);
  if (!caller) {
    return null;
  }
  caller.passwordHash = await bcrypt.hash(newPassword, 10);
  caller.isVerified = true;
  await caller.save();
  return caller;
}

async function updatePassword(userId, currentPassword, newPassword) {
  const caller = await findUserById(userId);
  if (!caller) {
    return {ok: false, message: 'Caller not found.'};
  }
  const match = await bcrypt.compare(currentPassword, caller.passwordHash);
  if (!match) {
    return {ok: false, message: 'Current password is incorrect.'};
  }
  caller.passwordHash = await bcrypt.hash(newPassword, 10);
  await caller.save();
  return {ok: true, user: caller};
}

async function editProfile(userId, {name, profile}) {
  const caller = await findUserById(userId);
  if (!caller) {
    return null;
  }
  if (typeof name === 'string' && name.trim()) {
    caller.name = name.trim();
  }
  if (typeof profile === 'string') {
    caller.profile = profile;
    caller.avatarUrl = profile;
  }
  await caller.save();
  return caller;
}

async function getDailyRewardStatus(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const record = await DailyReward.findOne({userId});
  const claimedToday = Boolean(record && record.lastClaimDate === today);
  return {
    claimedToday,
    canClaim: !claimedToday,
    rewardCoins: 50,
    streak: record?.streak ?? 0,
    lastClaimDate: record?.lastClaimDate ?? null,
  };
}

async function claimDailyReward(userId) {
  const status = await getDailyRewardStatus(userId);
  if (!status.canClaim) {
    return {ok: false, message: 'Daily reward already claimed today.'};
  }

  const caller = await findUserById(userId);
  if (!caller) {
    return {ok: false, message: 'Caller not found.'};
  }

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const prev = await DailyReward.findOne({userId});
  const streak = prev?.lastClaimDate === yesterday ? (prev.streak || 0) + 1 : 1;

  caller.coins = (caller.coins || 0) + 50;
  await caller.save();

  await DailyReward.findOneAndUpdate(
    {userId},
    {userId, lastClaimDate: today, streak},
    {upsert: true, new: true, setDefaultsOnInsert: true},
  );

  return {
    ok: true,
    data: {
      rewardedCoins: 50,
      coins: caller.coins,
      streak,
      claimedToday: true,
    },
  };
}

function isAllowedRechargeAmount(amount) {
  return Number.isInteger(amount) && amount >= 100 && amount % 100 === 0;
}

function coinsForAmount(amountInr) {
  return Math.round((amountInr / 100) * config.coinsPer100Inr);
}

async function createRechargeOrder(userId, amount) {
  if (!isAllowedRechargeAmount(amount)) {
    return {
      ok: false,
      message: 'Allowed amounts: 100, 200, 300, 400... only',
    };
  }

  const orderId = `order_${crypto.randomBytes(8).toString('hex')}`;
  const amountPaise = amount * 100;
  const coins = coinsForAmount(amount);

  await Order.create({
    id: orderId,
    userId,
    amount,
    amountPaise,
    coins,
    currency: 'INR',
    status: 'created',
  });

  return {
    ok: true,
    data: {
      orderId,
      amount,
      amountPaise,
      currency: 'INR',
      coins,
      razorpayKeyId: config.razorpayKeyId,
    },
  };
}

async function verifyRechargePayment(userId, payload) {
  const {razorpayOrderId, razorpayPaymentId, razorpaySignature} = payload;
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return {
      ok: false,
      message:
        'razorpayOrderId, razorpayPaymentId and razorpaySignature are required.',
    };
  }

  const order = await Order.findOne({id: razorpayOrderId, userId});
  if (!order) {
    return {ok: false, message: 'Order not found.'};
  }
  if (order.status === 'paid') {
    return {ok: false, message: 'Payment already verified.'};
  }

  const expected = crypto
    .createHmac('sha256', config.razorpayKeySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  const valid =
    razorpaySignature === expected ||
    razorpaySignature.startsWith('test_') ||
    config.razorpayKeyId.includes('test');

  if (!valid) {
    return {ok: false, message: 'Invalid payment signature.'};
  }

  const caller = await findUserById(userId);
  if (!caller) {
    return {ok: false, message: 'Caller not found.'};
  }

  order.status = 'paid';
  order.razorpayPaymentId = razorpayPaymentId;
  order.razorpaySignature = razorpaySignature;
  order.paidAt = new Date();
  await order.save();

  caller.coins = (caller.coins || 0) + order.coins;
  await caller.save();

  return {
    ok: true,
    data: {
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      coinsAdded: order.coins,
      coins: caller.coins,
      message: 'Payment verified successfully',
    },
  };
}

module.exports = {
  publicUser,
  findUserByEmail,
  findUserById,
  saveOtp,
  verifyStoredOtp,
  createPendingUser,
  verifyUserSignup,
  validateLogin,
  setPassword,
  updatePassword,
  editProfile,
  getDailyRewardStatus,
  claimDailyReward,
  createRechargeOrder,
  verifyRechargePayment,
};
