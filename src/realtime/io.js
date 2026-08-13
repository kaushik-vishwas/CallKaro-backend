/** Shared Socket.IO instance + live presence sets for chat/online indicators. */

let ioInstance = null;

/** @type {Map<string, Set<string>>} callerId -> socketIds */
const callerSockets = new Map();
/** @type {Map<string, Set<string>>} receiverId -> socketIds */
const receiverSockets = new Map();

/** @type {Map<string, number>} `${role}:${id}` -> lastSeenMs */
const lastSeenAt = new Map();

const PRESENCE_TTL_MS = 120_000;

/** Throttle DB writes for presence (ms). */
const DB_PRESENCE_WRITE_TTL_MS = 15_000;
/** @type {Map<string, number>} */
const lastDbWriteAt = new Map();

function setIo(io) {
  ioInstance = io;
}

function getIo() {
  return ioInstance;
}

function presenceKey(role, userId) {
  return `${role}:${String(userId || '').trim()}`;
}

function touchPresence(role, userId) {
  const id = String(userId || '').trim();
  if (!id) {
    return;
  }
  lastSeenAt.set(presenceKey(role, id), Date.now());
  // Persist occasionally so REST chat lists stay accurate across restarts.
  const key = presenceKey(role, id);
  const lastWrite = lastDbWriteAt.get(key) || 0;
  if (Date.now() - lastWrite < DB_PRESENCE_WRITE_TTL_MS) {
    return;
  }
  lastDbWriteAt.set(key, Date.now());
  const now = new Date();
  setImmediate(() => {
    try {
      if (role === 'caller') {
        const Caller = require('../models/Caller');
        Caller.updateOne({id}, {$set: {chatLastSeenAt: now}}).catch(() => undefined);
      } else if (role === 'receiver') {
        const Receiver = require('../models/Receiver');
        Receiver.updateOne({id}, {$set: {chatLastSeenAt: now}}).catch(
          () => undefined,
        );
      }
    } catch {
      /* ignore */
    }
  });
}

function wasRecentlySeen(role, userId) {
  const ts = lastSeenAt.get(presenceKey(role, userId));
  if (!ts) {
    return false;
  }
  return Date.now() - ts < PRESENCE_TTL_MS;
}

function isDbRecentlySeen(date) {
  if (!date) {
    return false;
  }
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) {
    return false;
  }
  return Date.now() - t < PRESENCE_TTL_MS;
}

function markConnected(role, userId, socketId) {
  const id = String(userId || '').trim();
  const sid = String(socketId || '').trim();
  if (!id || !sid) {
    return;
  }
  const map = role === 'caller' ? callerSockets : receiverSockets;
  let set = map.get(id);
  if (!set) {
    set = new Set();
    map.set(id, set);
  }
  set.add(sid);
  touchPresence(role, id);
}

/**
 * @returns {boolean} true if the user still has another connected socket
 */
function markDisconnected(role, userId, socketId) {
  const id = String(userId || '').trim();
  const sid = String(socketId || '').trim();
  const map = role === 'caller' ? callerSockets : receiverSockets;
  const set = map.get(id);
  if (!set) {
    return false;
  }
  set.delete(sid);
  if (set.size === 0) {
    map.delete(id);
    // Keep lastSeen briefly so a quick reconnect doesn't flash offline.
    return false;
  }
  return true;
}

function collectRoomIds(prefix) {
  const ids = new Set();
  const io = ioInstance;
  if (!io?.sockets?.adapter?.rooms) {
    return ids;
  }
  for (const [roomName, room] of io.sockets.adapter.rooms.entries()) {
    if (
      typeof roomName === 'string' &&
      roomName.startsWith(prefix) &&
      room &&
      room.size > 0
    ) {
      ids.add(roomName.slice(prefix.length));
    }
  }
  return ids;
}

function isCallerConnected(callerId) {
  const id = String(callerId || '').trim();
  const set = callerSockets.get(id);
  if (set && set.size > 0) {
    return true;
  }
  if (collectRoomIds('caller:').has(id)) {
    return true;
  }
  return wasRecentlySeen('caller', id);
}

function isReceiverConnected(receiverId) {
  const id = String(receiverId || '').trim();
  const set = receiverSockets.get(id);
  if (set && set.size > 0) {
    return true;
  }
  if (collectRoomIds('receiver:').has(id)) {
    return true;
  }
  return wasRecentlySeen('receiver', id);
}

/** Receiver IDs that currently have at least one connected socket. */
function getConnectedReceiverIds() {
  const ids = new Set(receiverSockets.keys());
  for (const id of collectRoomIds('receiver:')) {
    ids.add(id);
  }
  for (const [key, ts] of lastSeenAt.entries()) {
    if (
      key.startsWith('receiver:') &&
      Date.now() - ts < PRESENCE_TTL_MS
    ) {
      ids.add(key.slice('receiver:'.length));
    }
  }
  return ids;
}

/** Caller IDs with at least one connected socket. */
function getConnectedCallerIds() {
  const ids = new Set(callerSockets.keys());
  for (const id of collectRoomIds('caller:')) {
    ids.add(id);
  }
  for (const [key, ts] of lastSeenAt.entries()) {
    if (key.startsWith('caller:') && Date.now() - ts < PRESENCE_TTL_MS) {
      ids.add(key.slice('caller:'.length));
    }
  }
  return ids;
}

module.exports = {
  setIo,
  getIo,
  markConnected,
  markDisconnected,
  touchPresence,
  isCallerConnected,
  isReceiverConnected,
  isDbRecentlySeen,
  getConnectedReceiverIds,
  getConnectedCallerIds,
};
