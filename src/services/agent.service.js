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

function publicReceiverListItem(receiver) {
  return {
    id: receiver.id,
    name: receiver.name,
    level: receiver.level,
    status: STATUS_LABEL[receiver.status] || 'Inactive',
    statusKey: receiver.status,
    totalHours: receiver.totalHours || 0,
    earnings: receiver.earnings || 0,
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
  if (typeof avatarUrl === 'string') agent.avatarUrl = avatarUrl;
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

  let receivers = await Receiver.find(filter).sort({createdAt: -1}).lean();

  if (q && String(q).trim()) {
    const needle = String(q).trim().toLowerCase();
    receivers = receivers.filter(
      r =>
        r.name.toLowerCase().includes(needle) ||
        r.id.toLowerCase().includes(needle),
    );
  }

  return receivers.map(publicReceiverListItem);
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

async function listPending(agentId) {
  const receivers = await Receiver.find({
    agentId,
    status: 'pending_review',
  })
    .sort({submittedAt: -1, updatedAt: -1})
    .lean();
  return receivers.map(publicPendingRow);
}

async function approveReceiver(agentId, receiverId) {
  const receiver = await getReceiverForAgent(agentId, receiverId);
  if (!receiver) return {ok: false, message: 'Receiver not found.', status: 404};
  if (receiver.status !== 'pending_review') {
    return {
      ok: false,
      message: 'Only receivers pending review can be approved.',
      status: 400,
    };
  }
  receiver.status = 'active';
  receiver.activatedAt = new Date();
  receiver.rejectionReason = '';
  await receiver.save();
  return {ok: true, receiver};
}

async function rejectReceiver(agentId, receiverId, reason) {
  if (!reason || !String(reason).trim()) {
    return {ok: false, message: 'Rejection reason is required.', status: 400};
  }
  const receiver = await getReceiverForAgent(agentId, receiverId);
  if (!receiver) return {ok: false, message: 'Receiver not found.', status: 404};
  if (receiver.status !== 'pending_review') {
    return {
      ok: false,
      message: 'Only receivers pending review can be rejected.',
      status: 400,
    };
  }
  receiver.status = 'rejected';
  receiver.rejectionReason = String(reason).trim();
  await receiver.save();
  return {ok: true, receiver};
}

async function requestChanges(agentId, receiverId, note) {
  const receiver = await getReceiverForAgent(agentId, receiverId);
  if (!receiver) return {ok: false, message: 'Receiver not found.', status: 404};
  if (receiver.status !== 'pending_review') {
    return {
      ok: false,
      message: 'Only receivers pending review can be sent back.',
      status: 400,
    };
  }
  receiver.status = 'pending_onboarding';
  receiver.rejectionReason = note ? String(note).trim() : 'Changes requested';
  await receiver.save();
  return {ok: true, receiver};
}

async function setReceiverStatus(agentId, receiverId, status, reason = '') {
  if (!['active', 'inactive'].includes(status)) {
    return {ok: false, message: 'Status must be active or inactive.', status: 400};
  }
  const receiver = await getReceiverForAgent(agentId, receiverId);
  if (!receiver) return {ok: false, message: 'Receiver not found.', status: 404};
  receiver.status = status;
  if (status === 'inactive') {
    receiver.rejectionReason =
      String(reason || '').trim() ||
      receiver.rejectionReason ||
      'Profile terminated by agent.';
  }
  if (status === 'active') {
    receiver.rejectionReason = '';
    receiver.activatedAt = receiver.activatedAt || new Date();
  }
  await receiver.save();
  return {ok: true, receiver};
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

module.exports = {
  publicAgent,
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
  getReceiverForAgent,
  getReceiverStats,
  listPending,
  approveReceiver,
  rejectReceiver,
  requestChanges,
  setReceiverStatus,
  getCredentials,
  listCredentialReceivers,
  submitForReview,
  buildOnboardingLink,
};
