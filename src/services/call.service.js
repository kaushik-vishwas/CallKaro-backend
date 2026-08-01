const Call = require('../models/Call');
const Caller = require('../models/Caller');
const Receiver = require('../models/Receiver');
const {config} = require('../config');
const {getIo} = require('../realtime/io');
const {GIFT_CATALOG, GIFT_CATEGORIES, getGiftById} = require('../constants/gifts');

const RING_TIMEOUT_MS = 45_000;
const ACTIVE_STATUSES = ['ringing', 'accepted', 'connected'];
const BASE_COIN_RATE = () => Number(config.rewardCoinsPerVideoMinute || 1600);

const ringTimers = new Map();

function isVipActive(caller) {
  return Boolean(
    caller?.vipExpiresAt && new Date(caller.vipExpiresAt).getTime() > Date.now(),
  );
}

function resolveCoinRate(caller) {
  const base = BASE_COIN_RATE();
  return isVipActive(caller) ? Math.max(1, Math.round(base * (1400 / 1600))) : base;
}

function remainingMinutesForCaller(caller, coinRate) {
  const rate = Math.max(1, Number(coinRate) || BASE_COIN_RATE());
  const welcome = Number(caller?.welcomeTalkMinutes || 0);
  const coins =
    Number(caller?.rewardCoins || 0) + Number(caller?.coins || 0);
  return welcome + Math.floor(coins / rate);
}

function availableCoinsForCaller(caller) {
  return (
    Number(caller?.rewardCoins || 0) + Number(caller?.coins || 0)
  );
}

function mapGifts(list) {
  return (Array.isArray(list) ? list : []).map(item => ({
    id: item.id,
    giftId: item.giftId,
    name: item.name,
    emoji: item.emoji || '🎁',
    category: item.category || 'Flowers',
    coins: Number(item.coins || 0),
    sentAt: item.sentAt,
  }));
}

function publicCall(doc, {includeProvider = true, caller = null} = {}) {
  const row = doc.toObject ? doc.toObject() : doc;
  const baseRate = BASE_COIN_RATE();
  const rate = Number(row.coinRatePerMinute || baseRate);
  const billed = Number(row.billedMinutes || 0);
  const vip = rate < baseRate;
  const gifts = mapGifts(row.gifts);
  const giftsCoinsCharged = Number(
    row.giftsCoinsCharged != null
      ? row.giftsCoinsCharged
      : gifts.reduce((sum, g) => sum + Number(g.coins || 0), 0),
  );
  const payload = {
    id: row.id,
    callerId: row.callerId,
    receiverId: row.receiverId,
    status: row.status,
    provider: row.provider || 'mock',
    coinRatePerMinute: rate,
    baseCoinRatePerMinute: baseRate,
    isVipRate: vip,
    startedAt: row.startedAt,
    ringingAt: row.ringingAt,
    acceptedAt: row.acceptedAt,
    connectedAt: row.connectedAt,
    endedAt: row.endedAt,
    durationSeconds: row.durationSeconds || 0,
    billedMinutes: billed,
    coinsCharged: row.coinsCharged || 0,
    giftsCoinsCharged,
    gifts,
    receiverCoinsCredited: Number(row.receiverCoinsCredited || 0),
    receiverEarningsInr: Number(row.receiverEarningsInr || 0),
    welcomeMinutesUsed: row.welcomeMinutesUsed || 0,
    rewardCoinsUsed: row.rewardCoinsUsed || 0,
    walletCoinsUsed: row.walletCoinsUsed || 0,
    vipSavedCoins: vip ? Math.max(0, (baseRate - rate) * billed) : 0,
    endReason: row.endReason || null,
    caller: row.callerSnapshot || {},
    receiver: row.receiverSnapshot || {},
  };
  if (caller) {
    payload.remainingMinutes = remainingMinutesForCaller(caller, rate);
    payload.availableCoins = availableCoinsForCaller(caller);
    payload.welcomeTalkMinutes = Number(caller.welcomeTalkMinutes || 0);
  }
  if (includeProvider) {
    payload.providerPayload = row.providerPayload || {};
  }
  return payload;
}

async function attachCallerBalance(callDoc) {
  const caller = await Caller.findOne({id: callDoc.callerId}).lean();
  return publicCall(callDoc, {caller});
}

