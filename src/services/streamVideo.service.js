const jwt = require('jsonwebtoken');
const {config} = require('../config');

const CALL_TYPE = 'default';

function hasStreamCredentials() {
  return Boolean(
    String(config.streamApiKey || '').trim() &&
      String(config.streamApiSecret || '').trim(),
  );
}

/**
 * auto  → getstream when STREAM_API_KEY + STREAM_API_SECRET are set, else mock
 * mock  → always mock (local / Expo Go)
 * getstream → force GetStream (falls back to mock if credentials missing)
 */
function resolveVideoProvider() {
  const mode = String(config.videoCallProvider || 'auto')
    .trim()
    .toLowerCase();
  if (mode === 'mock') {
    return 'mock';
  }
  if (mode === 'getstream') {
    if (!hasStreamCredentials()) {
      console.warn(
        '[video] VIDEO_CALL_PROVIDER=getstream but STREAM_API_KEY/SECRET missing — using mock',
      );
      return 'mock';
    }
    return 'getstream';
  }
  return hasStreamCredentials() ? 'getstream' : 'mock';
}

function callCidFor(callId) {
  return `${CALL_TYPE}:${callId}`;
}

function createUserToken(userId, extra = {}) {
  if (!hasStreamCredentials()) {
    return null;
  }
  const uid = String(userId || '').trim();
  if (!uid) {
    return null;
  }
  return jwt.sign(
    {
      user_id: uid,
      ...extra,
    },
    config.streamApiSecret,
    {
      algorithm: 'HS256',
      expiresIn: config.streamTokenTtl || '6h',
    },
  );
}

function buildProviderPayload(callId) {
  const provider = resolveVideoProvider();
  if (provider !== 'getstream') {
    return {
      provider: 'mock',
      mode: 'mock',
    };
  }
  return {
    provider: 'getstream',
    mode: 'getstream',
    apiKey: config.streamApiKey,
    callType: CALL_TYPE,
    callId: String(callId),
    callCid: callCidFor(callId),
  };
}

/**
 * Attach a short-lived Stream user token for the authenticated participant.
 * Never put the API secret in this payload.
 */
function attachClientCredentials(publicCallRow, auth) {
  if (!publicCallRow || publicCallRow.provider !== 'getstream' || !auth) {
    return publicCallRow;
  }
  if (!hasStreamCredentials()) {
    return {
      ...publicCallRow,
      provider: 'mock',
      providerPayload: {mode: 'mock', provider: 'mock'},
    };
  }

  const userId =
    auth.role === 'receiver'
      ? String(auth.receiverId || '')
      : String(auth.userId || '');
  const snapshot =
    auth.role === 'receiver'
      ? publicCallRow.receiver || {}
      : publicCallRow.caller || {};

  const token = createUserToken(userId);
  return {
    ...publicCallRow,
    providerPayload: {
      ...(publicCallRow.providerPayload || {}),
      provider: 'getstream',
      mode: 'getstream',
      apiKey: config.streamApiKey,
      callType: CALL_TYPE,
      callId: String(publicCallRow.id),
      callCid: callCidFor(publicCallRow.id),
      userId,
      userName: String(snapshot.name || userId),
      userImage: snapshot.avatarUrl ? String(snapshot.avatarUrl) : undefined,
      token,
    },
  };
}

module.exports = {
  CALL_TYPE,
  hasStreamCredentials,
  resolveVideoProvider,
  callCidFor,
  createUserToken,
  buildProviderPayload,
  attachClientCredentials,
};
