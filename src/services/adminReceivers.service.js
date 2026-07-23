const Receiver = require('../models/Receiver');
const Agent = require('../models/Agent');
const storageService = require('./storage.service');

const COMMISSION_RATE = 0.4;
const REVENUE_MULTIPLIER = 2.5;

function formatDateLabel(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatRelative(date) {
  if (!date) return '—';
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 0) return 'Just now';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  return formatDateLabel(date);
}

function formatInrCompact(value) {
  const n = Number(value) || 0;
  if (n >= 10000000) return `₹ ${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹ ${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹ ${(n / 1000).toFixed(1)}K`;
  return `₹ ${n.toLocaleString('en-IN')}`;
}

function genderLabel(gender) {
  if (!gender) return '';
  return gender.charAt(0).toUpperCase() + gender.slice(1);
}

function mapUiStatus(status) {
  if (status === 'active') return 'active';
  if (status === 'rejected') return 'blocked';
  return 'inactive';
}

function mapReviewStatus(status) {
  if (status === 'active') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (status === 'pending_review') return 'pending';
  return 'incomplete';
}

function receiverCode(receiver) {
  const raw = String(receiver.id || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-4)
    .toUpperCase();
  // Prefer readable sample IDs like RCV-SAMPLE1 → #RV01 style when possible
  if (String(receiver.id || '').startsWith('RCV-')) {
    const tail = String(receiver.id).replace(/[^0-9]/g, '').slice(-2);
    return `#RV${tail.padStart(2, '0') || '00'}`;
  }
  return `#RV${raw || '0000'}`;
}

/**
 * Presence is not stored — soft proxy: active + updated within 2h ≈ online.
 */
function derivePresence(receiver) {
  if (receiver.status !== 'active') return 'offline';
  const updated = receiver.updatedAt ? new Date(receiver.updatedAt).getTime() : 0;
  if (Date.now() - updated <= 2 * 60 * 60 * 1000) return 'online';
  return 'offline';
}

function moneyFromEarnings(earnings) {
  const e = Number(earnings) || 0;
  return {
    earnings: e,
    revenue: Math.round(e * REVENUE_MULTIPLIER),
    coinsEarned: Math.round(e * 1.25),
    agentCommission: Math.round(e * COMMISSION_RATE),
  };
}

async function loadAgentsMap(agentIds) {
  const unique = [...new Set(agentIds.filter(Boolean))];
  if (!unique.length) return new Map();
  const agents = await Agent.find({id: {$in: unique}})
    .select('id name agentCode')
    .lean();
  return new Map(agents.map(a => [a.id, a]));
}

function toListItem(receiver, agent, rank, topPerformer) {
  const money = moneyFromEarnings(receiver.earnings);
  const agentCode = agent?.agentCode
    ? agent.agentCode.startsWith('#')
      ? agent.agentCode
      : `#${agent.agentCode}`
    : '';

  return {
    id: receiver.id,
    code: receiverCode(receiver),
    name: receiver.name || '',
    phone: '', // not on schema — placeholder
    email: receiver.loginEmail || '',
    location: '', // not on schema — placeholder
    gender: genderLabel(receiver.gender),
    languages: Array.isArray(receiver.languages) ? receiver.languages : [],
    joinedAt: formatDateLabel(receiver.createdAt),
    agentName: agent?.name || '—',
    agentCode,
    agentId: receiver.agentId || '',
    agentCommission: money.agentCommission,
    calls: receiver.totalCalls || 0,
    coinsEarned: money.coinsEarned,
    revenue: money.revenue,
    earnings: money.earnings,
    rank,
    status: mapUiStatus(receiver.status),
    statusKey: receiver.status,
    presence: derivePresence(receiver),
    topPerformer: Boolean(topPerformer),
    createdAt: receiver.createdAt,
    updatedAt: receiver.updatedAt,
  };
}

