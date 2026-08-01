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
  if (mins < 1) return 'Just now';
  if (mins === 1) return '1 min';
  if (mins < 60) return `${mins} mins`;
  const hours = Math.floor(mins / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
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
  };
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

  const existing = await CallQueue.findOne({
    callerId: auth.userId,
    receiverId: rid,
    status: 'waiting',
  });
  if (existing) {
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
        status: 'waiting',
      });
      if (again) {
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

  try {
    const io = getIo();
    io.to(`receiver:${rid}`).emit('queue:update', {
      receiverId: rid,
      type: 'joined',
      entry: publicQueueItem(entry, 0),
    });
  } catch {
    /* socket optional */
  }

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
    status: 'waiting',
  });
  if (!entry) {
    return {ok: false, message: 'Queue entry not found.', status: 404};
  }
  entry.status = 'cancelled';
  await entry.save();

  try {
    const io = getIo();
    io.to(`receiver:${entry.receiverId}`).emit('queue:update', {
      receiverId: entry.receiverId,
      type: 'left',
      entryId: entry.id,
    });
  } catch {
    /* ignore */
  }

  return {ok: true};
}

/**
 * VIP first, then oldest waiting.
 */
async function listQueueForReceiver(auth, {limit = 50} = {}) {
  if (auth.role !== 'receiver') {
    return {ok: false, message: 'Only receivers can view the queue.', status: 403};
  }
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const rows = await CallQueue.find({
    receiverId: auth.receiverId,
    status: 'waiting',
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

async function fulfillQueueEntry(callerId, receiverId) {
  await CallQueue.updateMany(
    {callerId, receiverId, status: 'waiting'},
    {$set: {status: 'fulfilled'}},
  );
}

async function isReceiverBusy(receiverId) {
  const active = await Call.findOne({
    receiverId,
    status: {$in: ['ringing', 'accepted', 'connected']},
  }).lean();
  return Boolean(active);
}

module.exports = {
  requestCallback,
  cancelCallback,
  listQueueForReceiver,
  fulfillQueueEntry,
  isReceiverBusy,
  publicQueueItem,
  isVipActive,
};