function emitToParticipants(call, event, extra = {}) {
  const io = getIo();
  if (!io || !call) {
    return;
  }
  const payload = {...publicCall(call), ...extra};
  io.to(`caller:${call.callerId}`).emit(event, payload);
  io.to(`receiver:${call.receiverId}`).emit(event, payload);
}

function clearRingTimer(callId) {
  const timer = ringTimers.get(callId);
  if (timer) {
    clearTimeout(timer);
    ringTimers.delete(callId);
  }
}

function scheduleRingTimeout(callId) {
  clearRingTimer(callId);
  const timer = setTimeout(() => {
    ringTimers.delete(callId);
    markMissed(callId).catch(() => undefined);
  }, RING_TIMEOUT_MS);
  ringTimers.set(callId, timer);
}

async function assertCanAffordMinute(caller, coinRate) {
  const welcome = Number(caller.welcomeTalkMinutes || 0);
  if (welcome > 0) {
    return {ok: true, source: 'welcome'};
  }
  const reward = Number(caller.rewardCoins || 0);
  if (reward >= coinRate) {
    return {ok: true, source: 'reward'};
  }
  const wallet = Number(caller.coins || 0);
  if (wallet >= coinRate) {
    return {ok: true, source: 'wallet'};
  }
  return {ok: false, source: null};
}

/**
 * Charge one billable minute. Mutates caller doc; caller must save after.
 */
function chargeOneMinute(caller, coinRate, call) {
  const welcome = Number(caller.welcomeTalkMinutes || 0);
  if (welcome > 0) {
    caller.welcomeTalkMinutes = welcome - 1;
    call.welcomeMinutesUsed = (call.welcomeMinutesUsed || 0) + 1;
    call.billedMinutes = (call.billedMinutes || 0) + 1;
    return {ok: true, source: 'welcome', exhausted: caller.welcomeTalkMinutes <= 0};
  }

  const reward = Number(caller.rewardCoins || 0);
  if (reward >= coinRate) {
    caller.rewardCoins = reward - coinRate;
    call.rewardCoinsUsed = (call.rewardCoinsUsed || 0) + coinRate;
    call.coinsCharged = (call.coinsCharged || 0) + coinRate;
    call.billedMinutes = (call.billedMinutes || 0) + 1;
    return {ok: true, source: 'reward'};
  }

  const wallet = Number(caller.coins || 0);
  if (wallet >= coinRate) {
    caller.coins = wallet - coinRate;
    call.walletCoinsUsed = (call.walletCoinsUsed || 0) + coinRate;
    call.coinsCharged = (call.coinsCharged || 0) + coinRate;
    call.billedMinutes = (call.billedMinutes || 0) + 1;
    return {ok: true, source: 'wallet'};
  }

  return {ok: false, source: null};
}

/**
 * Credit receiver for billed minutes at internal 800 coins/min → INR.
 * Mutates call counters; call must be saved by caller.
 */
async function syncReceiverCallEarnings(call) {
  const {config} = require('../config');
  const share = Math.max(0, Number(config.receiverCoinsPerVideoMinute) || 800);
  const expected = Math.max(0, Number(call.billedMinutes) || 0) * share;
  const already = Math.max(0, Number(call.receiverCoinsCredited) || 0);
  const delta = expected - already;
  if (delta <= 0 || !call.receiverId) {
    return {ok: true, creditedCoins: 0, amountInr: 0};
  }

  const earningsService = require('./earnings.service');
  const credit = await earningsService.creditReceiverFromCoins({
    receiverId: call.receiverId,
    callerId: call.callerId,
    coins: delta,
    source: 'video_call',
    referenceId: call.id,
    meta: {
      callId: call.id,
      billedMinutes: call.billedMinutes,
      sharePerMinute: share,
    },
  });

  call.receiverCoinsCredited = already + delta;
  call.receiverEarningsInr =
    Number(call.receiverEarningsInr || 0) + Number(credit.amountInr || 0);

  return {
    ok: true,
    creditedCoins: delta,
    amountInr: credit.amountInr || 0,
  };
}

async function findActiveForUser(auth) {
  const filter =
    auth.role === 'receiver'
      ? {receiverId: auth.receiverId, status: {$in: ACTIVE_STATUSES}}
      : {callerId: auth.userId, status: {$in: ACTIVE_STATUSES}};
  return Call.findOne(filter).sort({startedAt: -1});
}

