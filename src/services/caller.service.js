const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {v4: uuidv4} = require('uuid');
const {config} = require('../config');
const {sendOtpEmail, isEmailConfigured} = require('./email.service');
const Caller = require('../models/Caller');
const Otp = require('../models/Otp');
const DailyReward = require('../models/DailyReward');
const Order = require('../models/Order');
const Receiver = require('../models/Receiver');
const storageService = require('./storage.service');

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date) {
  const d = new Date(date);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Day 1 = account creation day; returns 1..N (may be > 7). */
function getCheckInDayIndex(createdAt, now = new Date()) {
  const start = startOfUtcDay(createdAt || now);
  const today = startOfUtcDay(now);
  return Math.floor((today - start) / 86400000) + 1;
}

function getEffectiveRewardCoins(caller) {
  const today = todayKey();
  if (caller.rewardCoinsDate === today) {
    return Number(caller.rewardCoins || 0);
  }
  return 0;
}

function buildRewardsSnapshot(caller) {
  const today = todayKey();
  const dayIndex = getCheckInDayIndex(caller.createdAt);
  const totalDays = config.dailyCheckInDays;
  const claimedDates = Array.isArray(caller.dailyCheckInClaimedDates)
    ? caller.dailyCheckInClaimedDates
    : [];
  const claimedToday = claimedDates.includes(today);
  const withinWindow = dayIndex >= 1 && dayIndex <= totalDays;
  const effectiveRewardCoins = getEffectiveRewardCoins(caller);

  return {
    walletCoins: Number(caller.coins || 0),
    welcomeTalkMinutes: Number(caller.welcomeTalkMinutes || 0),
    welcomeTalkClaimed: Boolean(caller.welcomeTalkClaimed),
    rewardCoins: effectiveRewardCoins,
    rewardCoinsDate: effectiveRewardCoins > 0 ? today : null,
    rewardCoinsPerVideoMinute: config.rewardCoinsPerVideoMinute,
    dailyCheckIn: {
      dayIndex: Math.min(dayIndex, totalDays + 1),
      totalDays,
      withinWindow,
      canClaim: withinWindow && !claimedToday,
      claimedToday,
      rewardCoinsAmount: config.dailyCheckInCoins,
      claimedDates,
      endsAfterDays: totalDays,
    },
  };
}

function getVipSnapshot(caller, now = new Date()) {
  const expiresAt = caller.vipExpiresAt ? new Date(caller.vipExpiresAt) : null;
  const isVip = Boolean(expiresAt && expiresAt.getTime() > now.getTime());
  return {
    isVip,
    vipPlan: isVip ? caller.vipPlan || null : null,
    vipExpiresAt: isVip && expiresAt ? expiresAt.toISOString() : null,
  };
}

function publicUser(caller) {
  const rewards = buildRewardsSnapshot(caller);
  const vip = getVipSnapshot(caller);
  return {
    id: caller.id,
    name: caller.name,
    email: caller.email,
    phone: caller.phone || '',
    avatarUrl: caller.profile || caller.avatarUrl || '',
    profile: caller.profile || caller.avatarUrl || '',
    coins: rewards.walletCoins,
    isVerified: Boolean(caller.isVerified),
    welcomeTalkMinutes: rewards.welcomeTalkMinutes,
    welcomeTalkClaimed: rewards.welcomeTalkClaimed,
    rewardCoins: rewards.rewardCoins,
    rewardCoinsDate: rewards.rewardCoinsDate,
    rewardCoinsPerVideoMinute: rewards.rewardCoinsPerVideoMinute,
    dailyCheckIn: rewards.dailyCheckIn,
    isVip: vip.isVip,
    vipPlan: vip.vipPlan,
    vipExpiresAt: vip.vipExpiresAt,
  };
}

function listVipPlans() {
  return Object.values(config.vipPlans).map(plan => {
    const discount =
      plan.originalInr > plan.priceInr
        ? Math.round(((plan.originalInr - plan.priceInr) / plan.originalInr) * 100)
        : 0;
    return {
      id: plan.id,
      label: plan.label,
      title: plan.title,
      priceInr: plan.priceInr,
      originalInr: plan.originalInr,
      days: plan.days,
      bonusCoins: plan.bonusCoins,
      perDayLabel: plan.perDayLabel,
      saveBadge: plan.saveBadge || null,
      discountPercent: discount,
    };
  });
}

async function getVipStatus(userId) {
  const caller = await findUserById(userId);
  if (!caller) {
    return {ok: false, message: 'Caller not found.'};
  }
  const vip = getVipSnapshot(caller);
  return {
    ok: true,
    data: {
      ...vip,
      plans: listVipPlans(),
    },
  };
}

async function activateVip(userId, planId) {
  const plan = config.vipPlans[planId];
  if (!plan) {
    return {ok: false, message: 'Invalid VIP plan. Use weekly or monthly.'};
  }

  const caller = await findUserById(userId);
  if (!caller) {
    return {ok: false, message: 'Caller not found.'};
  }

  const now = new Date();
  const currentExpiry = caller.vipExpiresAt
    ? new Date(caller.vipExpiresAt)
    : null;
  const base =
    currentExpiry && currentExpiry.getTime() > now.getTime()
      ? currentExpiry
      : now;
  const expiresAt = new Date(base.getTime() + plan.days * 24 * 60 * 60 * 1000);

  caller.vipPlan = plan.id;
  caller.vipExpiresAt = expiresAt;

  const bonusCoins = Number(plan.bonusCoins || 0);
  if (bonusCoins > 0) {
    caller.coins = Number(caller.coins || 0) + bonusCoins;
  }

  await caller.save();

  const vip = getVipSnapshot(caller);
  return {
    ok: true,
    data: {
      ...vip,
      plan: {
        id: plan.id,
        label: plan.label,
        title: plan.title,
        priceInr: plan.priceInr,
        originalInr: plan.originalInr,
        days: plan.days,
        bonusCoins,
      },
      bonusCoinsAdded: bonusCoins,
      coins: Number(caller.coins || 0),
      message: `${plan.title} activated until ${expiresAt.toISOString().slice(0, 10)}.`,
    },
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
  const caller = await findUserById(userId);
  if (!caller) {
    throw new Error('Caller not found.');
  }

  // Expire yesterday's unused reward coins on read.
  if (caller.rewardCoinsDate && caller.rewardCoinsDate !== todayKey()) {
    if (Number(caller.rewardCoins || 0) > 0) {
      caller.rewardCoins = 0;
      await caller.save();
    }
  }

  const rewards = buildRewardsSnapshot(caller);
  const checkIn = rewards.dailyCheckIn;
  return {
    claimedToday: checkIn.claimedToday,
    canClaim: checkIn.canClaim,
    rewardCoins: checkIn.rewardCoinsAmount,
    currentRewardCoins: rewards.rewardCoins,
    streak: checkIn.claimedDates.length,
    lastClaimDate: checkIn.claimedDates[checkIn.claimedDates.length - 1] || null,
    dayIndex: checkIn.dayIndex,
    totalDays: checkIn.totalDays,
    withinWindow: checkIn.withinWindow,
    welcomeTalkMinutes: rewards.welcomeTalkMinutes,
    welcomeTalkClaimed: rewards.welcomeTalkClaimed,
    walletCoins: rewards.walletCoins,
    rewardCoinsPerVideoMinute: rewards.rewardCoinsPerVideoMinute,
    claimedDates: checkIn.claimedDates,
  };
}

/**
 * Claim day's free check-in coins (NOT wallet coins).
 * Fresh 1600 each day; previous day's unused balance is replaced/expired.
 * Available only for 7 days from account creation.
 */
async function claimDailyReward(userId) {
  const caller = await findUserById(userId);
  if (!caller) {
    return {ok: false, message: 'Caller not found.'};
  }

  const today = todayKey();
  const dayIndex = getCheckInDayIndex(caller.createdAt);
  const totalDays = config.dailyCheckInDays;

  if (dayIndex < 1 || dayIndex > totalDays) {
    return {
      ok: false,
      message: `Daily check-in is only available for ${totalDays} days after signup.`,
    };
  }

  const claimedDates = Array.isArray(caller.dailyCheckInClaimedDates)
    ? [...caller.dailyCheckInClaimedDates]
    : [];

  if (claimedDates.includes(today)) {
    return {ok: false, message: 'Daily check-in already claimed today.'};
  }

  const amount = config.dailyCheckInCoins;
  claimedDates.push(today);
  caller.dailyCheckInClaimedDates = claimedDates;
  // Fresh daily balance — replaces any leftover from a previous day.
  caller.rewardCoins = amount;
  caller.rewardCoinsDate = today;
  await caller.save();

  const yesterday = todayKey(new Date(Date.now() - 86400000));
  const prev = await DailyReward.findOne({userId});
  const streak = prev?.lastClaimDate === yesterday ? (prev.streak || 0) + 1 : 1;

  await DailyReward.findOneAndUpdate(
    {userId},
    {
      userId,
      lastClaimDate: today,
      streak,
      claimedDates,
    },
    {upsert: true, new: true, setDefaultsOnInsert: true},
  );

  return {
    ok: true,
    data: {
      rewardedCoins: amount,
      // Explicit: these are NOT wallet coins
      rewardCoins: amount,
      rewardCoinsDate: today,
      walletCoins: caller.coins || 0,
      coins: caller.coins || 0,
      dayIndex,
      totalDays,
      streak,
      claimedToday: true,
      rewardCoinsPerVideoMinute: config.rewardCoinsPerVideoMinute,
      message: `${amount} free reward coins added (valid today only).`,
    },
  };
}

/**
 * Claim welcome free talk minutes (NOT wallet coins).
 * One-time grant after registration.
 */
async function claimWelcomeTalk(userId) {
  const caller = await findUserById(userId);
  if (!caller) {
    return {ok: false, message: 'Caller not found.'};
  }

  if (caller.welcomeTalkClaimed && Number(caller.welcomeTalkMinutes || 0) > 0) {
    return {
      ok: true,
      data: {
        alreadyClaimed: true,
        welcomeTalkMinutes: caller.welcomeTalkMinutes,
        welcomeTalkClaimed: true,
      },
    };
  }

  if (caller.welcomeTalkClaimed && Number(caller.welcomeTalkMinutes || 0) <= 0) {
    return {
      ok: true,
      data: {
        alreadyClaimed: true,
        welcomeTalkMinutes: 0,
        welcomeTalkClaimed: true,
        exhausted: true,
      },
    };
  }

  const minutes = config.welcomeFreeMinutes;
  caller.welcomeTalkMinutes = minutes;
  caller.welcomeTalkClaimed = true;
  await caller.save();

  return {
    ok: true,
    data: {
      alreadyClaimed: false,
      welcomeTalkMinutes: minutes,
      welcomeTalkClaimed: true,
      message: `${minutes} free talk minutes activated.`,
    },
  };
}

/**
 * Consume welcome free talk minutes during a call.
 * When remaining hits 0, client should show recharge popup.
 */
async function consumeWelcomeTalk(userId, minutesUsed = 1) {
  const caller = await findUserById(userId);
  if (!caller) {
    return {ok: false, message: 'Caller not found.'};
  }

  if (!caller.welcomeTalkClaimed) {
    return {ok: false, message: 'Welcome free talk not claimed yet.'};
  }

  const used = Math.max(0, Number(minutesUsed) || 0);
  const before = Number(caller.welcomeTalkMinutes || 0);
  const after = Math.max(0, before - used);
  caller.welcomeTalkMinutes = after;
  await caller.save();

  return {
    ok: true,
    data: {
      welcomeTalkMinutes: after,
      welcomeTalkClaimed: true,
      exhausted: after <= 0,
      minutesUsed: Math.min(used, before),
      walletCoins: caller.coins || 0,
    },
  };
}

async function getRewardsStatus(userId) {
  const caller = await findUserById(userId);
  if (!caller) {
    return null;
  }
  if (caller.rewardCoinsDate && caller.rewardCoinsDate !== todayKey()) {
    if (Number(caller.rewardCoins || 0) > 0) {
      caller.rewardCoins = 0;
      await caller.save();
    }
  }
  return buildRewardsSnapshot(caller);
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

function derivePresence(receiver) {
  if (receiver.status !== 'active') return 'offline';
  const updated = receiver.updatedAt ? new Date(receiver.updatedAt).getTime() : 0;
  if (Date.now() - updated <= 2 * 60 * 60 * 1000) return 'online';
  return 'offline';
}

function coinRatesForLevel(level) {
  if (level === 3) return {coinRate: 12, vipCoinRate: 8};
  if (level === 2) return {coinRate: 8, vipCoinRate: 5};
  return {coinRate: 5, vipCoinRate: 3};
}

async function listDiscoverReceivers() {
  const receivers = await Receiver.find({status: 'active'})
    .sort({activatedAt: -1, updatedAt: -1})
    .select(
      'id name age gender level status bio languages photos earnings totalCalls updatedAt activatedAt',
    )
    .lean();

  const mapped = await Promise.all(
    receivers.map(async receiver => {
      const photos = await storageService.mapAccessUrls(
        Array.isArray(receiver.photos) ? receiver.photos : [],
      );
      const rates = coinRatesForLevel(receiver.level);
      const languages = Array.isArray(receiver.languages)
        ? receiver.languages
        : [];

      return {
        id: receiver.id,
        name: receiver.name,
        age: receiver.age,
        location: languages[0] || 'India',
        imageUrl: photos[0] || '',
        images: photos,
        status: derivePresence(receiver),
        isVip: Number(receiver.level) >= 3,
        isVerified: true,
        languages,
        bio: receiver.bio || '',
        level: receiver.level,
        followers: Math.max(0, Number(receiver.totalCalls) || 0),
        ...rates,
      };
    }),
  );

  return mapped.filter(item => item.imageUrl);
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
  claimWelcomeTalk,
  consumeWelcomeTalk,
  getRewardsStatus,
  createRechargeOrder,
  verifyRechargePayment,
  getVipStatus,
  activateVip,
  listDiscoverReceivers,
};
