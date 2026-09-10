const Call = require('../models/Call');
const Receiver = require('../models/Receiver');

/** Ideal = actual engagement today ≤ 1.5 hours. */
const IDEAL_MAX_MINUTES = 90;
/** Continuous non-idle (busy) window before profile-call failover. */
const BUSY_FAILOVER_MS = 30 * 60 * 1000;
const ACTIVE_STATUSES = ['ringing', 'accepted', 'connected'];

function istDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Reset daily engagement counters when the IST calendar day changes.
 * Mutates receiver doc; caller should save when needed.
 */
function ensureDailyEngagement(receiver, now = new Date()) {
  if (!receiver) {
    return receiver;
  }
  const today = istDateKey(now);
  const stored = String(receiver.dailyEngagementDate || '');
  if (stored !== today) {
    receiver.dailyEngagementDate = today;
    receiver.dailyEngagementMinutes = 0;
  }
  return receiver;
}

function liveOnlineMinutes(receiver, now = new Date()) {
  if (!receiver?.isOnline || !receiver.onlineStartedAt) {
    return 0;
  }
  const started = new Date(receiver.onlineStartedAt).getTime();
  if (!Number.isFinite(started)) {
    return 0;
  }
  return Math.max(0, Math.floor((now.getTime() - started) / 60_000));
}

/**
 * Today's engagement = stored daily minutes + current online session.
 * Talk minutes are added into dailyEngagementMinutes at call end.
 */
function effectiveEngagementMinutes(receiver, now = new Date()) {
  ensureDailyEngagement(receiver, now);
  return (
    Math.max(0, Number(receiver.dailyEngagementMinutes) || 0) +
    liveOnlineMinutes(receiver, now)
  );
}

function isIdealProfile(receiver, now = new Date()) {
  return effectiveEngagementMinutes(receiver, now) <= IDEAL_MAX_MINUTES;
}

async function addDailyEngagementMinutes(receiverId, minutes) {
  const add = Math.max(0, Math.round(Number(minutes) || 0));
  if (!receiverId || add <= 0) {
    return;
  }
  const receiver = await Receiver.findOne({id: receiverId});
  if (!receiver) {
    return;
  }
  ensureDailyEngagement(receiver);
  receiver.dailyEngagementMinutes =
    Math.max(0, Number(receiver.dailyEngagementMinutes) || 0) + add;
  await receiver.save();
}

/**
 * Mark receiver non-idle (busy). Keeps original timestamp across back-to-back calls.
 */
async function markReceiverBusy(receiverId, at = new Date()) {
  if (!receiverId) {
    return;
  }
  await Receiver.updateOne(
    {
      id: receiverId,
      $or: [{busyStartedAt: null}, {busyStartedAt: {$exists: false}}],
    },
    {$set: {busyStartedAt: at}},
  );
}

async function clearReceiverBusyIfIdle(receiverId) {
  if (!receiverId) {
    return;
  }
  const active = await Call.exists({
    receiverId,
    status: {$in: ACTIVE_STATUSES},
  });
  if (!active) {
    await Receiver.updateOne(
      {id: receiverId},
      {$set: {busyStartedAt: null}},
    );
  }
}

async function continuousBusyMs(receiverId, now = new Date()) {
  if (!receiverId) {
    return 0;
  }
  const receiver = await Receiver.findOne({id: receiverId})
    .select('busyStartedAt')
    .lean();
  let started = receiver?.busyStartedAt
    ? new Date(receiver.busyStartedAt).getTime()
    : NaN;

  if (!Number.isFinite(started)) {
    const active = await Call.findOne({
      receiverId,
      status: {$in: ACTIVE_STATUSES},
    })
      .sort({startedAt: 1, ringingAt: 1, createdAt: 1})
      .select('startedAt ringingAt createdAt')
      .lean();
    if (!active) {
      return 0;
    }
    started = new Date(
      active.startedAt || active.ringingAt || active.createdAt,
    ).getTime();
  }

  if (!Number.isFinite(started)) {
    return 0;
  }
  return Math.max(0, now.getTime() - started);
}

async function isReceiverIdle(receiverId, {busyIds, connectedIds} = {}) {
  const id = String(receiverId || '');
  if (!id) {
    return false;
  }
  if (busyIds instanceof Set && busyIds.has(id)) {
    return false;
  }
  if (connectedIds instanceof Set && !connectedIds.has(id)) {
    return false;
  }
  if (!(busyIds instanceof Set)) {
    const busy = await Call.exists({
      receiverId: id,
      status: {$in: ACTIVE_STATUSES},
    });
    if (busy) {
      return false;
    }
  }
  return true;
}

/**
 * Pick a random idle receiver in the same coin level.
 * @param {{nonIdealOnly?: boolean, excludeId?: string, callerId?: string}} opts
 */
async function pickIdleSameLevelReceiver(
  level,
  {nonIdealOnly = false, excludeId = '', callerId = ''} = {},
) {
  const n = Number(level) || 3;
  const candidates = await Receiver.find({
    status: 'active',
    isOnline: true,
    level: n,
    ...(excludeId ? {id: {$ne: excludeId}} : {}),
  })
    .select(
      'id level isOnline onlineStartedAt dailyEngagementMinutes dailyEngagementDate photos',
    )
    .lean();

  if (!candidates.length) {
    return null;
  }

  const busyRows = await Call.find({status: {$in: ACTIVE_STATUSES}})
    .select('receiverId')
    .lean();
  const busyIds = new Set(busyRows.map(row => String(row.receiverId)));

  let blockedIds = new Set();
  if (callerId) {
    try {
      const ChatBlock = require('../models/ChatBlock');
      const blocks = await ChatBlock.find({
        $or: [
          {
            blockerRole: 'caller',
            blockerId: callerId,
            blockedRole: 'receiver',
          },
          {
            blockerRole: 'receiver',
            blockedRole: 'caller',
            blockedId: callerId,
          },
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
  }

  const {getConnectedReceiverIds} = require('../realtime/io');
  const connectedIds = getConnectedReceiverIds();
  const now = new Date();

  const idle = candidates.filter(row => {
    const id = String(row.id);
    if (busyIds.has(id) || blockedIds.has(id)) {
      return false;
    }
    if (connectedIds instanceof Set && !connectedIds.has(id)) {
      return false;
    }
    if (nonIdealOnly && isIdealProfile(row, now)) {
      return false;
    }
    return true;
  });

  if (!idle.length) {
    return null;
  }

  const pick = idle[Math.floor(Math.random() * idle.length)];
  return pick?.id || null;
}

module.exports = {
  IDEAL_MAX_MINUTES,
  BUSY_FAILOVER_MS,
  istDateKey,
  ensureDailyEngagement,
  effectiveEngagementMinutes,
  isIdealProfile,
  addDailyEngagementMinutes,
  markReceiverBusy,
  clearReceiverBusyIfIdle,
  continuousBusyMs,
  isReceiverIdle,
  pickIdleSameLevelReceiver,
};
