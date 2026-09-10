const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {v4: uuidv4} = require('uuid');
const {config} = require('../config');
const Agent = require('../models/Agent');
const Receiver = require('../models/Receiver');
const storageService = require('./storage.service');

const STATUS_LABEL = {
  draft: 'Inactive',
  pending_onboarding: 'Inactive',
  pending_review: 'Pending Review',
  active: 'Active',
  inactive: 'Inactive',
  rejected: 'Inactive',
};

function publicAgent(agent) {
  return {
    id: agent.id,
    email: agent.email,
    name: agent.name,
    phone: agent.phone || '',
    agentCode: agent.agentCode,
    avatarUrl: agent.avatarUrl || '',
    earnings: Number(agent.earnings || 0),
  };
}

async function publicAgentHydrated(agent) {
  const base = publicAgent(agent);
  if (!base.avatarUrl) return base;
  return {
    ...base,
    avatarUrl: await storageService.toAccessUrl(base.avatarUrl),
  };
}

function formatSubmittedAgo(date) {
  if (!date) return '';
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
}

function genderLabel(gender) {
  if (!gender) return '';
  return gender.charAt(0).toUpperCase() + gender.slice(1);
}

function onboardingBaseUrl() {
  return (config.onboardingBaseUrl || 'http://localhost:5174').replace(/\/$/, '');
}

function buildOnboardingLink(token, name) {
  const slug = slugFromName(name);
  return `${onboardingBaseUrl()}/useregistration/${slug}?token=${encodeURIComponent(token)}`;
}

function slugFromName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24) || 'receiver';
}