async function startCall(auth, receiverId) {
  if (auth.role !== 'caller') {
    const err = new Error('Only callers can start a call.');
    err.statusCode = 403;
    throw err;
  }
  const callerId = auth.userId;
  const rid = String(receiverId || '').trim();
  if (!rid) {
    const err = new Error('receiverId is required.');
    err.statusCode = 400;
    throw err;
  }

  const existing = await findActiveForUser(auth);
  if (existing) {
    const err = new Error('You already have an active call.');
    err.statusCode = 409;
    err.call = publicCall(existing);
    throw err;
  }

  const receiverBusy = await Call.findOne({
    receiverId: rid,
    status: {$in: ACTIVE_STATUSES},
  });
  if (receiverBusy) {
    const err = new Error('Receiver is busy on another call.');
    err.statusCode = 409;
    err.code = 'receiver_busy';
    throw err;
  }

  const [caller, receiver] = await Promise.all([
    Caller.findOne({id: callerId}),
    Receiver.findOne({id: rid}),
  ]);
  if (!caller) {
    const err = new Error('Caller not found.');
    err.statusCode = 404;
    throw err;
  }
  if (!receiver) {
    const err = new Error('Receiver is not available.');
    err.statusCode = 404;
    throw err;
  }
  if (receiver.status === 'inactive') {
    const err = new Error(
      'This Receiver is Blocked due to Policy Misconduct',
    );
    err.statusCode = 403;
    err.code = 'receiver_blocked';
    throw err;
  }
  if (receiver.status !== 'active') {
    const err = new Error('Receiver is not available.');
    err.statusCode = 404;
    throw err;
  }
  if (!receiver.isOnline) {
    const err = new Error('Receiver is currently Offline');
    err.statusCode = 409;
    err.code = 'receiver_offline';
    throw err;
  }

  try {
    const ChatBlock = require('../models/ChatBlock');
    const blocked = await ChatBlock.findOne({
      $or: [
        {
          blockerRole: 'caller',
          blockerId: callerId,
          blockedRole: 'receiver',
          blockedId: rid,
        },
        {
          blockerRole: 'receiver',
          blockerId: rid,
          blockedRole: 'caller',
          blockedId: callerId,
        },
      ],
    }).lean();
    if (blocked) {
      const err = new Error(
        'This Receiver is Blocked due to Policy Misconduct',
      );
      err.statusCode = 403;
      err.code = 'receiver_blocked';
      throw err;
    }
  } catch (error) {
    if (error?.code === 'receiver_blocked') {
      throw error;
    }
    // ChatBlock model missing — ignore
  }

  const coinRate = resolveCoinRate(caller);
  const afford = await assertCanAffordMinute(caller, coinRate);
  if (!afford.ok) {
    const err = new Error(
      'Not enough coins or free minutes to start a video call.',
    );
    err.statusCode = 402;
    throw err;
  }

  const streamVideo = require('./streamVideo.service');
  const videoProvider = streamVideo.resolveVideoProvider();

  const call = await Call.create({
    callerId,
    receiverId: rid,
    status: 'ringing',
    provider: videoProvider,
    providerPayload: {
      mode: videoProvider,
    },
    coinRatePerMinute: coinRate,
    callerSnapshot: {
      name: caller.name || 'Caller',
      avatarUrl: caller.avatarUrl || '',
      city: caller.city || caller.location || '',
      isVip: Boolean(
        caller.vipExpiresAt &&
          new Date(caller.vipExpiresAt).getTime() > Date.now(),
      ),
    },
    receiverSnapshot: {
      name: receiver.name || 'Receiver',
      avatarUrl: (receiver.photos && receiver.photos[0]) || '',
      age: receiver.age || null,
    },
  });

  call.providerPayload = streamVideo.buildProviderPayload(call.id);
  call.markModified('providerPayload');
  await call.save();

  try {
    const callQueueService = require('./callQueue.service');
    await callQueueService.fulfillQueueEntry(callerId, rid);
  } catch {
    /* queue optional */
  }

  emitToParticipants(call, 'call:incoming');
  emitToParticipants(call, 'call:ringing');
  scheduleRingTimeout(call.id);

  return publicCall(call, {caller});
}

