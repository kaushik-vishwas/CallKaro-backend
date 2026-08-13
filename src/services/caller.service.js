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
    milestones: buildMilestonesSnapshot(caller),
  };
}

function talkMilestoneDefs() {
  return (config.talkMilestones || []).map(row => ({
    minutes: Number(row.minutes),
    coins: Number(row.coins),
  }));
}

function buildMilestonesSnapshot(caller) {
  const lifetimeSeconds = Math.max(0, Number(caller.lifetimeTalkSeconds || 0));
  const lifetimeMinutes = Math.floor(lifetimeSeconds / 60);
  const claimed = new Set(
    (Array.isArray(caller.claimedTalkMilestones)
      ? caller.claimedTalkMilestones
      : []
    ).map(Number),
  );
  const items = talkMilestoneDefs().map(def => {
    const unlocked = lifetimeMinutes >= def.minutes;
    const isClaimed = claimed.has(def.minutes);
    return {
      minutes: def.minutes,
      coins: def.coins,
      unlocked,
      claimed: isClaimed,
      claimable: unlocked && !isClaimed,
    };
  });
  const nextClaimable = items.find(item => item.claimable) || null;
  return {
    lifetimeTalkSeconds: lifetimeSeconds,
    lifetimeTalkMinutes: lifetimeMinutes,
    items,
    nextClaimable,
  };
}

/**
 * After a connected call ends: accumulate talk time and notify newly unlocked milestones.
 * Mutates + saves caller.
 */
async function recordTalkTimeAndUnlockMilestones(callerId, durationSeconds) {
  const added = Math.max(0, Math.floor(Number(durationSeconds) || 0));
  if (!callerId || added <= 0) {
    return null;
  }
  const caller = await findUserById(callerId);
  if (!caller) {
    return null;
  }

  const beforeMinutes = Math.floor(
    Math.max(0, Number(caller.lifetimeTalkSeconds || 0)) / 60,
  );
  caller.lifetimeTalkSeconds =
    Math.max(0, Number(caller.lifetimeTalkSeconds || 0)) + added;
  const afterMinutes = Math.floor(caller.lifetimeTalkSeconds / 60);

  const notified = new Set(
    (Array.isArray(caller.notifiedTalkMilestones)
      ? caller.notifiedTalkMilestones
      : []
    ).map(Number),
  );
  const newlyUnlocked = [];

  for (const def of talkMilestoneDefs()) {
    if (
      beforeMinutes < def.minutes &&
      afterMinutes >= def.minutes &&
      !notified.has(def.minutes)
    ) {
      newlyUnlocked.push(def);
      notified.add(def.minutes);
    }
  }

  caller.notifiedTalkMilestones = Array.from(notified);
  await caller.save();

  if (newlyUnlocked.length) {
    const notificationService = require('./notification.service');
    for (const def of newlyUnlocked) {
      const ready = def.minutes === 60;
      notificationService
        .createForCaller({
          callerId,
          type: 'milestone_unlocked',
          title: ready
            ? `${def.minutes}-minute reward ready`
            : `${def.minutes}-minute milestone unlocked`,
          body: ready
            ? `Your ${def.minutes}-minute milestone reward is ready to claim. ${def.coins} Coins`
            : `Congratulations! You've unlocked your ${def.minutes}-minute reward. ${def.coins} Coins`,
          data: {
            minutes: def.minutes,
            coins: def.coins,
            lifetimeTalkMinutes: afterMinutes,
          },
        })
        .catch(() => undefined);
    }
  }

  return buildMilestonesSnapshot(caller);
}

async function getMilestonesStatus(userId) {
  const caller = await findUserById(userId);
  if (!caller) {
    return null;
  }
  return buildMilestonesSnapshot(caller);
}

