const CallQueue = require('../models/CallQueue');
const Caller = require('../models/Caller');
const Receiver = require('../models/Receiver');
const Call = require('../models/Call');
const {getIo} = require('../realtime/io');

function isVipActive(caller) {
  return Boolean(
    caller?.vipExpiresAt && new Date(caller.vipExpiresAt).getTime() > Date.now(),
  );
}

function waitLabel(createdAt) {
  const ms = Date.now() - new Date(createdAt).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 1) return 'Waited just now';
  if (mins === 1) return 'Waited 1 Min ago';
  if (mins < 60) return `Waited ${mins} Mins ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return 'Waited 1 Hour ago';
  if (hours < 24) return `Waited ${hours} Hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Waited 1 Day ago' : `Waited ${days} Days ago`;
}

function publicQueueItem(row, rank) {
  return {
    id: row.id,
    callerId: row.callerId,
    receiverId: row.receiverId,
    reason: row.reason,
    status: row.status,
    isVip: Boolean(row.isVip),
    name: row.callerSnapshot?.name || 'Caller',
    avatarUrl: row.callerSnapshot?.avatarUrl || '',
    level: Number(row.callerSnapshot?.level || 1),
    waitedLabel: waitLabel(row.createdAt),
    createdAt: row.createdAt,
    rank: rank || 0,
    callId: row.callId || null,
  };
}

function emitQueueUpdate(receiverId, payload) {
  try {
    const io = getIo();
    io.to(`receiver:${receiverId}`).emit('queue:update', {
      receiverId,
      ...payload,
    });
  } catch {
    /* socket optional */
  }
}

