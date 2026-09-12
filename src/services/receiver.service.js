const Receiver = require('../models/Receiver');
const storageService = require('./storage.service');
const bcrypt = require('bcryptjs');
const {vipProgress} = require('./leaderboard.service');

function genderLabel(gender) {
  if (!gender) return '';
  return gender.charAt(0).toUpperCase() + gender.slice(1);
}

const KYC_TITLES = {
  aadhaar: 'Aadhar Card',
  pan: 'Pan Card',
  passbook: 'Bank Passbook',
};

function plainDoc(doc) {
  if (!doc) return {};
  if (typeof doc.toObject === 'function') return doc.toObject();
  return doc;
}

function normalizePhotos(photos) {
  if (!Array.isArray(photos)) return [];
  return photos.map(url => storageService.toStorageUrl(url)).slice(0, 5);
}

function normalizeDocuments(documents) {
  if (!Array.isArray(documents)) return [];
  return documents
    .map(raw => {
      const doc = plainDoc(raw);
      const id = String(doc.id || '').trim();
      if (!id) return null;
      return {
        id,
        title: String(doc.title || KYC_TITLES[id] || id).trim(),
        sizeLabel: String(doc.sizeLabel || ''),
        url: storageService.toStorageUrl(doc.url || ''),
        thumbnail: storageService.toStorageUrl(doc.thumbnail || doc.url || ''),
      };
    })
    .filter(Boolean);
}

async function publicOnboardingReceiver(receiver) {
  const photos = await storageService.mapAccessUrls(
    Array.isArray(receiver.photos) ? receiver.photos : [],
  );
  const kyc = receiver.kyc || {};
  const bank = receiver.bank || {};
  const rawDocs = Array.isArray(kyc.documents) ? kyc.documents : [];
  const documents = await Promise.all(
    rawDocs.map(async raw => {
      const doc = plainDoc(raw);
      return {
        id: doc.id,
        title: doc.title || KYC_TITLES[doc.id] || doc.id,
        sizeLabel: doc.sizeLabel || '',
        url: await storageService.toAccessUrl(doc.url || ''),
        thumbnail: await storageService.toAccessUrl(doc.thumbnail || doc.url || ''),
      };
    }),
  );
  const videoUrl = await storageService.toAccessUrl(kyc.videoUrl || '');
  const videoThumb = await storageService.toAccessUrl(
    kyc.videoThumb || photos[0] || '',
  );
  const faceImageUrl = await storageService.toAccessUrl(
    kyc.faceImageUrl || videoThumb || '',
  );

  return {
    id: receiver.id,
    name: receiver.name,
    age: receiver.age,
    gender: genderLabel(receiver.gender),
    level: receiver.level,
    status: receiver.status,
    rejectionReason: receiver.rejectionReason || '',
    bio: receiver.bio || '',
    languages: receiver.languages || [],
    photos,
    bank: {
      holderName: bank.holderName || receiver.name,
      accountNumber: bank.accountNumber || '',
      ifsc: bank.ifsc || '',
      upiId: bank.upiId || '',
    },
    kyc: {
      videoUrl: videoUrl || '',
      videoThumb: videoThumb || '',
      faceImageUrl: faceImageUrl || '',
      documents,
    },
  };
}

async function findByOnboardingToken(token) {
  return Receiver.findOne({onboardingToken: token});
}

async function getOnboarding(token) {
  const receiver = await findByOnboardingToken(token);
  if (!receiver) {
    return {ok: false, message: 'Onboarding link not found.', status: 404};
  }
  return {ok: true, receiver};
}

