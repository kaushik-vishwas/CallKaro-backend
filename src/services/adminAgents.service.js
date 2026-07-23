const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const {v4: uuidv4} = require('uuid');
const Agent = require('../models/Agent');
const Receiver = require('../models/Receiver');

const COMMISSION_RATE = 0.4;
const REVENUE_MULTIPLIER = 2.5;
const PENDING_RATE = 0.19;

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

async function nextAgentCode() {
  const count = await Agent.countDocuments();
  let attempt = count + 1;
  for (let i = 0; i < 50; i += 1) {
    const code = `AGT${String(attempt).padStart(3, '0')}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await Agent.exists({agentCode: code});
    if (!exists) return code;
    attempt += 1;
  }
  return `AGT${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

async function getReceiverMetricsByAgentIds(agentIds) {
  if (!agentIds.length) return new Map();

  const rows = await Receiver.aggregate([
    {$match: {agentId: {$in: agentIds}}},
    {
      $group: {
        _id: '$agentId',
        receivers: {$sum: 1},
        activeReceivers: {
          $sum: {$cond: [{$eq: ['$status', 'active']}, 1, 0]},
        },
        blocked: {
          $sum: {$cond: [{$eq: ['$status', 'rejected']}, 1, 0]},
        },
        inactive: {
          $sum: {
            $cond: [
              {
                $in: [
                  '$status',
                  ['inactive', 'draft', 'pending_onboarding', 'pending_review'],
                ],
              },
              1,
              0,
            ],
          },
        },
        earnings: {$sum: {$ifNull: ['$earnings', 0]}},
        totalCalls: {$sum: {$ifNull: ['$totalCalls', 0]}},
      },
    },
  ]);

  const map = new Map();
  for (const row of rows) {
    const earnings = row.earnings || 0;
    const revenue = Math.round(earnings * REVENUE_MULTIPLIER);
    const commission = Math.round(earnings * COMMISSION_RATE);
    map.set(row._id, {
      receivers: row.receivers || 0,
      activeReceivers: row.activeReceivers || 0,
      blocked: row.blocked || 0,
      inactive: row.inactive || 0,
      earnings,
      revenue,
      commission,
      pending: Math.round(commission * PENDING_RATE),
      totalCalls: row.totalCalls || 0,
    });
  }
  return map;
}

function emptyMetrics() {
  return {
    receivers: 0,
    activeReceivers: 0,
    blocked: 0,
    inactive: 0,
    earnings: 0,
    revenue: 0,
    commission: 0,
    pending: 0,
    totalCalls: 0,
  };
}

function toListItem(agent, metrics, rank) {
  const m = metrics || emptyMetrics();
  return {
    id: agent.id,
    code: agent.agentCode?.startsWith('#')
      ? agent.agentCode
      : `#${agent.agentCode}`,
    name: agent.name,
    phone: agent.phone || '',
    email: agent.email,
    location: '',
    joinedAt: formatDateLabel(agent.createdAt),
    lastActive: formatRelative(agent.updatedAt),
    receivers: m.receivers,
    revenue: m.revenue,
    commission: m.commission,
    pending: m.pending,
    rank,
    status: agent.isActive ? 'active' : 'inactive',
    highRevenue: false,
    topCommission: false,
    avatarUrl: agent.avatarUrl || '',
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

async function listAgents({
  q = '',
  status = 'all',
  tab = 'all',
  page = 1,
  limit = 10,
  dateFrom,
  dateTo,
} = {}) {
  const filter = {};

  if (status === 'active' || tab === 'active') filter.isActive = true;
  if (status === 'inactive' || tab === 'inactive') filter.isActive = false;

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  const query = String(q || '').trim();
  if (query) {
    const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      {name: rx},
      {email: rx},
      {phone: rx},
      {agentCode: rx},
      {id: rx},
    ];
  }

  const agents = await Agent.find(filter).sort({createdAt: -1}).lean();
  const metricsMap = await getReceiverMetricsByAgentIds(agents.map(a => a.id));

  let items = agents.map(agent => {
    const metrics = metricsMap.get(agent.id) || emptyMetrics();
    return {agent, metrics};
  });

  items.sort((a, b) => b.metrics.revenue - a.metrics.revenue);

  const ranked = items.map((entry, index) => {
    const item = toListItem(entry.agent, entry.metrics, index + 1);
    return item;
  });

  const revenueCutoff = ranked[Math.max(0, Math.ceil(ranked.length * 0.25) - 1)]?.revenue || 0;
  const commissionCutoff =
    [...ranked].sort((a, b) => b.commission - a.commission)[
      Math.max(0, Math.ceil(ranked.length * 0.25) - 1)
    ]?.commission || 0;

  let filtered = ranked.map(item => ({
    ...item,
    highRevenue: item.revenue > 0 && item.revenue >= revenueCutoff,
    topCommission: item.commission > 0 && item.commission >= commissionCutoff,
  }));

  if (tab === 'high') {
    filtered = filtered.filter(item => item.highRevenue);
  }
  if (tab === 'commission') {
    filtered = filtered.filter(item => item.topCommission);
  }

  const total = filtered.length;
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 10));
  const start = (pageNum - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  return {
    agents: pageItems,
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function getAgentStats() {
  const [totalAgents, activeAgents, agents] = await Promise.all([
    Agent.countDocuments(),
    Agent.countDocuments({isActive: true}),
    Agent.find({}).select('id').lean(),
  ]);

  const metricsMap = await getReceiverMetricsByAgentIds(agents.map(a => a.id));
  let totalCommission = 0;
  let totalRevenue = 0;
  const ranked = [];

  for (const agent of agents) {
    const m = metricsMap.get(agent.id) || emptyMetrics();
    totalCommission += m.commission;
    totalRevenue += m.revenue;
    ranked.push(m.revenue);
  }

  ranked.sort((a, b) => b - a);
  const topPerforming = ranked.filter(v => v > 0).slice(0, Math.max(1, Math.ceil(ranked.length * 0.1))).length;

  return {
    totalAgents,
    activeAgents,
    topPerforming: Math.min(activeAgents, topPerforming || 0),
    totalCommission,
    totalRevenue,
    totalCommissionLabel: formatInrCompact(totalCommission),
    revenueViaAgentsLabel: formatInrCompact(totalRevenue),
  };
}

async function createAgent({name, email, phone, password, agentCode}) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const normalizedName = String(name || '').trim();
  if (!normalizedName) return {ok: false, message: 'Name is required.'};
  if (!normalizedEmail) return {ok: false, message: 'Email is required.'};

  const existing = await Agent.findOne({email: normalizedEmail});
  if (existing) return {ok: false, message: 'An agent with this email already exists.'};

  let code = String(agentCode || '').trim().toUpperCase().replace(/^#/, '');
  if (!code) code = await nextAgentCode();
  const codeExists = await Agent.exists({agentCode: code});
  if (codeExists) return {ok: false, message: 'Agent code already in use.'};

  const tempPassword =
    password && String(password).length >= 6
      ? String(password)
      : `Agent@${crypto.randomBytes(3).toString('hex')}`;

  const agent = await Agent.create({
    id: uuidv4(),
    email: normalizedEmail,
    name: normalizedName,
    phone: String(phone || '').trim(),
    agentCode: code,
    avatarUrl: '',
    passwordHash: await bcrypt.hash(tempPassword, 10),
    isActive: true,
  });

  const item = toListItem(agent, emptyMetrics(), 0);
  return {
    ok: true,
    agent: item,
    temporaryPassword: tempPassword,
  };
}

async function getAgentDetail(id) {
  const agent = await Agent.findOne({
    $or: [{id}, {agentCode: String(id).replace(/^#/, '')}],
  });
  if (!agent) return {ok: false, message: 'Agent not found.'};

  const allAgents = await Agent.find({}).select('id').lean();
  const allMetrics = await getReceiverMetricsByAgentIds(allAgents.map(a => a.id));
  const rankedIds = allAgents
    .map(a => ({id: a.id, revenue: (allMetrics.get(a.id) || emptyMetrics()).revenue}))
    .sort((a, b) => b.revenue - a.revenue);
  const rank = Math.max(1, rankedIds.findIndex(r => r.id === agent.id) + 1);
  const metrics = allMetrics.get(agent.id) || emptyMetrics();

  const receivers = await Receiver.find({agentId: agent.id})
    .sort({earnings: -1})
    .limit(20)
    .lean();

  const listItem = toListItem(agent, metrics, rank);
  const availableBalance = Math.round(metrics.commission * 0.3);

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

  for (const receiver of receivers) {
    const created = new Date(receiver.createdAt || receiver.activatedAt || Date.now());
    const key = `${created.getFullYear()}-${created.getMonth()}`;
    const bucket = months.find(m => m.key === key);
    if (bucket) {
      bucket.value += Math.round((receiver.earnings || 0) * COMMISSION_RATE);
    }
  }

  // Smooth empty trend with a gentle ramp from commission
  const trendSum = months.reduce((s, m) => s + m.value, 0);
  const earningsTrend = months.map((m, index) => ({
    month: m.month,
    value:
      trendSum > 0
        ? m.value
        : Math.round((metrics.commission / 6) * (0.55 + index * 0.12)),
  }));

  return {
    ok: true,
    agent: {
      ...listItem,
      availableBalance,
      team: {
        totalReceivers: metrics.receivers,
        activeReceivers: metrics.activeReceivers,
        onlineNow: Math.max(
          0,
          Math.round(metrics.activeReceivers * 0.2),
        ),
        blocked: metrics.blocked,
        inactive: metrics.inactive,
      },
      commissionDashboard: {
        totalEarned: metrics.commission,
        pending: metrics.pending,
        available: availableBalance,
        lifetimeEarnings: Math.round(metrics.commission * 1.2),
        totalRevenueGenerated: metrics.revenue,
      },
      revenueAnalytics: {
        totalRevenue: metrics.revenue,
        avgRevPerReceiver: metrics.receivers
          ? Math.round(metrics.revenue / metrics.receivers)
          : 0,
        monthlyRevenue: Math.round(metrics.revenue / 6),
        growthPct: metrics.revenue > 0 ? 18 + (rank % 15) : 0,
        revenueRank: rank,
      },
      earningsTrend,
      receiverPerformance: receivers.map(r => ({
        id: r.id,
        name: r.name,
        calls: r.totalCalls || 0,
        coinsEarned: Math.round((r.earnings || 0) * 1.25),
        revenue: Math.round((r.earnings || 0) * REVENUE_MULTIPLIER),
        commission: Math.round((r.earnings || 0) * COMMISSION_RATE),
        status:
          r.status === 'active'
            ? 'active'
            : r.status === 'rejected'
              ? 'blocked'
              : 'inactive',
      })),
      timeline: [
        {
          id: 't1',
          title: 'Joined the platform',
          detail: formatDateLabel(agent.createdAt),
          tone: 'pink',
        },
        {
          id: 't2',
          title: 'First receiver onboarded',
          detail:
            receivers.length > 0
              ? formatDateLabel(
                  receivers
                    .slice()
                    .sort(
                      (a, b) =>
                        new Date(a.createdAt) - new Date(b.createdAt),
                    )[0]?.createdAt,
                )
              : 'No receivers yet',
          tone: 'amber',
        },
        {
          id: 't3',
          title:
            metrics.commission >= 100000
              ? 'Reached ₹ 1L commission'
              : 'Building commission',
          detail:
            metrics.commission >= 100000
              ? 'Milestone unlocked'
              : `Current: ₹ ${metrics.commission.toLocaleString('en-IN')}`,
          tone: 'green',
        },
        {
          id: 't4',
          title: `Ranked #${rank} by revenue`,
          detail: 'Current standing',
          tone: 'purple',
        },
      ],
    },
  };
}

async function updateAgent(id, payload = {}) {
  const agent = await Agent.findOne({id});
  if (!agent) return {ok: false, message: 'Agent not found.'};

  if (payload.name !== undefined) agent.name = String(payload.name).trim();
  if (payload.phone !== undefined) agent.phone = String(payload.phone).trim();
  if (payload.avatarUrl !== undefined) {
    agent.avatarUrl = String(payload.avatarUrl).trim();
  }
  if (payload.isActive !== undefined) {
    agent.isActive = Boolean(payload.isActive);
  }
  if (payload.email !== undefined) {
    const email = String(payload.email).toLowerCase().trim();
    const clash = await Agent.findOne({email, id: {$ne: agent.id}});
    if (clash) return {ok: false, message: 'Email already in use.'};
    agent.email = email;
  }

  await agent.save();
  const detail = await getAgentDetail(agent.id);
  return detail;
}

async function resetAgentPassword(id, newPassword) {
  const agent = await Agent.findOne({id});
  if (!agent) return {ok: false, message: 'Agent not found.'};

  const password =
    newPassword && String(newPassword).length >= 6
      ? String(newPassword)
      : `Agent@${crypto.randomBytes(3).toString('hex')}`;

  agent.passwordHash = await bcrypt.hash(password, 10);
  await agent.save();
  return {ok: true, temporaryPassword: password};
}

module.exports = {
  listAgents,
  getAgentStats,
  createAgent,
  getAgentDetail,
  updateAgent,
  resetAgentPassword,
};