/**
 * Pick any online, free receiver at random and start a video call.
 */
async function startRandomCall(auth) {
  if (auth.role !== 'caller') {
    const err = new Error('Only callers can start a call.');
    err.statusCode = 403;
    throw err;
  }

  const existing = await findActiveForUser(auth);
  if (existing) {
    const err = new Error('You already have an active call.');
    err.statusCode = 409;
    err.call = publicCall(existing);
    throw err;
  }

  const callerId = auth.userId;
  const busyRows = await Call.find({status: {$in: ACTIVE_STATUSES}})
    .select('receiverId')
    .lean();
  const busyIds = new Set(busyRows.map(row => String(row.receiverId)));

  let blockedIds = new Set();
  try {
    const ChatBlock = require('../models/ChatBlock');
    const blocks = await ChatBlock.find({
      $or: [
        {blockerRole: 'caller', blockerId: callerId, blockedRole: 'receiver'},
        {blockerRole: 'receiver', blockedRole: 'caller', blockedId: callerId},
      ],
    })
      .select('blockerId blockedId blockerRole')
      .lean();
    blockedIds = new Set(
      blocks.map(row =>
        row.blockerRole === 'caller'
          ? String(row.blockedId)
          : String(row.blockerId),
      ),
    );
  } catch {
    /* optional */
  }

  const candidates = await Receiver.find({
    status: 'active',
    isOnline: true,
  })
    .select('id photos')
    .lean();

  const available = candidates.filter(row => {
    const id = String(row.id);
    if (busyIds.has(id) || blockedIds.has(id)) {
      return false;
    }
    const photos = Array.isArray(row.photos) ? row.photos : [];
    return photos.length > 0;
  });

  if (!available.length) {
    const err = new Error(
      'No receivers are available right now. Try again in a moment.',
    );
    err.statusCode = 404;
    err.code = 'no_receivers_available';
    throw err;
  }

  // Shuffle and try a few in case of race (someone goes busy mid-request).
  for (let i = available.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = available[i];
    available[i] = available[j];
    available[j] = tmp;
  }

  let lastError = null;
  const maxAttempts = Math.min(available.length, 5);
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      return await startCall(auth, available[i].id);
    } catch (error) {
      lastError = error;
      if (
        error?.code === 'receiver_busy' ||
        error?.code === 'receiver_offline' ||
        error?.code === 'receiver_blocked'
      ) {
        continue;
      }
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }
  const err = new Error(
    'No receivers are available right now. Try again in a moment.',
  );
  err.statusCode = 404;
  err.code = 'no_receivers_available';
  throw err;
}

async function acceptCall(auth, callId) {
  if (auth.role !== 'receiver') {
    const err = new Error('Only the receiver can accept.');
    err.statusCode = 403;
    throw err;
  }
  const call = await Call.findOne({id: callId, receiverId: auth.receiverId});
  if (!call) {
    const err = new Error('Call not found.');
    err.statusCode = 404;
    throw err;
  }
  if (call.status !== 'ringing') {
    const err = new Error(`Call cannot be accepted from status ${call.status}.`);
    err.statusCode = 409;
    throw err;
  }

  clearRingTimer(call.id);
  const now = new Date();
  call.status = 'connected';
  call.acceptedAt = now;
  call.connectedAt = now;
  call.lastHeartbeatAt = now;
  await call.save();

  // First minute charged when call connects.
  const caller = await Caller.findOne({id: call.callerId});
  if (caller) {
    const charged = chargeOneMinute(caller, call.coinRatePerMinute, call);
    if (!charged.ok) {
      call.status = 'ended';
      call.endedAt = now;
      call.endReason = 'insufficient_coins';
      await call.save();
      emitToParticipants(call, 'call:ended');
      const err = new Error('Caller ran out of coins.');
      err.statusCode = 402;
      throw err;
    }
    await caller.save();
    await syncReceiverCallEarnings(call);
    await call.save();
  }

  emitToParticipants(call, 'call:accepted');
  emitToParticipants(call, 'call:connected');
  return publicCall(call, {caller});
}