async function saveOnboarding(token, payload = {}) {
  const receiver = await findByOnboardingToken(token);
  if (!receiver) {
    return {ok: false, message: 'Onboarding link not found.', status: 404};
  }
  if (!['pending_onboarding', 'draft'].includes(receiver.status)) {
    return {
      ok: false,
      message: 'Profile can no longer be edited from this link.',
      status: 400,
    };
  }

  if (typeof payload.bio === 'string') receiver.bio = payload.bio.trim();
  if (Array.isArray(payload.languages)) {
    receiver.languages = payload.languages
      .map(lang => String(lang || '').trim())
      .filter(Boolean)
      .slice(0, 3);
  }
  if (Array.isArray(payload.photos)) receiver.photos = normalizePhotos(payload.photos);
  if (payload.bank) {
    receiver.bank = {
      holderName: payload.bank.holderName || receiver.name,
      accountNumber: payload.bank.accountNumber || '',
      ifsc: payload.bank.ifsc || '',
      upiId: payload.bank.upiId || '',
    };
  }

  const nextKyc = {
    videoUrl: receiver.kyc?.videoUrl || '',
    videoThumb: receiver.kyc?.videoThumb || '',
    faceImageUrl: receiver.kyc?.faceImageUrl || '',
    documents: normalizeDocuments(receiver.kyc?.documents || []),
  };
  if (Array.isArray(payload.kyc?.documents)) {
    nextKyc.documents = normalizeDocuments(payload.kyc.documents);
  }
  if (payload.kyc?.videoUrl) {
    nextKyc.videoUrl = storageService.toStorageUrl(payload.kyc.videoUrl);
  }
  if (payload.kyc?.videoThumb) {
    nextKyc.videoThumb = storageService.toStorageUrl(payload.kyc.videoThumb);
  } else if (!nextKyc.videoThumb) {
    const photos = Array.isArray(payload.photos)
      ? normalizePhotos(payload.photos)
      : receiver.photos;
    nextKyc.videoThumb = photos[0] || '';
  }
  if (payload.kyc?.faceImageUrl) {
    nextKyc.faceImageUrl = storageService.toStorageUrl(payload.kyc.faceImageUrl);
  }

  // Video KYC only: block duplicate faces via Rekognition.
  if (payload.kyc?.videoUrl) {
    const faceDedup = require('./faceDedup.service');
    const check = await faceDedup.assertUniqueKycFace({
      receiver,
      imageUrl:
        nextKyc.faceImageUrl ||
        faceDedup.resolveFaceImageUrl(receiver, nextKyc),
    });
    if (!check.ok) {
      return {
        ok: false,
        message: check.message,
        status: check.status || 409,
      };
    }
    if (check.faceId) {
      receiver.faceId = check.faceId;
      receiver.faceIndexedAt = new Date();
    }
    if (check.faceImageUrl && !nextKyc.faceImageUrl) {
      nextKyc.faceImageUrl = check.faceImageUrl;
    }
  }

  receiver.kyc = nextKyc;

  if (receiver.status === 'draft') receiver.status = 'pending_onboarding';
  await receiver.save();
  return {ok: true, receiver};
}

function validateSubmission(receiver, payload) {
  const photos = payload.photos ?? receiver.photos ?? [];
  const languages = payload.languages ?? receiver.languages ?? [];
  const bio = (payload.bio ?? receiver.bio ?? '').trim();
  const bank = payload.bank ?? receiver.bank ?? {};
  const docs = Array.isArray(payload.kyc?.documents)
    ? payload.kyc.documents
    : receiver.kyc?.documents ?? [];
  const videoUrl = payload.kyc?.videoUrl || receiver.kyc?.videoUrl || '';

  if (!Array.isArray(photos) || photos.length < 3) {
    return 'Upload at least 3 profile photos.';
  }
  if (bio.length < 20) {
    return 'Bio must be at least 20 characters.';
  }
  if (!languages.length) {
    return 'Select at least one language.';
  }
  if (languages.length > 3) {
    return 'You can select a maximum of 3 languages.';
  }
  if (!bank.holderName?.trim() || !bank.accountNumber?.trim() || !bank.ifsc?.trim()) {
    return 'Complete bank account details.';
  }
  const required = ['aadhaar', 'pan', 'passbook'];
  const uploaded = new Set(
    docs.map(doc => (typeof doc?.toObject === 'function' ? doc.toObject().id : doc.id)),
  );
  if (!required.every(id => uploaded.has(id))) {
    return 'Upload all required KYC documents.';
  }
  if (!String(videoUrl).trim()) {
    return 'Record or upload a verification video.';
  }
  return null;
}

