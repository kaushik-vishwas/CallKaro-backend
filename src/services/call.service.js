const Call = require('../models/Call');
const Caller = require('../models/Caller');
const Receiver = require('../models/Receiver');
const {config} = require('../config');
const {getIo} = require('../realtime/io');
const {GIFT_CATALOG, GIFT_CATEGORIES, getGiftById} = require('../constants/gifts');

const RING_TIMEOUT_MS = 45_000;
/** Connected calls with no heartbeat for this long are treated as abandoned. */
const STALE_CONNECTED_MS = 90_000;
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

/** Sign snapshot avatar keys so clients can render receiver/caller photos. */
async function hydrateCallAvatars(payload) {
  const storageService = require('./storage.service');
  const receiverUrl = payload?.receiver?.avatarUrl || '';
  const callerUrl = payload?.caller?.avatarUrl || '';
  const [receiverAvatar, callerAvatar] = await storageService.mapAccessUrls([
    receiverUrl,
    callerUrl,
  ]);
  return {
    ...payload,
    caller: {
      ...(payload.caller || {}),
      avatarUrl: callerAvatar || callerUrl || '',
    },
    receiver: {
      ...(payload.receiver || {}),
      avatarUrl: receiverAvatar || receiverUrl || '',
    },
  };
}

async function publicCallHydrated(doc, opts = {}) {
  return hydrateCallAvatars(publicCall(doc, opts));
}

async function attachCallerBalance(callDoc) {
  const caller = await Caller.findOne({id: callDoc.callerId}).lean();
  return publicCallHydrated(callDoc, {caller});
}

function emitToParticipants(call, event, extra = {}) {
  const io = getIo();
  if (!io || !call) {
    return;
  }
  publicCallHydrated(call)
    .then(hydrated => {
      const payload = {...hydrated, ...extra};
      io.to(`caller:${call.callerId}`).emit(event, payload);
      io.to(`receiver:${call.receiverId}`).emit(event, payload);
    })
    .catch(() => {
      const payload = {...publicCall(call), ...extra};
      io.to(`caller:${call.callerId}`).emit(event, payload);
      io.to(`receiver:${call.receiverId}`).emit(event, payload);
    });
}