async function requestCallback(auth, {receiverId, reason} = {}) {
  if (auth.role !== 'caller') {
    return {ok: false, message: 'Only callers can request a callback.', status: 403};
  }
  const rid = String(receiverId || '').trim();
  if (!rid) {
    return {ok: false, message: 'receiverId is required.'};
  }
  const why = reason === 'busy' ? 'busy' : 'offline';

  const [caller, receiver] = await Promise.all([
    Caller.findOne({id: auth.userId}),
    Receiver.findOne({id: rid}),
  ]);
  if (!caller) {
    return {ok: false, message: 'Caller not found.', status: 404};
  }
  if (!receiver || receiver.status !== 'active') {
    return {ok: false, message: 'Receiver is not available.', status: 404};
  }

  // Prefer an existing open queue row (waiting or mid-callback).
  const existing = await CallQueue.findOne({
    callerId: auth.userId,
    receiverId: rid,
    status: {$in: ['waiting', 'calling']},
  });
  if (existing) {
    if (existing.status === 'waiting' && existing.reason !== why) {
      existing.reason = why;
      await existing.save();
    }
    maybeScheduleIfReceiverAvailable(rid);
    return {
      ok: true,
      alreadyQueued: true,
      entry: publicQueueItem(existing, 0),
      reason: existing.reason,
    };
  }

  const vip = isVipActive(caller);
  let entry;
  try {
    entry = await CallQueue.create({
      callerId: auth.userId,
      receiverId: rid,
      reason: why,
      isVip: vip,
      status: 'waiting',
      callerSnapshot: {
        name: caller.name || 'Caller',
        avatarUrl: caller.avatarUrl || caller.profile || '',
        level: Number(caller.level || 1),
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      const again = await CallQueue.findOne({
        callerId: auth.userId,
        receiverId: rid,
        status: {$in: ['waiting', 'calling']},
      });
      if (again) {
        maybeScheduleIfReceiverAvailable(rid);
        return {
          ok: true,
          alreadyQueued: true,
          entry: publicQueueItem(again, 0),
          reason: again.reason,
        };
      }
    }
    throw error;
  }

  emitQueueUpdate(rid, {
    type: 'joined',
    entry: publicQueueItem(entry, 0),
  });

  // If receiver is already free+online, start auto-callback shortly.
  maybeScheduleIfReceiverAvailable(rid);

  return {
    ok: true,
    alreadyQueued: false,
    entry: publicQueueItem(entry, 0),
    reason: why,
  };
}

async function cancelCallback(auth, entryId) {
  if (auth.role !== 'caller') {
    return {ok: false, message: 'Only callers can cancel a callback.', status: 403};
  }
  const entry = await CallQueue.findOne({
    id: entryId,
    callerId: auth.userId,
    status: {$in: ['waiting', 'calling']},
  });
  if (!entry) {
    return {ok: false, message: 'Queue entry not found.', status: 404};
  }
  entry.status = 'cancelled';
  entry.callId = null;
  await entry.save();

  emitQueueUpdate(entry.receiverId, {
    type: 'left',
    entryId: entry.id,
  });

  return {ok: true};
}

/**
 * VIP first, then oldest. Includes in-progress callback rings.
 */
async function listQueueForReceiver(auth, {limit = 50} = {}) {
  if (auth.role !== 'receiver') {
    return {ok: false, message: 'Only receivers can view the queue.', status: 403};
  }
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const rows = await CallQueue.find({
    receiverId: auth.receiverId,
    status: {$in: ['waiting', 'calling']},
  })
    .sort({isVip: -1, createdAt: 1})
    .limit(take)
    .lean();

  const items = rows.map((row, index) => publicQueueItem(row, index + 1));
  return {
    ok: true,
    items,
    totalWaiting: items.length,
    vipWaiting: items.filter(i => i.isVip).length,
  };
}

/** When the caller dials the receiver themselves, clear their waiting row. */
async function fulfillQueueEntry(callerId, receiverId) {
  const rows = await CallQueue.find({
    callerId,
    receiverId,
    status: {$in: ['waiting', 'calling']},
  })
    .select('id receiverId')
    .lean();
  if (!rows.length) {
    return;
  }
  await CallQueue.updateMany(
    {callerId, receiverId, status: {$in: ['waiting', 'calling']}},
    {$set: {status: 'fulfilled', callId: null}},
  );
  for (const row of rows) {
    emitQueueUpdate(row.receiverId, {type: 'left', entryId: row.id});
  }
}

async function isReceiverBusy(receiverId) {
  const active = await Call.findOne({
    receiverId,
    status: {$in: ['ringing', 'accepted', 'connected']},
  }).lean();
  return Boolean(active);
}

async function isReceiverAvailable(receiverId) {
  const rid = String(receiverId || '').trim();
  if (!rid) {
    return false;
  }
  const receiver = await Receiver.findOne({id: rid})
    .select('isOnline status')
    .lean();
  if (!receiver || receiver.status !== 'active' || receiver.isOnline !== true) {
    return false;
  }
  const {isReceiverConnected} = require('../realtime/io');
  if (!isReceiverConnected(rid)) {
    return false;
  }
  if (await isReceiverBusy(rid)) {
    return false;
  }
  return true;
}

function maybeScheduleIfReceiverAvailable(receiverId) {
  isReceiverAvailable(receiverId)
    .then(ok => {
      if (ok) {
        scheduleProcessQueue(receiverId, 5_000);
      }
    })
    .catch(() => undefined);
}

/** Debounced auto-callback when receiver becomes free / online. */
const processTimers = new Map();
const processingReceivers = new Set();

function cancelScheduledProcess(receiverId) {
  const id = String(receiverId || '').trim();
  if (!id) {
    return;
  }
  const timer = processTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    processTimers.delete(id);
  }
}

function scheduleProcessQueue(receiverId, delayMs = 5_000) {
  const id = String(receiverId || '').trim();
  if (!id) {
    return;
  }
  cancelScheduledProcess(id);
  const timer = setTimeout(() => {
    processTimers.delete(id);
    processNextCallback(id).catch(err =>
      console.error('[queue.processNext]', err.message || err),
    );
  }, Math.max(0, Number(delayMs) || 0));
  processTimers.set(id, timer);
}

/**
 * Dial next waiting caller (VIP first). Keep row in queue as "calling"
 * until the call attempt finishes — then remove and dial the next.
 */
async function processNextCallback(receiverId) {
  const rid = String(receiverId || '').trim();
  if (!rid || processingReceivers.has(rid)) {
    return {ok: false, reason: 'busy_processing'};
  }
  processingReceivers.add(rid);
  try {
    if (!(await isReceiverAvailable(rid))) {
      return {ok: false, reason: 'unavailable'};
    }

    // Never start another callback while one is already ringing/connecting.
    const alreadyCalling = await CallQueue.findOne({
      receiverId: rid,
      status: 'calling',
    }).lean();
    if (alreadyCalling) {
      return {ok: false, reason: 'already_calling'};
    }

    const entry = await CallQueue.findOneAndUpdate(
      {receiverId: rid, status: 'waiting'},
      {$set: {status: 'calling'}},
      {sort: {isVip: -1, createdAt: 1}, new: true},
    );

    if (!entry) {
      return {ok: true, reason: 'empty'};
    }

    emitQueueUpdate(rid, {
      type: 'calling',
      entryId: entry.id,
      entry: publicQueueItem(entry, 1),
    });

    const callService = require('./call.service');
    let call;
    try {
      call = await callService.createCallbackCall(entry.callerId, rid, {
        queueId: entry.id,
      });
    } catch (error) {
      const code = error?.code || '';
      const status = error?.statusCode || 0;
      // Permanent skip — remove and continue to next.
      if (
        status === 402 ||
        status === 404 ||
        code === 'caller_blocked' ||
        code === 'insufficient_coins'
      ) {
        entry.status = 'cancelled';
        entry.callId = null;
        await entry.save();
        emitQueueUpdate(rid, {type: 'left', entryId: entry.id});
        scheduleProcessQueue(rid, 1_000);
        return {ok: false, reason: 'skipped', error: error.message};
      }

      // Transient — put back to waiting so they do not vanish.
      entry.status = 'waiting';
      entry.callId = null;
      await entry.save();
      emitQueueUpdate(rid, {
        type: 'joined',
        entry: publicQueueItem(entry, 1),
      });
      return {ok: false, reason: 'retry', error: error.message};
    }

    const callId = call?.id || null;
    entry.callId = callId;
    entry.status = 'calling';
    await entry.save();

    try {
      const io = getIo();
      io.to(`caller:${entry.callerId}`).emit('callback:started', {
        ...(typeof call === 'object' ? call : {}),
        queueId: entry.id,
        isCallback: true,
      });
    } catch {
      /* ignore */
    }

    emitQueueUpdate(rid, {
      type: 'calling',
      entryId: entry.id,
      callId,
      entry: publicQueueItem(entry, 1),
    });

    return {ok: true, call, entry: publicQueueItem(entry, 1)};
  } finally {
    processingReceivers.delete(rid);
  }
}

/**
 * After a callback call ends / misses / rejects — remove that queue row
 * and schedule the next priority waiter.
 */
async function completeCallbackAttempt(call) {
  if (!call) {
    return;
  }
  const queueId = call.providerPayload?.queueId
    ? String(call.providerPayload.queueId)
    : null;
  const callerId = call.callerId;
  const receiverId = call.receiverId;

  let entry = null;
  if (queueId) {
    entry = await CallQueue.findOne({
      id: queueId,
      status: {$in: ['calling', 'waiting']},
    });
  }
  if (!entry && callerId && receiverId) {
    entry = await CallQueue.findOne({
      callerId,
      receiverId,
      status: 'calling',
    });
  }
  if (!entry) {
    return;
  }

  entry.status = 'fulfilled';
  entry.callId = null;
  await entry.save();
  emitQueueUpdate(entry.receiverId, {type: 'left', entryId: entry.id});

  scheduleProcessQueue(entry.receiverId, 5_000);
}

module.exports = {
  requestCallback,
  cancelCallback,
  listQueueForReceiver,
  fulfillQueueEntry,
  isReceiverBusy,
  isReceiverAvailable,
  publicQueueItem,
  isVipActive,
  scheduleProcessQueue,
  cancelScheduledProcess,
  processNextCallback,
  completeCallbackAttempt,
  maybeScheduleIfReceiverAvailable,
};