async function listReceivers({
  q = '',
  tab = 'all',
  page = 1,
  limit = 10,
  dateFrom,
  dateTo,
} = {}) {
  const filter = {};

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  if (tab === 'blocked') {
    filter.status = 'rejected';
  }

  const query = String(q || '').trim();
  if (query) {
    const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      {name: rx},
      {loginEmail: rx},
      {id: rx},
      {agentId: rx},
    ];
  }

  const all = await Receiver.find(filter).sort({earnings: -1, createdAt: -1}).lean();
  const agentsMap = await loadAgentsMap(all.map(r => r.agentId));

  const earningsCutoff =
    all[Math.max(0, Math.ceil(all.length * 0.25) - 1)]?.earnings || 0;

  let items = all.map((receiver, index) => {
    const topPerformer =
      (receiver.earnings || 0) > 0 &&
      (receiver.earnings || 0) >= earningsCutoff;
    return toListItem(
      receiver,
      agentsMap.get(receiver.agentId),
      index + 1,
      topPerformer,
    );
  });

  if (tab === 'online') {
    items = items.filter(item => item.presence === 'online');
  } else if (tab === 'offline') {
    items = items.filter(item => item.presence === 'offline');
  } else if (tab === 'top') {
    items = items.filter(item => item.topPerformer);
  }

  // Re-rank after tab filter for display consistency
  items = items.map((item, index) => ({...item, rank: index + 1}));

  const total = items.length;
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 10));
  const start = (pageNum - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    receivers: pageItems,
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function getReceiverStats() {
  const [totalReceivers, blocked, active, earningsAgg] = await Promise.all([
    Receiver.countDocuments(),
    Receiver.countDocuments({status: 'rejected'}),
    Receiver.find({status: 'active'}).select('id updatedAt earnings').lean(),
    Receiver.aggregate([
      {
        $group: {
          _id: null,
          totalEarnings: {$sum: {$ifNull: ['$earnings', 0]}},
        },
      },
    ]),
  ]);

  const onlineNow = active.filter(r => derivePresence(r) === 'online').length;
  const offline = Math.max(0, totalReceivers - onlineNow);
  const totalEarnings = earningsAgg[0]?.totalEarnings || 0;
  const totalRevenue = Math.round(totalEarnings * REVENUE_MULTIPLIER);

  return {
    totalReceivers,
    onlineNow,
    offline,
    blocked,
    totalRevenue,
    totalEarnings,
    // Withdrawals not modeled — soft placeholders from earnings split
    earningsPaid: Math.round(totalEarnings * 0.66),
    pendingWd: Math.round(totalEarnings * 0.1),
    totalRevenueLabel: formatInrCompact(totalRevenue),
    earningsPaidLabel: formatInrCompact(Math.round(totalEarnings * 0.66)),
    pendingWdLabel: formatInrCompact(Math.round(totalEarnings * 0.1)),
  };
}

async function buildKycPayload(receiver) {
  const kyc = receiver.kyc || {};
  const bank = receiver.bank || {};
  const rawPhotos = Array.isArray(receiver.photos) ? receiver.photos : [];
  const photos = await storageService.mapAccessUrls(rawPhotos);
  const rawDocs = Array.isArray(kyc.documents) ? kyc.documents : [];
  const documents = await Promise.all(
    rawDocs.map(async raw => {
      const doc = typeof raw?.toObject === 'function' ? raw.toObject() : raw;
      return {
        id: doc.id,
        title: doc.title,
        sizeLabel: doc.sizeLabel || '',
        url: await storageService.toAccessUrl(doc.url || ''),
        thumbnail: await storageService.toAccessUrl(
          doc.thumbnail || doc.url || '',
        ),
      };
    }),
  );

  return {
    receiverId: receiver.id,
    submitted: receiver.submittedAt
      ? formatRelative(receiver.submittedAt)
      : formatRelative(receiver.createdAt),
    reviewStatus: mapReviewStatus(receiver.status),
    age: receiver.age || 0,
    level: receiver.level || 1,
    bio: receiver.bio || '',
    photos,
    bank: {
      holderName: bank.holderName || receiver.name || '',
      accountNumber: bank.accountNumber || '',
      ifsc: bank.ifsc || '',
      upiId: bank.upiId || '',
    },
    documents,
    videoThumb: await storageService.toAccessUrl(
      kyc.videoThumb || rawPhotos[0] || '',
    ),
    videoUrl: await storageService.toAccessUrl(kyc.videoUrl || ''),
  };
}

async function getReceiverDetail(id) {
  const receiver = await Receiver.findOne({id}).lean();
  if (!receiver) return {ok: false, message: 'Receiver not found.'};

  const ranked = await Receiver.find({})
    .select('id earnings')
    .sort({earnings: -1})
    .lean();
  const rank = Math.max(1, ranked.findIndex(r => r.id === receiver.id) + 1);
  const earningsCutoff =
    ranked[Math.max(0, Math.ceil(ranked.length * 0.25) - 1)]?.earnings || 0;
  const topPerformer =
    (receiver.earnings || 0) > 0 &&
    (receiver.earnings || 0) >= earningsCutoff;

  const agentsMap = await loadAgentsMap([receiver.agentId]);
  const agent = agentsMap.get(receiver.agentId);
  const listItem = toListItem(receiver, agent, rank, topPerformer);
  const money = moneyFromEarnings(receiver.earnings);
  const availableBalance = Math.round(money.earnings * 0.34);
  const withdrawnAmount = Math.round(money.earnings * 0.66);

  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    months.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      month: d.toLocaleString('en-US', {month: 'short'}),
      value: 0,
    });
  }
  const created = new Date(receiver.createdAt || Date.now());
  const key = `${created.getFullYear()}-${created.getMonth()}`;
  const bucket = months.find(m => m.key === key);
  if (bucket) bucket.value = money.revenue;

  const trendSum = months.reduce((s, m) => s + m.value, 0);
  const revenueTrend = months.map((m, index) => ({
    month: m.month,
    value:
      trendSum > 0
        ? m.value
        : Math.round((money.revenue / 6) * (0.5 + index * 0.12)),
  }));

  const kyc = await buildKycPayload(receiver);

  return {
    ok: true,
    receiver: {
      ...listItem,
      availableBalance,
      withdrawnAmount,
      performance: {
        // Soft placeholders from available metrics
        callsThisMonth: Math.round((receiver.totalCalls || 0) * 0.14),
        completed: Math.round((receiver.totalCalls || 0) * 0.85),
        missed: Math.round((receiver.totalCalls || 0) * 0.1),
        onlineHours: receiver.totalHours || 0,
      },
      revenueTrend,
      // Withdrawals / compliance not modeled
      withdrawals: [],
      compliance: {
        warnings: 0,
        violations: 0,
        aiFlags: 0,
        contactReports: 0,
      },
      kyc,
    },
  };
}