function scheduleQueueAfterReceiverFree(receiverId, call = null) {
  try {
    const callQueueService = require('./callQueue.service');
    if (call?.providerPayload?.isCallback || call?.providerPayload?.queueId) {
      callQueueService
        .completeCallbackAttempt(call)
        .catch(() => undefined);
    } else {
      callQueueService.scheduleProcessQueue(receiverId, 5_000);
    }
  } catch {
    /* optional */
  }
  try {
    const chatService = require('./chat.service');
    chatService
      .broadcastPresenceForUser('receiver', receiverId, true)
      .catch(() => undefined);
  } catch {
    /* optional */
  }
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

/**
 * Force-close a stuck call so the receiver is not permanently "busy".
 * Skips coin billing — these are abandoned sessions.
 */
async function forceCloseCall(call, endReason) {
  if (!call || !ACTIVE_STATUSES.includes(call.status)) {
    return call;
  }
  clearRingTimer(call.id);
  const now = new Date();
  const wasRinging = call.status === 'ringing';
  if (wasRinging) {
    call.status = 'missed';
    call.endReason = endReason || 'missed';
  } else {
    if (call.connectedAt) {
      call.durationSeconds = Math.max(
        0,
        Math.floor(
          (now.getTime() - new Date(call.connectedAt).getTime()) / 1000,
        ),
      );
    }
    call.status = 'ended';
    call.endReason = endReason || 'stale';
  }
  call.endedAt = now;
  try {
    await call.save();
  } catch (err) {
    // Fallback if an unexpected endReason fails schema validation.
    call.endReason = wasRinging ? 'missed' : 'timeout';
    await call.save();
  }
  if (wasRinging) {
    emitToParticipants(call, 'call:missed');
    try {
      const notificationService = require('./notification.service');
      const callerName = call.callerSnapshot?.name || 'A caller';
      await notificationService.notifyReceiverMissedCall({
        receiverId: call.receiverId,
        callerName,
        callId: call.id,
        callerId: call.callerId,
      });
    } catch {
      /* optional */
    }
  }
  emitToParticipants(call, 'call:ended');
  scheduleQueueAfterReceiverFree(call.receiverId, call);
  return call;
}
async function sweepStaleActiveCalls({receiverId, callerId} = {}) {
  const filter = {status: {$in: ACTIVE_STATUSES}};
  if (receiverId) {
    filter.receiverId = receiverId;
  }
  if (callerId) {
    filter.callerId = callerId;
  }
  const rows = await Call.find(filter);
  const now = Date.now();
  let closed = 0;
  for (const call of rows) {
    if (call.status === 'ringing') {
      const ringingAt = new Date(
        call.ringingAt || call.createdAt || 0,
      ).getTime();
      if (now - ringingAt >= RING_TIMEOUT_MS) {
        await forceCloseCall(call, 'missed');
        closed += 1;
      }
      continue;
    }
    if (call.status === 'accepted') {
      const acceptedAt = new Date(
        call.acceptedAt || call.updatedAt || call.createdAt || 0,
      ).getTime();
      if (now - acceptedAt >= 60_000) {
        await forceCloseCall(call, 'stale');
        closed += 1;
      }
      continue;
    }
    if (call.status === 'connected') {
      const hbSource =
        call.lastHeartbeatAt || call.connectedAt || call.updatedAt;
      const hbAt = new Date(hbSource || 0).getTime();
      if (now - hbAt >= STALE_CONNECTED_MS) {
        await forceCloseCall(call, 'stale');
        closed += 1;
      }
    }
  }
  return closed;
}

/**
 * Drop leftover active calls for a receiver so Busy cannot stick on discover.
 * When force=true (going offline), close every active call including live ones.
 */
async function releaseReceiverForOnline(receiverId, {force = false} = {}) {
  const rid = String(receiverId || '').trim();
  if (!rid) {
    return 0;
  }
  await sweepStaleActiveCalls({receiverId: rid});
  const rows = await Call.find({
    receiverId: rid,
    status: {$in: ACTIVE_STATUSES},
  });
  const now = Date.now();
  let closed = 0;
  for (const call of rows) {
    if (
      !force &&
      call.status === 'connected' &&
      call.lastHeartbeatAt
    ) {
      const age = now - new Date(call.lastHeartbeatAt).getTime();
      if (age < 30_000) {
        continue;
      }
    }
    await forceCloseCall(
      call,
      call.status === 'ringing'
        ? 'missed'
        : force
          ? 'receiver_went_offline'
          : 'receiver_went_online',
    );
    closed += 1;
  }
  return closed;
}

/**
 * Receiver IDs that are truly on a live call right now.
 * Runs a stale sweep first so abandoned rows cannot mark Busy forever.
 */
async function getBusyReceiverIds(receiverIds = []) {
  const ids = Array.isArray(receiverIds)
    ? receiverIds.map(id => String(id)).filter(Boolean)
    : [];
  if (!ids.length) {
    return new Set();
  }
  await sweepStaleActiveCalls();
  const rows = await Call.find({
    receiverId: {$in: ids},
    status: {$in: ACTIVE_STATUSES},
  })
    .select(
      'id receiverId status ringingAt acceptedAt connectedAt lastHeartbeatAt createdAt updatedAt',
    )
    .lean();
  const now = Date.now();
  const busy = new Set();
  for (const row of rows) {
    const rid = String(row.receiverId || '');
    if (!rid) {
      continue;
    }
    if (row.status === 'ringing') {
      const at = new Date(row.ringingAt || row.createdAt || 0).getTime();
      if (now - at < RING_TIMEOUT_MS) {
        busy.add(rid);
      } else {
        const doc = await Call.findOne({id: row.id});
        if (doc) {
          await forceCloseCall(doc, 'timeout');
        }
      }
      continue;
    }
    if (row.status === 'accepted') {
      const at = new Date(
        row.acceptedAt || row.updatedAt || row.createdAt || 0,
      ).getTime();
      if (now - at < 60_000) {
        busy.add(rid);
      } else {
        const doc = await Call.findOne({id: row.id});
        if (doc) {
          await forceCloseCall(doc, 'timeout');
        }
      }
      continue;
    }
    if (row.status === 'connected') {
      const at = new Date(
        row.lastHeartbeatAt || row.connectedAt || row.updatedAt || 0,
      ).getTime();
      if (now - at < STALE_CONNECTED_MS) {
        busy.add(rid);
      } else {
        const doc = await Call.findOne({id: row.id});
        if (doc) {
          await forceCloseCall(doc, 'timeout');
        }
      }
    }
  }
  return busy;
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

  if (credit.ok && Number(credit.amountInr) > 0) {
    const notificationService = require('./notification.service');
    notificationService
      .notifyReceiverEarnings({
        receiverId: call.receiverId,
        amountInr: credit.amountInr,
        source: 'video_call',
        callId: call.id,
      })
      .catch(() => undefined);
  }

  return {
    ok: true,
    creditedCoins: delta,
    amountInr: credit.amountInr || 0,
  };
}

async function findActiveForUser(auth) {
  if (auth.role === 'receiver') {
    await sweepStaleActiveCalls({receiverId: auth.receiverId});
  } else {
    await sweepStaleActiveCalls({callerId: auth.userId});
  }
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
  return createRingingCall(auth.userId, String(receiverId || '').trim(), {
    fulfillQueue: true,
  });
}

/**
 * System/receiver-triggered callback: ring the next queued caller → receiver.
 */
async function createCallbackCall(callerId, receiverId, {queueId = null} = {}) {
  return createRingingCall(String(callerId || '').trim(), String(receiverId || '').trim(), {
    fulfillQueue: false,
    isCallback: true,
    queueId,
  });
}

async function createRingingCall(
  callerId,
  rid,
  {fulfillQueue = true, isCallback = false, queueId = null} = {},
) {
  if (!callerId || !rid) {
    const err = new Error('callerId and receiverId are required.');
    err.statusCode = 400;
    throw err;
  }

  const existingCaller = await Call.findOne({
    callerId,
    status: {$in: ACTIVE_STATUSES},
  });
  if (existingCaller) {
    const err = new Error('Caller already has an active call.');
    err.statusCode = 409;
    err.call = publicCall(existingCaller);
    throw err;
  }

  await sweepStaleActiveCalls({receiverId: rid});

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
  if (caller.isBlocked) {
    const err = new Error('Caller is blocked.');
    err.statusCode = 403;
    err.code = 'caller_blocked';
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

  const {getConnectedReceiverIds} = require('../realtime/io');
  const connectedIds = getConnectedReceiverIds();
  if (connectedIds instanceof Set && !connectedIds.has(rid)) {
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
    err.code = 'insufficient_coins';
    throw err;
  }

  const streamVideo = require('./streamVideo.service');
  const storageService = require('./storage.service');
  const videoProvider = streamVideo.resolveVideoProvider();

  const [receiverAvatar] = await storageService.mapAccessUrls(
    Array.isArray(receiver.photos) && receiver.photos[0]
      ? [receiver.photos[0]]
      : [],
  );
  const [callerAvatar] = await storageService.mapAccessUrls(
    caller.avatarUrl ? [caller.avatarUrl] : [],
  );

  const call = await Call.create({
    callerId,
    receiverId: rid,
    status: 'ringing',
    provider: videoProvider,
    providerPayload: {
      mode: videoProvider,
      isCallback: Boolean(isCallback),
      queueId: queueId || null,
    },
    coinRatePerMinute: coinRate,
    callerSnapshot: {
      name: caller.name || 'Caller',
      avatarUrl: callerAvatar || caller.avatarUrl || '',
      city: caller.city || caller.location || '',
      isVip: Boolean(
        caller.vipExpiresAt &&
          new Date(caller.vipExpiresAt).getTime() > Date.now(),
      ),
    },
    receiverSnapshot: {
      name: receiver.name || 'Receiver',
      avatarUrl: receiverAvatar || '',
      age: receiver.age || null,
    },
  });

  call.providerPayload = {
    ...streamVideo.buildProviderPayload(call.id),
    isCallback: Boolean(isCallback),
    queueId: queueId || null,
  };
  call.markModified('providerPayload');
  await call.save();

  if (fulfillQueue) {
    try {
      const callQueueService = require('./callQueue.service');
      await callQueueService.fulfillQueueEntry(callerId, rid);
    } catch {
      /* queue optional */
    }
  }

  emitToParticipants(call, 'call:incoming', {isCallback: Boolean(isCallback)});
  emitToParticipants(call, 'call:ringing', {isCallback: Boolean(isCallback)});
  scheduleRingTimeout(call.id);
  try {
    const chatService = require('./chat.service');
    chatService
      .broadcastReceiverDiscoverStatus(rid, 'busy')
      .catch(() => undefined);
  } catch {
    /* optional */
  }

  return publicCallHydrated(call, {caller});
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
  await sweepStaleActiveCalls();
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

  const {getConnectedReceiverIds} = require('../realtime/io');
  const connectedIds = getConnectedReceiverIds();

  const available = candidates.filter(row => {
    const id = String(row.id);
    if (busyIds.has(id) || blockedIds.has(id)) {
      return false;
    }
    if (connectedIds instanceof Set && !connectedIds.has(id)) {
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
  const isReceiver = auth.role === 'receiver';
  const isCaller = auth.role === 'caller';
  if (!isReceiver && !isCaller) {
    const err = new Error('Only call participants can accept.');
    err.statusCode = 403;
    throw err;
  }

  const filter = isReceiver
    ? {id: callId, receiverId: auth.receiverId}
    : {id: callId, callerId: auth.userId};
  const call = await Call.findOne(filter);
  if (!call) {
    const err = new Error('Call not found.');
    err.statusCode = 404;
    throw err;
  }

  // Callers may only accept auto-callback rings (receiver calling them back).
  if (isCaller && !call.providerPayload?.isCallback) {
    const err = new Error('Only the receiver can accept this call.');
    err.statusCode = 403;
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
  return publicCallHydrated(call, {caller});
}

async function rejectCall(auth, callId) {
  const isReceiver = auth.role === 'receiver';
  const isCaller = auth.role === 'caller';
  if (!isReceiver && !isCaller) {
    const err = new Error('Only call participants can reject.');
    err.statusCode = 403;
    throw err;
  }

  const filter = isReceiver
    ? {id: callId, receiverId: auth.receiverId}
    : {id: callId, callerId: auth.userId};
  const call = await Call.findOne(filter);
  if (!call) {
    const err = new Error('Call not found.');
    err.statusCode = 404;
    throw err;
  }

  if (isCaller && !call.providerPayload?.isCallback) {
    const err = new Error('Only the receiver can reject this call.');
    err.statusCode = 403;
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
  scheduleQueueAfterReceiverFree(call.receiverId, call);
  return publicCallHydrated(call);
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
  try {
    const callQueueService = require('./callQueue.service');
    await callQueueService.enqueueCallerAfterMissed(
      call.callerId,
      call.receiverId,
    );
  } catch {
    /* optional */
  }
  scheduleQueueAfterReceiverFree(call.receiverId, call);
  try {
    const notificationService = require('./notification.service');
    const callerName =
      call.callerSnapshot?.name ||
      (await Caller.findOne({id: call.callerId}).select('name').lean())?.name ||
      'A caller';
    await notificationService.notifyReceiverMissedCall({
      receiverId: call.receiverId,
      callerName,
      callId: call.id,
      callerId: call.callerId,
    });
  } catch {
    /* optional */
  }
  return publicCallHydrated(call);
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
    return publicCallHydrated(call);
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
    const hoursAdded = Math.max(0, Number(call.durationSeconds) || 0) / 3600;
    await Receiver.updateOne(
      {id: call.receiverId},
      {$inc: {totalCalls: 1, totalHours: hoursAdded}},
    ).catch(() => undefined);
    const updatedReceiver = await Receiver.findOne({id: call.receiverId});

    if (updatedReceiver) {
      const notificationService = require('./notification.service');
      const receiverService = require('./receiver.service');
      notificationService
        .notifyReceiverCallMilestone({
          receiverId: updatedReceiver.id,
          totalCalls: updatedReceiver.totalCalls,
        })
        .catch(() => undefined);
      receiverService
        .maybeLevelUpReceiver(updatedReceiver)
        .catch(() => undefined);
    }

    const callerService = require('./caller.service');
    await callerService
      .recordTalkTimeAndUnlockMilestones(
        call.callerId,
        call.durationSeconds || 0,
      )
      .catch(() => undefined);
  }

  emitToParticipants(call, 'call:ended');
  scheduleQueueAfterReceiverFree(call.receiverId, call);
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
    return publicCallHydrated(call);
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
      return publicCallHydrated(call);
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
        return publicCallHydrated(call);
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
  const calls = await Promise.all(
    rows.map(row => publicCallHydrated(row, {includeProvider: false})),
  );
  return {calls};
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

  // Credit receiver a share of gift coins (same purchase-rate INR conversion).
  let giftAmountInr = 0;
  try {
    const earningsService = require('./earnings.service');
    // Receiver earns half of gift coin value.
    const shareCoins = Math.max(1, Math.round(cost * 0.5));
    const credit = await earningsService.creditReceiverFromCoins({
      receiverId: call.receiverId,
      callerId: auth.userId,
      coins: shareCoins,
      source: 'gift',
      referenceId: giftRow.id,
      meta: {
        callId: call.id,
        giftId: gift.id,
        giftName: gift.name,
        giftCoins: cost,
      },
    });
    giftAmountInr = Number(credit.amountInr || 0);
    if (giftAmountInr > 0) {
      call.receiverEarningsInr =
        Number(call.receiverEarningsInr || 0) + giftAmountInr;
      await call.save();
    }
    const notificationService = require('./notification.service');
    notificationService
      .notifyReceiverGift({
        receiverId: call.receiverId,
        giftName: gift.name,
        emoji: gift.emoji,
        amountInr: giftAmountInr,
        coins: shareCoins,
        callId: call.id,
        callerName: caller.name || 'A caller',
      })
      .catch(() => undefined);
  } catch (err) {
    console.error('[gift.credit]', err.message || err);
  }

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

async function submitIdentityFeedback(auth, callId, body = {}) {
  if (auth.role !== 'caller') {
    const err = new Error('Only callers can submit identity feedback.');
    err.statusCode = 403;
    throw err;
  }
  const call = await Call.findOne({id: callId, callerId: auth.userId});
  if (!call) {
    const err = new Error('Call not found.');
    err.statusCode = 404;
    throw err;
  }
  if (call.status !== 'ended') {
    const err = new Error('Feedback is only allowed after the call ends.');
    err.statusCode = 409;
    throw err;
  }
  if (Number(call.durationSeconds || 0) < 30) {
    const err = new Error('Feedback requires at least 30 seconds of call time.');
    err.statusCode = 400;
    throw err;
  }

  const skipped = Boolean(body.skipped);
  const matched = skipped ? null : Boolean(body.matched);
  const reasons = Array.isArray(body.reasons)
    ? body.reasons.map(item => String(item)).filter(Boolean).slice(0, 8)
    : [];
  const otherText = String(body.otherText || '').trim().slice(0, 500);

  call.identityFeedback = {
    matched,
    reasons: matched === false ? reasons : [],
    otherText: matched === false ? otherText : '',
    skipped,
    submittedAt: new Date(),
  };
  call.markModified('identityFeedback');
  await call.save();

  if (matched === false) {
    try {
      const adminCompliance = require('./adminCompliance.service');
      await adminCompliance.createIdentityMismatchReport(call, {
        reasons,
        otherText,
      });
    } catch (err) {
      console.error('[call.identityMismatchReport]', err.message || err);
    }
  }

  return publicCallHydrated(call);
}

module.exports = {
  startCall,
  startRandomCall,
  createCallbackCall,
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
  submitIdentityFeedback,
  sweepStaleActiveCalls,
  releaseReceiverForOnline,
  getBusyReceiverIds,
};