function generateTempPassword(name) {
  const slug = slugFromName(name);
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${slug}@${suffix}`;
}

function generateLoginEmail(name, id) {
  const slug = slugFromName(name);
  const short = String(id).replace(/[^a-zA-Z0-9]/g, '').slice(-4).toLowerCase();
  return `${slug}.${short}@callkaro.com`;
}

function publicReceiverListItem(receiver, rank = null) {
  const hours = Number(receiver.totalHours) || 0;
  return {
    id: receiver.id,
    name: receiver.name,
    level: receiver.level,
    status: STATUS_LABEL[receiver.status] || 'Inactive',
    statusKey: receiver.status,
    totalHours: Number(hours.toFixed(2)),
    earnings: receiver.earnings || 0,
    rank: rank == null ? null : Number(rank),
  };
}

async function publicReceiverProfile(receiver) {
  const rawPhotos = Array.isArray(receiver.photos) ? receiver.photos : [];
  const photos = await storageService.mapAccessUrls(rawPhotos);
  const kyc = receiver.kyc || {};
  const bank = receiver.bank || {};
  const rawDocs = Array.isArray(kyc.documents) ? kyc.documents : [];
  const documents = await Promise.all(
    rawDocs.map(async raw => {
      const doc = typeof raw?.toObject === 'function' ? raw.toObject() : raw;
      return {
        id: doc.id,
        title: doc.title,
        sizeLabel: doc.sizeLabel || '',
        url: await storageService.toAccessUrl(doc.url || ''),
        thumbnail: await storageService.toAccessUrl(doc.thumbnail || doc.url || ''),
      };
    }),
  );
  const videoThumb = await storageService.toAccessUrl(
    kyc.videoThumb || rawPhotos[0] || '',
  );
  const videoUrl = await storageService.toAccessUrl(kyc.videoUrl || '');

  const proxy = receiver.proxyProfile || {};
  const proxyPhotosRaw = Array.isArray(proxy.photos) ? proxy.photos : [];
  const proxyPhotos = await storageService.mapAccessUrls(proxyPhotosRaw);
  const proxyVideoUrl = await storageService.toAccessUrl(proxy.videoUrl || '');
  const proxyVideoThumb = await storageService.toAccessUrl(
    proxy.videoThumb || proxyPhotosRaw[0] || '',
  );

  return {
    ...publicReceiverListItem(receiver),
    age: receiver.age,
    gender: genderLabel(receiver.gender),
    bio: receiver.bio || '',
    languages: receiver.languages || [],
    photos,
    photoCount: photos.length,
    submittedAgo: formatSubmittedAgo(receiver.submittedAt || receiver.updatedAt),
    onboardingLink: buildOnboardingLink(receiver.onboardingToken, receiver.name),
    bank: {
      holderName: bank.holderName || '',
      accountNumber: bank.accountNumber || '',
      ifsc: bank.ifsc || '',
      upiId: bank.upiId || '',
    },
    kyc: {
      videoThumb: videoThumb || '',
      videoUrl: videoUrl || '',
      documents,
    },
    proxyProfile: {
      enabled: Boolean(proxy.enabled),
      name: proxy.name || '',
      bio: proxy.bio || '',
      photos: proxyPhotos,
      videoUrl: proxyVideoUrl || '',
      videoThumb: proxyVideoThumb || '',
    },
  };
}

function publicPendingRow(receiver) {
  const photos = Array.isArray(receiver.photos) ? receiver.photos : [];
  return {
    id: receiver.id,
    name: receiver.name,
    photoCount: photos.length,
    submittedAgo: formatSubmittedAgo(receiver.submittedAt || receiver.updatedAt),
  };
}

async function findAgentByEmail(email) {
  return Agent.findOne({email: String(email).toLowerCase()});
}

async function findAgentById(id) {
  return Agent.findOne({id});
}

async function login(email, password) {
  const agent = await findAgentByEmail(email);
  if (!agent || !agent.isActive) {
    return {ok: false, message: 'Invalid email or password.'};
  }
  const match = await bcrypt.compare(password, agent.passwordHash);
  if (!match) {
    return {ok: false, message: 'Invalid email or password.'};
  }
  return {ok: true, agent};
}

async function updateProfile(agentId, {name, phone, avatarUrl}) {
  const agent = await findAgentById(agentId);
  if (!agent) return null;
  if (typeof name === 'string' && name.trim()) agent.name = name.trim();
  if (typeof phone === 'string') agent.phone = phone.trim();
  if (typeof avatarUrl === 'string') {
    agent.avatarUrl = storageService.toStorageUrl(avatarUrl) || avatarUrl;
  }
  await agent.save();
  return agent;
}

async function updatePassword(agentId, currentPassword, newPassword) {
  const agent = await findAgentById(agentId);
  if (!agent) return {ok: false, message: 'Agent not found.'};
  const match = await bcrypt.compare(currentPassword, agent.passwordHash);
  if (!match) return {ok: false, message: 'Current password is incorrect.'};
  agent.passwordHash = await bcrypt.hash(newPassword, 10);
  await agent.save();
  return {ok: true, agent};
}

async function createReceiver(agentId, {name, age, gender, level, asDraft = false}) {
  const ageNum = Number(age);
  const levelNum = Number(level);

  if (!name || !String(name).trim()) {
    return {ok: false, message: 'Receiver name is required.'};
  }
  if (!Number.isFinite(ageNum) || ageNum < 18 || ageNum > 80) {
    return {ok: false, message: 'Age must be between 18 and 80.'};
  }
  if (!['male', 'female', 'other'].includes(gender)) {
    return {ok: false, message: 'Gender must be male, female, or other.'};
  }
  if (![1, 2, 3].includes(levelNum)) {
    return {ok: false, message: 'Level must be 1, 2, or 3.'};
  }

  const id = `RCV-${uuidv4().slice(0, 8).toUpperCase()}`;
  const onboardingToken = crypto.randomBytes(16).toString('hex');
  const loginEmail = generateLoginEmail(name, id);
  const temporaryPassword = generateTempPassword(name);
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  const receiver = await Receiver.create({
    id,
    agentId,
    name: String(name).trim(),
    age: ageNum,
    gender,
    level: levelNum,
    status: asDraft ? 'draft' : 'pending_onboarding',
    onboardingToken,
    loginEmail,
    temporaryPassword,
    passwordHash,
    mustChangePassword: true,
  });

  return {
    ok: true,
    receiver,
    onboardingLink: buildOnboardingLink(onboardingToken, name),
  };
}

async function listReceivers(agentId, {status, q} = {}) {
  const filter = {agentId};

  if (status === 'Active') filter.status = 'active';
  else if (status === 'Inactive') {
    filter.status = {
      $in: ['inactive', 'pending_onboarding', 'draft', 'rejected'],
    };
  } else if (status === 'Pending Review') filter.status = 'pending_review';

  let receivers = await Receiver.find(filter).lean();

  if (q && String(q).trim()) {
    const needle = String(q).trim().toLowerCase();
    receivers = receivers.filter(
      r =>
        r.name.toLowerCase().includes(needle) ||
        r.id.toLowerCase().includes(needle),
    );
  }

  const {scoreOf} = require('./leaderboard.service');
  receivers = [...receivers].sort((a, b) => {
    const scoreDiff = scoreOf(b) - scoreOf(a);
    if (scoreDiff !== 0) return scoreDiff;
    const earningsDiff = (Number(b.earnings) || 0) - (Number(a.earnings) || 0);
    if (earningsDiff !== 0) return earningsDiff;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return receivers.map((receiver, index) =>
    publicReceiverListItem(receiver, index + 1),
  );
}

async function listPendingApprovals(agentId) {
  const receivers = await Receiver.find({
    agentId,
    status: 'pending_review',
  })
    .sort({submittedAt: -1, updatedAt: -1})
    .lean();
  return receivers.map(publicPendingRow);
}

async function getReceiverForAgent(agentId, receiverId) {
  return Receiver.findOne({id: receiverId, agentId});
}

async function getReceiverStats(agentId) {
  const receivers = await Receiver.find({agentId}).lean();
  const total = receivers.length;
  const active = receivers.filter(r => r.status === 'active').length;
  const totalCalls = receivers.reduce((sum, r) => sum + (r.totalCalls || 0), 0);
  const totalEarnings = receivers.reduce((sum, r) => sum + (r.earnings || 0), 0);

  return {
    total,
    active,
    totalCalls,
    totalEarnings,
    stats: [
      {id: 'total', label: 'Total Receivers', value: String(total)},
      {id: 'active', label: 'Active', value: String(active)},
      {
        id: 'calls',
        label: 'Total Calls',
        value: totalCalls.toLocaleString('en-IN'),
      },
      {
        id: 'earnings',
        label: 'Total Earnings',
        value: `₹${totalEarnings.toLocaleString('en-IN')}`,
      },
    ],
  };
}

async function getCredentials(agentId, receiverId) {
  const receiver = await getReceiverForAgent(agentId, receiverId);
  if (!receiver) return {ok: false, message: 'Receiver not found.', status: 404};
  if (!['active', 'pending_review', 'pending_onboarding'].includes(receiver.status)) {
    return {
      ok: false,
      message: 'Credentials are not available for this receiver.',
      status: 400,
    };
  }
  return {
    ok: true,
    data: {
      id: receiver.id,
      name: receiver.name,
      loginId: receiver.loginEmail,
      temporaryPassword: receiver.temporaryPassword,
    },
  };
}

async function listCredentialReceivers(agentId) {
  const receivers = await Receiver.find({
    agentId,
    status: {$in: ['active', 'pending_review', 'pending_onboarding']},
  })
    .sort({updatedAt: -1})
    .lean();

  return receivers.map(r => ({
    id: r.id,
    name: r.name,
    level: r.level,
    status: STATUS_LABEL[r.status] || 'Inactive',
    statusKey: r.status,
  }));
}

/**
 * Agent-managed caller-facing proxy (privacy alias).
 * Real receiver profile used by receiver app stays unchanged.
 */
async function updateProxyProfile(agentId, receiverId, payload = {}) {
  const receiver = await getReceiverForAgent(agentId, receiverId);
  if (!receiver) return {ok: false, message: 'Receiver not found.', status: 404};

  if (!receiver.proxyProfile) {
    receiver.proxyProfile = {
      enabled: false,
      name: '',
      bio: '',
      photos: [],
      videoUrl: '',
      videoThumb: '',
    };
  }

  if (typeof payload.enabled === 'boolean') {
    receiver.proxyProfile.enabled = payload.enabled;
  }
  if (payload.name !== undefined) {
    receiver.proxyProfile.name = String(payload.name || '')
      .trim()
      .slice(0, 80);
  }
  if (payload.bio !== undefined) {
    receiver.proxyProfile.bio = String(payload.bio || '')
      .trim()
      .slice(0, 250);
  }
  if (Array.isArray(payload.photos)) {
    receiver.proxyProfile.photos = payload.photos
      .map(url => storageService.toStorageUrl(url))
      .filter(Boolean)
      .slice(0, 5);
  }
  if (payload.videoUrl !== undefined) {
    receiver.proxyProfile.videoUrl =
      storageService.toStorageUrl(payload.videoUrl || '') || '';
  }
  if (payload.videoThumb !== undefined) {
    receiver.proxyProfile.videoThumb =
      storageService.toStorageUrl(payload.videoThumb || '') || '';
  }

  if (receiver.proxyProfile.enabled) {
    if (!String(receiver.proxyProfile.name || '').trim()) {
      return {
        ok: false,
        message: 'Proxy display name is required when enabled.',
        status: 400,
      };
    }
    if (
      !Array.isArray(receiver.proxyProfile.photos) ||
      !receiver.proxyProfile.photos.length
    ) {
      return {
        ok: false,
        message: 'At least one proxy photo is required when enabled.',
        status: 400,
      };
    }
  }

  receiver.markModified('proxyProfile');
  await receiver.save();
  return {ok: true, receiver};
}

/**
 * Demo helper: fill profile fields and move to pending_review
 * (simulates receiver completing onboarding).
 */
async function submitForReview(agentId, receiverId, payload = {}) {
  const receiver = await getReceiverForAgent(agentId, receiverId);
  if (!receiver) return {ok: false, message: 'Receiver not found.', status: 404};

  if (payload.bio) receiver.bio = String(payload.bio);
  if (Array.isArray(payload.languages)) receiver.languages = payload.languages;
  if (Array.isArray(payload.photos)) receiver.photos = payload.photos;
  if (payload.bank) {
    receiver.bank = {
      holderName: payload.bank.holderName || receiver.name,
      accountNumber: payload.bank.accountNumber || '',
      ifsc: payload.bank.ifsc || '',
      upiId: payload.bank.upiId || '',
    };
  }
  if (payload.kyc) {
    receiver.kyc = {
      videoUrl: payload.kyc.videoUrl || '',
      videoThumb: payload.kyc.videoThumb || (receiver.photos[0] || ''),
      documents: Array.isArray(payload.kyc.documents) ? payload.kyc.documents : [],
    };
  }

  if (!receiver.bio) {
    receiver.bio =
      'Friendly conversationalist who loves music, travel stories, and helping people unwind.';
  }
  if (!receiver.languages?.length) {
    receiver.languages = ['Hindi', 'English'];
  }
  if (!receiver.photos?.length) {
    receiver.photos = [
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop',
      'https://images.unsplash.com/photo-1529626455594-64432c78bfcd?w=200&h=200&fit=crop',
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop',
    ];
  }
  if (!receiver.bank?.accountNumber) {
    receiver.bank = {
      holderName: receiver.name,
      accountNumber: 'XXXXXX4821',
      ifsc: 'HDFC0001234',
      upiId: `${slugFromName(receiver.name)}@upi`,
    };
  }
  if (!receiver.kyc?.documents?.length) {
    const thumb =
      'https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=120&h=160&fit=crop';
    receiver.kyc = {
      videoUrl: '',
      videoThumb: receiver.photos[0],
      documents: [
        {id: 'aadhaar', title: 'Aadhaar Card', sizeLabel: '523 kb', thumbnail: thumb, url: ''},
        {id: 'pan', title: 'PAN Card', sizeLabel: '412 kb', thumbnail: thumb, url: ''},
        {id: 'passbook', title: 'Bank Passbook', sizeLabel: '680 kb', thumbnail: thumb, url: ''},
      ],
    };
  }

  receiver.status = 'pending_review';
  receiver.submittedAt = new Date();
  await receiver.save();
  return {ok: true, receiver};
}

async function getAgentAnalytics(agentId) {
  const Call = require('../models/Call');
  const receivers = await Receiver.find({agentId}).lean();
  const receiverIds = receivers.map(r => r.id);

  const total = receivers.length;
  const pending = receivers.filter(r => r.status === 'pending_review').length;
  const approved = receivers.filter(r => r.status === 'active').length;
  const activeOnline = receivers.filter(
    r => r.status === 'active' && r.isOnline,
  ).length;
  const totalCalls = receivers.reduce(
    (sum, r) => sum + (Number(r.totalCalls) || 0),
    0,
  );
  const callHours = receivers.reduce(
    (sum, r) => sum + (Number(r.totalHours) || 0),
    0,
  );

  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCMonth(start.getUTCMonth() - 11);

  let monthlyMap = new Map();
  if (receiverIds.length) {
    const rows = await Call.aggregate([
      {
        $match: {
          receiverId: {$in: receiverIds},
          createdAt: {$gte: start},
        },
      },
      {
        $group: {
          _id: {$dateToString: {format: '%Y-%m', date: '$createdAt'}},
          value: {$sum: 1},
        },
      },
    ]);
    monthlyMap = new Map(rows.map(r => [r._id, Number(r.value) || 0]));

    // Fallback: new receivers per month if no calls yet
    if (![...monthlyMap.values()].some(v => v > 0)) {
      const created = await Receiver.aggregate([
        {$match: {agentId, createdAt: {$gte: start}}},
        {
          $group: {
            _id: {$dateToString: {format: '%Y-%m', date: '$createdAt'}},
            value: {$sum: 1},
          },
        },
      ]);
      monthlyMap = new Map(created.map(r => [r._id, Number(r.value) || 0]));
    }
  }

  const monthlyTrend = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(start);
    d.setUTCMonth(start.getUTCMonth() + i);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    monthlyTrend.push({
      month: d.toLocaleString('en-US', {month: 'short'}),
      value: monthlyMap.get(key) || 0,
    });
  }

  const {scoreOf} = require('./leaderboard.service');
  const topPerformers = [...receivers]
    .sort((a, b) => {
      const scoreDiff = scoreOf(b) - scoreOf(a);
      if (scoreDiff !== 0) return scoreDiff;
      return (Number(b.earnings) || 0) - (Number(a.earnings) || 0);
    })
    .slice(0, 10)
    .map((receiver, index) => publicReceiverListItem(receiver, index + 1));

  return {
    stats: [
      {
        id: 'total',
        label: 'Total Receivers',
        value: total.toLocaleString('en-IN'),
      },
      {
        id: 'pending',
        label: 'Pending Profiles',
        value: pending.toLocaleString('en-IN'),
      },
      {
        id: 'approved',
        label: 'Approved Receivers',
        value: approved.toLocaleString('en-IN'),
      },
      {
        id: 'active',
        label: 'Online Now',
        value: activeOnline.toLocaleString('en-IN'),
      },
      {
        id: 'calls',
        label: 'Total Calls',
        value: totalCalls.toLocaleString('en-IN'),
      },
      {
        id: 'hours',
        label: 'Call Hours',
        value: Number(callHours || 0).toLocaleString('en-IN', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }),
      },
    ],
    monthlyTrend,
    topPerformers,
  };
}

module.exports = {
  publicAgent,
  publicAgentHydrated,
  publicReceiverListItem,
  publicReceiverProfile,
  publicPendingRow,
  findAgentByEmail,
  findAgentById,
  login,
  updateProfile,
  updatePassword,
  createReceiver,
  listReceivers,
  listPendingApprovals,
  getReceiverForAgent,
  getReceiverStats,
  getAgentAnalytics,
  getCredentials,
  listCredentialReceivers,
  updateProxyProfile,
  submitForReview,
  buildOnboardingLink,
};