async function updateReceiverStatus(id, action) {
  const receiver = await Receiver.findOne({id});
  if (!receiver) return {ok: false, message: 'Receiver not found.'};

  if (action === 'block') {
    receiver.status = 'rejected';
    receiver.rejectionReason = receiver.rejectionReason || 'Blocked by admin';
  } else if (action === 'suspend') {
    receiver.status = 'inactive';
  } else if (action === 'activate') {
    receiver.status = 'active';
    receiver.activatedAt = receiver.activatedAt || new Date();
    receiver.rejectionReason = '';
  } else {
    return {ok: false, message: 'Invalid action.'};
  }

  await receiver.save();
  return getReceiverDetail(receiver.id);
}

function publicPendingRow(receiver) {
  const photos = Array.isArray(receiver.photos) ? receiver.photos : [];
  return {
    id: receiver.id,
    name: receiver.name,
    photoCount: photos.length,
    submittedAgo: receiver.submittedAt
      ? formatRelative(receiver.submittedAt)
      : formatRelative(receiver.updatedAt),
    level: receiver.level || 1,
    agentId: receiver.agentId || '',
  };
}

async function listPendingReceivers() {
  const receivers = await Receiver.find({status: 'pending_review'})
    .sort({submittedAt: -1, updatedAt: -1})
    .lean();

  const agentsMap = await loadAgentsMap(receivers.map(r => r.agentId));
  return receivers.map(receiver => {
    const agent = agentsMap.get(receiver.agentId);
    return {
      ...publicPendingRow(receiver),
      agentName: agent?.name || '—',
      agentCode: agent?.agentCode
        ? agent.agentCode.startsWith('#')
          ? agent.agentCode
          : `#${agent.agentCode}`
        : '',
    };
  });
}

async function approveReceiver(id) {
  const receiver = await Receiver.findOne({id});
  if (!receiver) return {ok: false, message: 'Receiver not found.', status: 404};
  if (receiver.status === 'active') {
    return getReceiverDetail(receiver.id);
  }
  if (!['pending_review', 'pending_onboarding', 'inactive', 'rejected', 'draft'].includes(receiver.status)) {
    return {
      ok: false,
      message: 'Receiver cannot be approved from this status.',
      status: 400,
    };
  }
  receiver.status = 'active';
  receiver.activatedAt = new Date();
  receiver.rejectionReason = '';
  await receiver.save();
  return getReceiverDetail(receiver.id);
}

async function rejectReceiver(id, reason) {
  if (!reason || !String(reason).trim()) {
    return {ok: false, message: 'Rejection reason is required.', status: 400};
  }
  const receiver = await Receiver.findOne({id});
  if (!receiver) return {ok: false, message: 'Receiver not found.', status: 404};
  if (receiver.status === 'rejected') {
    return getReceiverDetail(receiver.id);
  }
  receiver.status = 'rejected';
  receiver.rejectionReason = String(reason).trim();
  await receiver.save();
  return getReceiverDetail(receiver.id);
}

async function requestChanges(id, note) {
  const receiver = await Receiver.findOne({id});
  if (!receiver) return {ok: false, message: 'Receiver not found.', status: 404};
  if (receiver.status !== 'pending_review') {
    return {
      ok: false,
      message: 'Only receivers pending review can be sent back.',
      status: 400,
    };
  }
  receiver.status = 'pending_onboarding';
  receiver.rejectionReason = note
    ? String(note).trim()
    : 'Changes requested by admin';
  await receiver.save();
  return getReceiverDetail(receiver.id);
}

async function terminateReceiver(id, reason) {
  const receiver = await Receiver.findOne({id});
  if (!receiver) return {ok: false, message: 'Receiver not found.', status: 404};
  receiver.status = 'inactive';
  receiver.rejectionReason =
    String(reason || '').trim() ||
    receiver.rejectionReason ||
    'Profile terminated by admin.';
  await receiver.save();
  return getReceiverDetail(receiver.id);
}

module.exports = {
  listReceivers,
  getReceiverStats,
  getReceiverDetail,
  updateReceiverStatus,
  listPendingReceivers,
  approveReceiver,
  rejectReceiver,
  requestChanges,
  terminateReceiver,
};