async function submitOnboarding(token, payload = {}) {
  const receiver = await findByOnboardingToken(token);
  if (!receiver) {
    return {ok: false, message: 'Onboarding link not found.', status: 404};
  }
  if (!['pending_onboarding', 'draft'].includes(receiver.status)) {
    return {
      ok: false,
      message: 'Profile already submitted.',
      status: 400,
    };
  }

  const merged = {
    bio: payload.bio ?? receiver.bio,
    languages: payload.languages ?? receiver.languages,
    photos: payload.photos ?? receiver.photos,
    bank: payload.bank ?? receiver.bank,
    kyc: {
      ...(receiver.kyc?.toObject?.() || receiver.kyc || {}),
      ...(payload.kyc || {}),
    },
  };

  const validationError = validateSubmission(receiver, merged);
  if (validationError) {
    return {ok: false, message: validationError, status: 400};
  }

  const photos = normalizePhotos(merged.photos);
  const documents = normalizeDocuments(merged.kyc.documents || []);
  const videoUrl = storageService.toStorageUrl(merged.kyc.videoUrl);
  const videoThumb = storageService.toStorageUrl(
    merged.kyc.videoThumb || photos[0] || '',
  );
  const faceImageUrl = storageService.toStorageUrl(
    merged.kyc.faceImageUrl || videoThumb || photos[0] || '',
  );

  // Final gate on submit: same face must not belong to another receiver.
  const faceDedup = require('./faceDedup.service');
  const check = await faceDedup.assertUniqueKycFace({
    receiver,
    imageUrl: faceImageUrl || faceDedup.resolveFaceImageUrl(receiver, merged.kyc),
  });
  if (!check.ok) {
    return {
      ok: false,
      message: check.message,
      status: check.status || 409,
    };
  }

  receiver.bio = String(merged.bio).trim();
  receiver.languages = (Array.isArray(merged.languages) ? merged.languages : [])
    .map(lang => String(lang || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  receiver.photos = photos;
  receiver.bank = {
    holderName: merged.bank.holderName.trim(),
    accountNumber: merged.bank.accountNumber.trim(),
    ifsc: merged.bank.ifsc.trim().toUpperCase(),
    upiId: merged.bank.upiId?.trim() || '',
  };
  receiver.kyc = {
    videoUrl,
    videoThumb,
    faceImageUrl: check.faceImageUrl || faceImageUrl || '',
    documents,
  };
  if (check.faceId) {
    receiver.faceId = check.faceId;
    receiver.faceIndexedAt = new Date();
  }
  receiver.status = 'pending_review';
  receiver.rejectionReason = '';
  receiver.submittedAt = new Date();
  await receiver.save();

  return {ok: true, receiver};
}

async function retryOnboarding(token) {
  const receiver = await findByOnboardingToken(token);
  if (!receiver) {
    return {ok: false, message: 'Onboarding link not found.', status: 404};
  }
  if (!['rejected', 'inactive'].includes(receiver.status)) {
    return {
      ok: false,
      message: 'Only rejected or terminated profiles can be resubmitted.',
      status: 400,
    };
  }

  receiver.status = 'pending_onboarding';
  receiver.rejectionReason = '';
  await receiver.save();
  return {ok: true, receiver};
}

function needsPasswordChange(receiver) {
  if (typeof receiver.mustChangePassword === 'boolean') {
    return receiver.mustChangePassword;
  }
  return Boolean(receiver.temporaryPassword);
}

/** Hours needed to complete the current level band (matches product UI). */
const LEVEL_HOUR_TARGETS = {
  1: 48,
  2: 168,
  3: 400,
};

const MAX_RECEIVER_LEVEL = 3;

/**
 * Bump receiver level when lifetime hours cross the current band target.
 * Emits a level_up notification when level increases.
 */
async function maybeLevelUpReceiver(receiverDoc) {
  if (!receiverDoc?.id) {
    return receiverDoc;
  }
  let level = Math.max(1, Number(receiverDoc.level) || 1);
  const hours = Math.max(0, Number(receiverDoc.totalHours) || 0);
  let leveled = false;
  while (level < MAX_RECEIVER_LEVEL) {
    const need = LEVEL_HOUR_TARGETS[level] || Number.POSITIVE_INFINITY;
    if (hours < need) {
      break;
    }
    level += 1;
    leveled = true;
  }
  if (!leveled || level === Number(receiverDoc.level)) {
    return receiverDoc;
  }
  receiverDoc.level = level;
  await receiverDoc.save();
  const notificationService = require('./notification.service');
  notificationService
    .notifyReceiverLevelUp({receiverId: receiverDoc.id, level})
    .catch(() => undefined);
  return receiverDoc;
}

function levelProgress(receiver) {
  const level = Number(receiver.level) || 1;
  const hoursDone = Math.max(0, Number(receiver.totalHours) || 0);
  const hoursTarget = LEVEL_HOUR_TARGETS[level] || LEVEL_HOUR_TARGETS[2];
  const levelProgressPct = Math.min(
    100,
    Math.round((hoursDone / Math.max(hoursTarget, 1)) * 100),
  );
  return {hoursDone, hoursTarget, levelProgressPct};
}

function buildBadges(receiver) {
  const level = Number(receiver.level) || 1;
  const followers = Math.max(0, Number(receiver.followers) || 0);
  const badges = [];
  if (level >= 2) {
    badges.push({id: 'expert', label: 'Expert', tone: 'expert'});
  }
  if (level >= 3 || Number(receiver.totalCalls) >= 100) {
    badges.push({id: 'top', label: 'Top 1%', tone: 'top'});
  }
  badges.push({
    id: 'followers',
    label: `${followers.toLocaleString('en-IN')} Followers`,
    tone: 'followers',
  });
  return badges;
}

function publicReceiverAuth(receiver) {
  const photos = Array.isArray(receiver.photos) ? receiver.photos : [];
  return {
    id: receiver.id,
    name: receiver.name,
    email: receiver.loginEmail || '',
    age: receiver.age,
    gender: genderLabel(receiver.gender),
    level: receiver.level,
    status: receiver.status,
    avatarUrl: photos[0] || '',
    mustChangePassword: needsPasswordChange(receiver),
  };
}

/** Full authenticated profile for receiver app (Profile + Edit Profile). */
async function publicReceiverAppProfile(receiver) {
  const rawPhotos = Array.isArray(receiver.photos) ? receiver.photos : [];
  const photos = await storageService.mapAccessUrls(rawPhotos);
  const progress = levelProgress(receiver);
  const followers = Math.max(0, Number(receiver.followers) || 0);
  const walletBalance = Math.max(0, Number(receiver.walletBalance) || 0);
  const pendingEarnings = Math.max(0, Number(receiver.pendingEarnings) || 0);
  const totalEarned = Math.max(
    0,
    Number(receiver.earnings) || walletBalance + pendingEarnings,
  );

  return {
    ...publicReceiverAuth(receiver),
    avatarUrl: photos[0] || '',
    bio: receiver.bio || '',
    languages: Array.isArray(receiver.languages) ? receiver.languages : [],
    photos,
    walletBalance,
    pendingEarnings,
    totalEarned,
    totalHours: progress.hoursDone,
    hoursDone: progress.hoursDone,
    hoursTarget: progress.hoursTarget,
    levelProgressPct: progress.levelProgressPct,
    totalCalls: Number(receiver.totalCalls) || 0,
    profileViews: Math.max(0, Number(receiver.profileViews) || 0),
    followers,
    isOnline: Boolean(receiver.isOnline),
    badges: buildBadges(receiver),
    vipProgress: vipProgress(receiver),
  };
}

async function updateProfile(receiverId, payload = {}) {
  const receiver = await findById(receiverId);
  if (!receiver) {
    return {ok: false, message: 'Receiver not found.', status: 404};
  }
  if (typeof payload.bio === 'string') {
    const bio = payload.bio.trim();
    if (bio.length > 250) {
      return {ok: false, message: 'Bio must be 250 characters or less.'};
    }
    receiver.bio = bio;
  }

  if (Array.isArray(payload.languages)) {
    const languages = payload.languages
      .map(lang => String(lang || '').trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!languages.length) {
      return {ok: false, message: 'Select at least one language.'};
    }
    receiver.languages = languages;
  }

  if (Array.isArray(payload.photos)) {
    const photos = normalizePhotos(payload.photos);
    if (photos.length < 3) {
      return {ok: false, message: 'Upload at least 3 profile photos.'};
    }
    if (photos.length > 5) {
      return {ok: false, message: 'You can upload a maximum of 5 photos.'};
    }
    receiver.photos = photos;
  }

  await receiver.save();
  return {ok: true, receiver};
}

async function setOnlineStatus(receiverId, isOnline) {
  const receiver = await findById(receiverId);
  if (!receiver) {
    return {ok: false, message: 'Receiver not found.', status: 404};
  }
  if (receiver.status !== 'active') {
    return {
      ok: false,
      message: 'Only active receivers can go online.',
      status: 400,
    };
  }

  const nextOnline = Boolean(isOnline);
  const wasOnline = Boolean(receiver.isOnline);

  if (nextOnline && !wasOnline) {
    receiver.onlineStartedAt = new Date();
  } else if (!nextOnline && wasOnline) {
    try {
      const leaderboardService = require('./leaderboard.service');
      await leaderboardService.accumulateOnlineSession(receiver);
    } catch (err) {
      console.error('[receiver.online.accumulate]', err.message || err);
      receiver.onlineStartedAt = null;
    }
  }

  receiver.isOnline = nextOnline;
  await receiver.save();
  // Clear leftover ringing/connected rows so caller feed cannot stick on Busy.
  // Always force-close: toggle is from dashboard/profile, not an in-call UI.
  try {
    const callService = require('./call.service');
    await callService.releaseReceiverForOnline(receiver.id, {force: true});
  } catch (err) {
    console.error('[receiver.online.releaseCalls]', err.message || err);
  }
  try {
    const callQueueService = require('./callQueue.service');
    if (receiver.isOnline) {
      callQueueService.scheduleProcessQueue(receiver.id, 5_000);
    } else {
      callQueueService.cancelScheduledProcess(receiver.id);
    }
  } catch (err) {
    console.error('[receiver.online.queue]', err.message || err);
  }
  try {
    const chatService = require('./chat.service');
    await chatService.broadcastPresenceForUser(
      'receiver',
      receiver.id,
      Boolean(receiver.isOnline),
    );
  } catch (err) {
    console.error('[receiver.online.presence]', err.message || err);
  }
  if (receiver.isOnline) {
    const notificationService = require('./notification.service');
    notificationService
      .notifyFollowersReceiverOnline(receiver)
      .catch(err =>
        console.error('[receiver.online.notify]', err.message || err),
      );
  }
  return {ok: true, receiver};
}

async function logout(receiverId) {
  const receiver = await findById(receiverId);
  if (!receiver) {
    return {ok: false, message: 'Receiver not found.', status: 404};
  }
  if (receiver.isOnline) {
    try {
      const leaderboardService = require('./leaderboard.service');
      await leaderboardService.accumulateOnlineSession(receiver);
    } catch {
      receiver.onlineStartedAt = null;
    }
  }
  receiver.isOnline = false;
  await receiver.save();
  try {
    const callQueueService = require('./callQueue.service');
    callQueueService.cancelScheduledProcess(receiver.id);
  } catch {
    /* ignore */
  }
  try {
    const chatService = require('./chat.service');
    await chatService.broadcastPresenceForUser('receiver', receiver.id, false);
  } catch {
    /* ignore */
  }
  return {ok: true, receiver};
}

async function findByLoginEmail(email) {
  return Receiver.findOne({loginEmail: String(email || '').toLowerCase().trim()});
}

async function findById(id) {
  return Receiver.findOne({id});
}

async function login(email, password) {
  const receiver = await findByLoginEmail(email);
  if (!receiver || !receiver.passwordHash) {
    return {ok: false, message: 'Invalid email or password.'};
  }

  const match = await bcrypt.compare(String(password || ''), receiver.passwordHash);
  if (!match) {
    return {ok: false, message: 'Invalid email or password.'};
  }

  return {ok: true, receiver};
}

async function updatePassword(receiverId, newPassword, currentPassword) {
  if (!newPassword || String(newPassword).length < 8) {
    return {ok: false, message: 'Password must be at least 8 characters.'};
  }

  const receiver = await findById(receiverId);
  if (!receiver) {
    return {ok: false, message: 'Receiver not found.', status: 404};
  }

  const requiresCurrent =
    !needsPasswordChange(receiver) && Boolean(receiver.passwordHash);
  if (requiresCurrent) {
    if (!currentPassword) {
      return {ok: false, message: 'Current password is required.'};
    }
    const match = await bcrypt.compare(
      String(currentPassword),
      receiver.passwordHash,
    );
    if (!match) {
      return {ok: false, message: 'Current password is incorrect.'};
    }
  }

  receiver.passwordHash = await bcrypt.hash(String(newPassword), 10);
  receiver.temporaryPassword = '';
  receiver.mustChangePassword = false;
  await receiver.save();
  return {ok: true, receiver};
}

function defaultNotificationPreferences() {
  return {
    incomingCallAlerts: true,
    callReminderAlerts: false,
    withdrawalUpdates: true,
    earningsUpdates: true,
    paymentNotifications: true,
  };
}

function publicNotificationPreferences(receiver) {
  const prefs = receiver.notificationPreferences || {};
  const defaults = defaultNotificationPreferences();
  return {
    incomingCallAlerts:
      typeof prefs.incomingCallAlerts === 'boolean'
        ? prefs.incomingCallAlerts
        : defaults.incomingCallAlerts,
    callReminderAlerts:
      typeof prefs.callReminderAlerts === 'boolean'
        ? prefs.callReminderAlerts
        : defaults.callReminderAlerts,
    withdrawalUpdates:
      typeof prefs.withdrawalUpdates === 'boolean'
        ? prefs.withdrawalUpdates
        : defaults.withdrawalUpdates,
    earningsUpdates:
      typeof prefs.earningsUpdates === 'boolean'
        ? prefs.earningsUpdates
        : defaults.earningsUpdates,
    paymentNotifications:
      typeof prefs.paymentNotifications === 'boolean'
        ? prefs.paymentNotifications
        : defaults.paymentNotifications,
  };
}

async function getNotificationPreferences(receiverId) {
  const receiver = await findById(receiverId);
  if (!receiver) {
    return {ok: false, message: 'Receiver not found.', status: 404};
  }
  return {ok: true, preferences: publicNotificationPreferences(receiver)};
}

async function updateNotificationPreferences(receiverId, payload = {}) {
  const receiver = await findById(receiverId);
  if (!receiver) {
    return {ok: false, message: 'Receiver not found.', status: 404};
  }

  const current = publicNotificationPreferences(receiver);
  const next = {...current};
  for (const key of Object.keys(defaultNotificationPreferences())) {
    if (typeof payload[key] === 'boolean') {
      next[key] = payload[key];
    }
  }
  receiver.notificationPreferences = next;
  await receiver.save();
  return {ok: true, preferences: next};
}

async function requestAccountDeletion(receiverId, reason = '') {
  const receiver = await findById(receiverId);
  if (!receiver) {
    return {ok: false, message: 'Receiver not found.', status: 404};
  }
  const trimmed = String(reason || '').trim();
  if (!trimmed) {
    return {ok: false, message: 'Please select a reason for deletion.'};
  }
  receiver.deletionRequestedAt = new Date();
  receiver.deletionReason = trimmed.slice(0, 200);
  receiver.isOnline = false;
  await receiver.save();
  return {ok: true, receiver};
}

/**
 * Caller-facing identity: proxy when enabled, else real profile.
 * Receiver app / agent real profile stay unchanged.
 */
async function getCallerFacingIdentity(receiver) {
  const plain = plainDoc(receiver);
  const proxy = plain.proxyProfile || {};
  const enabled = Boolean(proxy.enabled);
  const proxyName = String(proxy.name || '').trim();
  const proxyPhotos = Array.isArray(proxy.photos)
    ? proxy.photos.filter(Boolean)
    : [];
  const realPhotos = Array.isArray(plain.photos) ? plain.photos.filter(Boolean) : [];

  const name = enabled && proxyName ? proxyName : plain.name || 'Receiver';
  const proxyBio = String(proxy.bio || '').trim();
  const bio =
    enabled && proxyBio
      ? proxyBio
      : String(plain.bio || '').trim();
  const rawPhotos = enabled && proxyPhotos.length ? proxyPhotos : realPhotos;
  const photos = await storageService.mapAccessUrls(rawPhotos);
  const videoUrlRaw = enabled && proxy.videoUrl ? proxy.videoUrl : '';
  const videoThumbRaw =
    enabled && proxy.videoThumb
      ? proxy.videoThumb
      : photos[0] || '';
  const [videoUrl, videoThumb] = await Promise.all([
    videoUrlRaw ? storageService.toAccessUrl(videoUrlRaw) : Promise.resolve(''),
    videoThumbRaw ? storageService.toAccessUrl(videoThumbRaw) : Promise.resolve(''),
  ]);

  return {
    name,
    bio,
    photos,
    imageUrl: photos[0] || '',
    videoUrl: videoUrl || '',
    videoThumb: videoThumb || photos[0] || '',
    usingProxy: Boolean(
      enabled && (proxyName || proxyBio || proxyPhotos.length || videoUrlRaw),
    ),
  };
}

module.exports = {
  getCallerFacingIdentity,
  publicOnboardingReceiver,
  publicReceiverAuth,
  publicReceiverAppProfile,
  getOnboarding,
  saveOnboarding,
  submitOnboarding,
  retryOnboarding,
  findByLoginEmail,
  findById,
  login,
  updatePassword,
  updateProfile,
  setOnlineStatus,
  logout,
  getNotificationPreferences,
  updateNotificationPreferences,
  requestAccountDeletion,
  maybeLevelUpReceiver,
  LEVEL_HOUR_TARGETS,
};