async function rejectCall(auth, callId) {
  if (auth.role !== 'receiver') {
    const err = new Error('Only the receiver can reject.');
    err.statusCode = 403;
    throw err;
  }
  const call = await Call.findOne({id: callId, receiverId: auth.receiverId});
  if (!call) {
    const err = new Error('Call not found.');
    err.statusCode = 404;
    throw err;
  }
  if (call.status !== 'ringing') {
    const err = new Error('Call is not ringing.');
    err.statusCode = 409;
    throw err;
  }

  clearRingTimer(call.id);
  call.status = 'rejected';
  call.endedAt = new Date();
  call.endReason = 'rejected';
  await call.save();
  emitToParticipants(call, 'call:rejected');
  emitToParticipants(call, 'call:ended');
  return publicCall(call);
}

async function markMissed(callId) {
  const call = await Call.findOne({id: callId, status: 'ringing'});
  if (!call) {
    return null;
  }
  call.status = 'missed';
  call.endedAt = new Date();
  call.endReason = 'missed';
  await call.save();
  emitToParticipants(call, 'call:missed');
  emitToParticipants(call, 'call:ended');
  return publicCall(call);
}

async function endCall(auth, callId, reason) {
  const filter =
    auth.role === 'receiver'
      ? {id: callId, receiverId: auth.receiverId}
      : {id: callId, callerId: auth.userId};
  const call = await Call.findOne(filter);
  if (!call) {
    const err = new Error('Call not found.');
    err.statusCode = 404;
    throw err;
  }
  if (!ACTIVE_STATUSES.includes(call.status) && call.status !== 'accepted') {
    return publicCall(call);
  }

  clearRingTimer(call.id);
  const now = new Date();

  if (call.connectedAt) {
    call.durationSeconds = Math.max(
      0,
      Math.floor((now.getTime() - new Date(call.connectedAt).getTime()) / 1000),
    );
    // Bill any remaining fraction beyond already billed minutes (>5s into next minute).
    const expectedMinutes = Math.max(
      1,
      Math.ceil(Math.max(call.durationSeconds - 5, 0) / 60) || 1,
    );
    const toBill = Math.max(0, expectedMinutes - (call.billedMinutes || 0));
    if (toBill > 0) {
      const caller = await Caller.findOne({id: call.callerId});
      if (caller) {
        for (let i = 0; i < toBill; i += 1) {
          const charged = chargeOneMinute(caller, call.coinRatePerMinute, call);
          if (!charged.ok) {
            break;
          }
        }
        await caller.save();
      }
    }
  }

  call.status = 'ended';
  call.endedAt = now;
  call.endReason =
    reason ||
    (auth.role === 'receiver' ? 'receiver_hangup' : 'caller_hangup');
  if (call.connectedAt) {
    await syncReceiverCallEarnings(call);
  }
  await call.save();

  if (call.connectedAt) {
    await Receiver.updateOne(
      {id: call.receiverId},
      {$inc: {totalCalls: 1}},
    ).catch(() => undefined);

    const callerService = require('./caller.service');
    await callerService
      .recordTalkTimeAndUnlockMilestones(
        call.callerId,
        call.durationSeconds || 0,
      )
      .catch(() => undefined);
  }

  emitToParticipants(call, 'call:ended');
  return attachCallerBalance(call);
}

async function heartbeat(auth, callId) {
  const filter =
    auth.role === 'receiver'
      ? {id: callId, receiverId: auth.receiverId}
      : {id: callId, callerId: auth.userId};
  const call = await Call.findOne(filter);
  if (!call) {
    const err = new Error('Call not found.');
    err.statusCode = 404;
    throw err;
  }
  if (call.status !== 'connected' || !call.connectedAt) {
    return publicCall(call);
  }

  const now = new Date();
  call.lastHeartbeatAt = now;
  call.durationSeconds = Math.max(
    0,
    Math.floor((now.getTime() - new Date(call.connectedAt).getTime()) / 1000),
  );

  const expectedMinutes = Math.max(1, Math.ceil(call.durationSeconds / 60));
  const missing = expectedMinutes - (call.billedMinutes || 0);

  if (missing > 0) {
    const caller = await Caller.findOne({id: call.callerId});
    if (!caller) {
      return publicCall(call);
    }
    for (let i = 0; i < missing; i += 1) {
      const charged = chargeOneMinute(caller, call.coinRatePerMinute, call);
      if (!charged.ok) {
        call.status = 'ended';
        call.endedAt = now;
        call.endReason = 'insufficient_coins';
        await syncReceiverCallEarnings(call);
        await caller.save();
        await call.save();
        emitToParticipants(call, 'call:ended', {forceEnd: true});
        return publicCall(call);
      }
    }
    await caller.save();
  }

  await syncReceiverCallEarnings(call);
  await call.save();
  return attachCallerBalance(call);
}