async function claimTalkMilestone(userId, minutesInput) {
  const minutes = Number(minutesInput);
  const def = talkMilestoneDefs().find(row => row.minutes === minutes);
  if (!def) {
    return {ok: false, message: 'Unknown milestone.'};
  }

  const caller = await findUserById(userId);
  if (!caller) {
    return {ok: false, message: 'Caller not found.'};
  }

  const lifetimeMinutes = Math.floor(
    Math.max(0, Number(caller.lifetimeTalkSeconds || 0)) / 60,
  );
  if (lifetimeMinutes < def.minutes) {
    return {
      ok: false,
      message: `Complete ${def.minutes} talk minutes to unlock this reward.`,
    };
  }

  const claimed = Array.isArray(caller.claimedTalkMilestones)
    ? [...caller.claimedTalkMilestones]
    : [];
  if (claimed.map(Number).includes(def.minutes)) {
    return {ok: false, message: 'Milestone already claimed.'};
  }

  claimed.push(def.minutes);
  caller.claimedTalkMilestones = claimed;
  caller.coins = Number(caller.coins || 0) + def.coins;

  const notified = new Set(
    (Array.isArray(caller.notifiedTalkMilestones)
      ? caller.notifiedTalkMilestones
      : []
    ).map(Number),
  );
  notified.add(def.minutes);
  caller.notifiedTalkMilestones = Array.from(notified);
  await caller.save();

  const notificationService = require('./notification.service');
  notificationService
    .createForCaller({
      callerId: userId,
      type: 'milestone_claimed',
      title: 'Reward Claimed!',
      body: `${def.coins} coins added to your wallet for the ${def.minutes}-minute milestone.`,
      data: {
        minutes: def.minutes,
        coins: def.coins,
        coinBalance: caller.coins,
      },
    })
    .catch(() => undefined);

  return {
    ok: true,
    data: {
      minutes: def.minutes,
      coinsAdded: def.coins,
      coinBalance: caller.coins,
      milestones: buildMilestonesSnapshot(caller),
      message: `${def.coins} coins added to your wallet.`,
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

/** Caller level ladder: 5000 recharged coins per level (Figma My Level chart). */
const CALLER_COINS_PER_LEVEL = 5000;
const CALLER_MAX_LEVEL = 10;

function getCallerLevelSnapshot(caller) {
  const lifetime = Math.max(0, Number(caller.lifetimeRechargedCoins || 0));
  const rawLevel = Math.floor(lifetime / CALLER_COINS_PER_LEVEL) + 1;
  const level = Math.min(CALLER_MAX_LEVEL, Math.max(1, rawLevel));
  const intoLevel = lifetime % CALLER_COINS_PER_LEVEL;
  const isMax = level >= CALLER_MAX_LEVEL;
  const levelProgress = isMax ? 1 : intoLevel / CALLER_COINS_PER_LEVEL;
  const coinsToNext = isMax ? 0 : CALLER_COINS_PER_LEVEL - intoLevel;
  return {
    level,
    levelProgress: Math.round(levelProgress * 1000) / 1000,
    coinsToNext,
    lifetimeRechargedCoins: lifetime,
  };
}

function publicUser(caller) {
  const rewards = buildRewardsSnapshot(caller);
  const vip = getVipSnapshot(caller);
  const level = getCallerLevelSnapshot(caller);
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
    level: level.level,
    levelProgress: level.levelProgress,
    coinsToNextLevel: level.coinsToNext,
    lifetimeRechargedCoins: level.lifetimeRechargedCoins,
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
  const notificationService = require('./notification.service');
  notificationService
    .createForCaller({
      callerId: userId,
      type: 'vip_success',
      title: 'VIP activated',
      body: `${plan.title} is active until ${expiresAt.toISOString().slice(0, 10)}.`,
      data: {
        planId: plan.id,
        expiresAt: expiresAt.toISOString(),
        bonusCoins,
      },
    })
    .catch(() => undefined);

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
  const cleaned = String(otp ?? '').replace(/\D/g, '').trim();
  if (String(record.otp).trim() !== cleaned) {
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
  if (caller.isBlocked) {
    return {
      ok: false,
      message: 'Your account has been blocked. Contact support.',
    };
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

  const notificationService = require('./notification.service');
  notificationService
    .createForCaller({
      callerId: userId,
      type: 'daily_checkin',
      title: 'Daily check-in claimed',
      body: `${amount.toLocaleString('en-IN')} reward coins added for today.`,
      data: {
        rewardedCoins: amount,
        dayIndex,
        streak,
      },
    })
    .catch(() => undefined);

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

  if (after <= 0 && before > 0) {
    const notificationService = require('./notification.service');
    notificationService
      .createForCaller({
        callerId: userId,
        type: 'out_of_coins',
        title: 'Out of free minutes',
        body:
          Number(caller.coins || 0) > 0
            ? 'Free talk minutes are over. Calls will use wallet coins.'
            : 'You are out of free minutes and coins. Recharge to keep talking.',
        data: {
          walletCoins: caller.coins || 0,
          welcomeTalkMinutes: after,
        },
        dedupeMinutes: 10,
      })
      .catch(() => undefined);
  }

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

function verifyRazorpaySignature(orderId, paymentId, signature) {
  const expected = crypto
    .createHmac('sha256', config.razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  if (signature === expected) {
    return true;
  }

  // Optional local Expo Go bypass — disabled when using real keys (default).
  if (
    config.razorpayAllowTestBypass &&
    (String(signature || '').startsWith('test_') ||
      String(paymentId || '').startsWith('pay_test_'))
  ) {
    return true;
  }

  return false;
}

async function createRechargeOrder(userId, amount) {
  if (!isAllowedRechargeAmount(amount)) {
    return {
      ok: false,
      message: 'Allowed amounts: 100, 200, 300, 400... only',
    };
  }

  const amountPaise = amount * 100;
  const coins = coinsForAmount(amount);
  const {createRazorpayOrder} = require('./razorpay.service');

  let rzpOrder;
  try {
    rzpOrder = await createRazorpayOrder({
      amountPaise,
      currency: 'INR',
      receipt: `rcg_${String(userId).slice(-6)}_${Date.now()}`.slice(0, 40),
      notes: {
        userId: String(userId),
        purpose: 'recharge',
        coins: String(coins),
      },
    });
  } catch (error) {
    return {
      ok: false,
      message: error.message || 'Failed to create Razorpay order.',
    };
  }

  await Order.create({
    id: rzpOrder.id,
    userId,
    purpose: 'recharge',
    planId: null,
    amount,
    amountPaise,
    coins,
    currency: 'INR',
    status: 'created',
  });

  return {
    ok: true,
    data: {
      orderId: rzpOrder.id,
      amount,
      amountPaise,
      currency: 'INR',
      coins,
      purpose: 'recharge',
      razorpayKeyId: config.razorpayKeyId,
    },
  };
}

async function createVipOrder(userId, planId) {
  const plan = config.vipPlans[planId];
  if (!plan) {
    return {ok: false, message: 'Invalid VIP plan. Use weekly or monthly.'};
  }

  const amount = Number(plan.priceInr);
  const amountPaise = amount * 100;
  const {createRazorpayOrder} = require('./razorpay.service');

  let rzpOrder;
  try {
    rzpOrder = await createRazorpayOrder({
      amountPaise,
      currency: 'INR',
      receipt: `vip_${plan.id}_${Date.now()}`.slice(0, 40),
      notes: {
        userId: String(userId),
        purpose: 'vip',
        planId: plan.id,
      },
    });
  } catch (error) {
    return {
      ok: false,
      message: error.message || 'Failed to create Razorpay VIP order.',
    };
  }

  await Order.create({
    id: rzpOrder.id,
    userId,
    purpose: 'vip',
    planId: plan.id,
    amount,
    amountPaise,
    coins: Number(plan.bonusCoins || 0),
    currency: 'INR',
    status: 'created',
  });

  return {
    ok: true,
    data: {
      orderId: rzpOrder.id,
      amount,
      amountPaise,
      currency: 'INR',
      coins: Number(plan.bonusCoins || 0),
      purpose: 'vip',
      planId: plan.id,
      planTitle: plan.title,
      razorpayKeyId: config.razorpayKeyId,
    },
  };
}

async function fulfillVipFromOrder(userId, order) {
  const planId = order.planId;
  const result = await activateVip(userId, planId);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    data: {
      ...result.data,
      orderId: order.id,
      paymentId: order.razorpayPaymentId,
      purpose: 'vip',
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
    if (order.purpose === 'vip') {
      const vip = getVipSnapshot(await findUserById(userId));
      return {
        ok: true,
        data: {
          orderId: razorpayOrderId,
          paymentId: razorpayPaymentId,
          purpose: 'vip',
          ...vip,
          message: 'Payment already verified.',
        },
      };
    }
    const callerPaid = await findUserById(userId);
    return {
      ok: true,
      data: {
        orderId: razorpayOrderId,
        paymentId: razorpayPaymentId,
        purpose: 'recharge',
        coinsAdded: 0,
        coins: callerPaid?.coins || 0,
        message: 'Payment already verified.',
      },
    };
  }

  if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    return {ok: false, message: 'Invalid payment signature.'};
  }

  order.status = 'paid';
  order.razorpayPaymentId = razorpayPaymentId;
  order.razorpaySignature = razorpaySignature;
  order.paidAt = new Date();
  await order.save();

  if (order.purpose === 'vip') {
    return fulfillVipFromOrder(userId, order);
  }

  const caller = await findUserById(userId);
  if (!caller) {
    return {ok: false, message: 'Caller not found.'};
  }

  caller.coins = (caller.coins || 0) + order.coins;
  caller.lifetimeRechargedCoins =
    Math.max(0, Number(caller.lifetimeRechargedCoins || 0)) +
    Math.max(0, Number(order.coins || 0));
  await caller.save();

  const notificationService = require('./notification.service');
  notificationService
    .createForCaller({
      callerId: userId,
      type: 'recharge_success',
      title: 'Recharge successful',
      body: `${order.coins.toLocaleString('en-IN')} coins added to your wallet.`,
      data: {
        orderId: razorpayOrderId,
        coinsAdded: order.coins,
        coins: caller.coins,
        level: getCallerLevelSnapshot(caller).level,
      },
    })
    .catch(() => undefined);

  const levelSnap = getCallerLevelSnapshot(caller);
  return {
    ok: true,
    data: {
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      purpose: 'recharge',
      coinsAdded: order.coins,
      coins: caller.coins,
      level: levelSnap.level,
      levelProgress: levelSnap.levelProgress,
      coinsToNextLevel: levelSnap.coinsToNext,
      lifetimeRechargedCoins: levelSnap.lifetimeRechargedCoins,
      message: 'Payment verified successfully',
    },
  };
}

async function verifyVipPayment(userId, payload) {
  const result = await verifyRechargePayment(userId, payload);
  if (!result.ok) {
    return result;
  }
  if (result.data?.purpose && result.data.purpose !== 'vip') {
    return {ok: false, message: 'This order is not a VIP purchase.'};
  }
  return result;
}

function derivePresence(receiver, {busyIds, connectedIds} = {}) {
  if (receiver.status !== 'active') {
    return 'offline';
  }
  // Switch OFF → Offline (never Busy). Busy only applies while available.
  const switchOn = receiver.isOnline === true;
  if (!switchOn) {
    return 'offline';
  }
  if (busyIds && busyIds.has(receiver.id)) {
    return 'busy';
  }
  // Online only when switch is ON and receiver currently has a live socket
  // (logged in / app open). Stale isOnline after logout must not show Online.
  if (connectedIds instanceof Set) {
    return connectedIds.has(receiver.id) ? 'online' : 'offline';
  }
  return 'offline';
}

function coinRatesForLevel(level) {
  if (level === 3) return {coinRate: 12, vipCoinRate: 8};
  if (level === 2) return {coinRate: 8, vipCoinRate: 5};
  return {coinRate: 5, vipCoinRate: 3};
}

async function listDiscoverReceivers(callerId) {
  const Call = require('../models/Call');
  const {getConnectedReceiverIds} = require('../realtime/io');

  const receivers = await Receiver.find({status: 'active'})
    .sort({activatedAt: -1, updatedAt: -1})
    .select(
      'id name age gender level status bio languages photos earnings totalCalls followers profileViews isOnline updatedAt activatedAt',
    )
    .lean();

  const receiverIds = receivers.map(r => r.id);

  const callService = require('./call.service');
  const [followingIds, busyIds, connectedIds] = await Promise.all([
    (async () => {
      const followService = require('./follow.service');
      return followService.getFollowingReceiverIds(callerId, receiverIds);
    })(),
    callService.getBusyReceiverIds(receiverIds),
    Promise.resolve(getConnectedReceiverIds()),
  ]);

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
        status: derivePresence(receiver, {busyIds, connectedIds}),
        isVip: Number(receiver.level) >= 3,
        isVerified: true,
        languages,
        bio: receiver.bio || '',
        level: receiver.level,
        followers: Math.max(0, Number(receiver.followers) || 0),
        profileViews: Math.max(0, Number(receiver.profileViews) || 0),
        isFollowing: followingIds.has(receiver.id),
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
  createVipOrder,
  verifyRechargePayment,
  verifyVipPayment,
  getVipStatus,
  activateVip,
  listDiscoverReceivers,
  recordTalkTimeAndUnlockMilestones,
  getMilestonesStatus,
  claimTalkMilestone,
};