async function getCall(auth, callId) {
  const call = await Call.findOne({id: callId});
  if (!call) {
    const err = new Error('Call not found.');
    err.statusCode = 404;
    throw err;
  }
  const isParticipant =
    (auth.role === 'caller' && call.callerId === auth.userId) ||
    (auth.role === 'receiver' && call.receiverId === auth.receiverId);
  if (!isParticipant) {
    const err = new Error('Forbidden.');
    err.statusCode = 403;
    throw err;
  }
  return attachCallerBalance(call);
}

async function listHistory(auth, {limit = 50} = {}) {
  const filter =
    auth.role === 'receiver'
      ? {receiverId: auth.receiverId}
      : {callerId: auth.userId};
  const rows = await Call.find(filter)
    .sort({createdAt: -1})
    .limit(Math.min(100, Math.max(1, Number(limit) || 50)))
    .lean();
  return {
    calls: rows.map(row => publicCall(row, {includeProvider: false})),
  };
}

async function getActive(auth) {
  const call = await findActiveForUser(auth);
  return call ? attachCallerBalance(call) : null;
}

function listGiftCatalog() {
  return {
    categories: GIFT_CATEGORIES,
    gifts: GIFT_CATALOG,
  };
}

async function sendGift(auth, callId, giftId) {
  if (auth.role !== 'caller') {
    const err = new Error('Only callers can send gifts.');
    err.statusCode = 403;
    throw err;
  }
  const gift = getGiftById(giftId);
  if (!gift) {
    const err = new Error('Gift not found.');
    err.statusCode = 404;
    throw err;
  }

  const call = await Call.findOne({id: callId, callerId: auth.userId});
  if (!call) {
    const err = new Error('Call not found.');
    err.statusCode = 404;
    throw err;
  }
  if (call.status !== 'connected') {
    const err = new Error('Gifts can only be sent during an active call.');
    err.statusCode = 400;
    throw err;
  }

  const caller = await Caller.findOne({id: auth.userId});
  if (!caller) {
    const err = new Error('Caller not found.');
    err.statusCode = 404;
    throw err;
  }

  const cost = Number(gift.coins);
  const reward = Number(caller.rewardCoins || 0);
  const wallet = Number(caller.coins || 0);
  if (reward + wallet < cost) {
    const err = new Error('Not enough coins to send this gift.');
    err.statusCode = 402;
    throw err;
  }

  let fromReward = 0;
  let fromWallet = 0;
  if (reward >= cost) {
    caller.rewardCoins = reward - cost;
    fromReward = cost;
  } else {
    fromReward = reward;
    fromWallet = cost - reward;
    caller.rewardCoins = 0;
    caller.coins = wallet - fromWallet;
  }

  const crypto = require('crypto');
  const giftRow = {
    id: `GFT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    giftId: gift.id,
    name: gift.name,
    emoji: gift.emoji,
    category: gift.category,
    coins: cost,
    sentAt: new Date(),
  };
  call.gifts = [...(call.gifts || []), giftRow];
  call.giftsCoinsCharged = Number(call.giftsCoinsCharged || 0) + cost;
  if (fromReward) {
    call.rewardCoinsUsed = Number(call.rewardCoinsUsed || 0) + fromReward;
  }
  if (fromWallet) {
    call.walletCoinsUsed = Number(call.walletCoinsUsed || 0) + fromWallet;
  }

  await caller.save();
  await call.save();

  const payload = await attachCallerBalance(call);
  emitToParticipants(call, 'call:gift', {
    gift: giftRow,
    call: payload,
  });
  return {
    call: payload,
    gift: giftRow,
  };
}

module.exports = {
  startCall,
  startRandomCall,
  acceptCall,
  rejectCall,
  endCall,
  heartbeat,
  getCall,
  listHistory,
  getActive,
  publicCall,
  markMissed,
  listGiftCatalog,
  sendGift,
};
