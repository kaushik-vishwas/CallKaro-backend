const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Caller = require('../models/Caller');
const Order = require('../models/Order');

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

function callerCode(caller) {
  const raw = String(caller.id || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-4)
    .toUpperCase();
  return `#CK${raw || '0000'}`;
}

async function getRechargeByUserIds(userIds) {
  if (!userIds.length) return new Map();

  const rows = await Order.aggregate([
    {$match: {userId: {$in: userIds}, status: 'paid'}},
    {
      $group: {
        _id: '$userId',
        totalRecharge: {$sum: {$ifNull: ['$amount', 0]}},
        coinsPurchased: {$sum: {$ifNull: ['$coins', 0]}},
        paidOrders: {$sum: 1},
        firstPaidAt: {$min: '$paidAt'},
      },
    },
  ]);

  const map = new Map();
  for (const row of rows) {
    map.set(row._id, {
      totalRecharge: row.totalRecharge || 0,
      coinsPurchased: row.coinsPurchased || 0,
      paidOrders: row.paidOrders || 0,
      firstPaidAt: row.firstPaidAt || null,
    });
  }
  return map;
}

function emptyRecharge() {
  return {totalRecharge: 0, coinsPurchased: 0, paidOrders: 0, firstPaidAt: null};
}

/**
 * Unavailable product fields stay as stable UI placeholders.
 */
function toListItem(caller, recharge = emptyRecharge()) {
  return {
    id: caller.id,
    code: callerCode(caller),
    name: caller.name || '',
    phone: caller.phone || '',
    email: caller.email || '',
    location: '', // not in schema — keep empty for UI
    registeredAt: formatDateLabel(caller.createdAt),
    coins: caller.coins || 0,
    totalRecharge: recharge.totalRecharge || 0,
    calls: 0, // calls domain not built — static
    vip: false, // VIP not in schema — static
    status: 'active', // status/moderation not in schema — static
    lastActive: formatRelative(caller.updatedAt),
    avatarUrl: caller.avatarUrl || caller.profile || '',
    isVerified: Boolean(caller.isVerified),
    createdAt: caller.createdAt,
    updatedAt: caller.updatedAt,
  };
}

async function listCallers({
  q = '',
  tab = 'all',
  page = 1,
  limit = 15,
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

  const query = String(q || '').trim();
  if (query) {
    const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{name: rx}, {email: rx}, {phone: rx}, {id: rx}];
  }

  // VIP / blocked / suspended are not stored yet — those tabs return empty.
  if (tab === 'vip' || tab === 'blocked' || tab === 'suspended') {
    return {
      callers: [],
      pagination: {
        page: Math.max(1, Number(page) || 1),
        limit: Math.min(100, Math.max(1, Number(limit) || 15)),
        total: 0,
        totalPages: 1,
      },
    };
  }

  // "active" and "all" both list real callers (status is static active).
  const total = await Caller.countDocuments(filter);
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 15));
  const skip = (pageNum - 1) * pageSize;

  const callers = await Caller.find(filter)
    .sort({createdAt: -1})
    .skip(skip)
    .limit(pageSize)
    .lean();

  const rechargeMap = await getRechargeByUserIds(callers.map(c => c.id));
  const items = callers.map(caller =>
    toListItem(caller, rechargeMap.get(caller.id) || emptyRecharge()),
  );

  return {
    callers: items,
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function getCallerStats() {
  const [totalCallers, orderAgg, recentActive] = await Promise.all([
    Caller.countDocuments(),
    Order.aggregate([
      {$match: {status: 'paid'}},
      {
        $group: {
          _id: null,
          totalRevenue: {$sum: {$ifNull: ['$amount', 0]}},
        },
      },
    ]),
    Caller.countDocuments({
      updatedAt: {$gte: new Date(Date.now() - 24 * 60 * 60 * 1000)},
    }),
  ]);

  const totalRevenue = orderAgg[0]?.totalRevenue || 0;
  const avgRevenue = totalCallers
    ? Math.round(totalRevenue / totalCallers)
    : 0;

  return {
    totalUsers: totalCallers,
    activeNow: recentActive,
    totalCallers,
    // Soft placeholders until moderation/VIP exist
    activeCallers: totalCallers,
    vipCallers: 0,
    blockedCallers: 0,
    totalRevenue,
    avgRevenue,
    totalRevenueLabel: formatInrCompact(totalRevenue),
    avgRevenueLabel: `₹ ${avgRevenue.toLocaleString('en-IN')}`,
  };
}

async function getCallerDetail(id) {
  const caller = await Caller.findOne({id});
  if (!caller) return {ok: false, message: 'Caller not found.'};

  const rechargeMap = await getRechargeByUserIds([caller.id]);
  const recharge = rechargeMap.get(caller.id) || emptyRecharge();
  const listItem = toListItem(caller, recharge);

  const purchased = recharge.coinsPurchased || 0;
  const currentBalance = caller.coins || 0;
  const consumed = Math.max(0, purchased - currentBalance);
  const bonus = Math.max(0, Math.round(purchased * 0.05));

  return {
    ok: true,
    caller: {
      ...listItem,
      wallet: {
        currentBalance,
        purchased,
        consumed,
        bonus,
        totalRechargeAmount: recharge.totalRecharge || 0,
      },
      // Call analytics not available yet — static UI placeholders
      analytics: {
        totalCalls: 0,
        completed: 0,
        missed: 0,
        cancelled: 0,
        avgDuration: '—',
        totalTalkTime: '—',
      },
      weeklyActivity: [
        {day: 'Mon', calls: 0},
        {day: 'Tue', calls: 0},
        {day: 'Wed', calls: 0},
        {day: 'Thu', calls: 0},
        {day: 'Fri', calls: 0},
        {day: 'Sat', calls: 0},
        {day: 'Sun', calls: 0},
      ],
      recentCalls: [],
      timeline: [
        {
          id: 't1',
          title: 'Account registered',
          detail: formatDateLabel(caller.createdAt),
          time: formatDateLabel(caller.createdAt),
          tone: 'pink',
        },
        {
          id: 't2',
          title: recharge.firstPaidAt
            ? `First recharge ₹ ${recharge.totalRecharge.toLocaleString('en-IN')}`
            : 'No recharge yet',
          detail: recharge.firstPaidAt
            ? formatDateLabel(recharge.firstPaidAt)
            : 'Wallet empty',
          time: recharge.firstPaidAt
            ? formatDateLabel(recharge.firstPaidAt)
            : '—',
          tone: 'amber',
        },
        {
          id: 't3',
          title: 'VIP activated',
          detail: 'Not available yet',
          time: '—',
          tone: 'purple',
        },
        {
          id: 't4',
          title: 'Call milestones',
          detail: 'Call history coming soon',
          time: '—',
          tone: 'green',
        },
      ],
      ticketsRaised: 0,
      reportsSubmitted: 0,
    },
  };
}

async function resetCallerPassword(id, newPassword) {
  const caller = await Caller.findOne({id});
  if (!caller) return {ok: false, message: 'Caller not found.'};

  const password =
    newPassword && String(newPassword).length >= 6
      ? String(newPassword)
      : `Caller@${crypto.randomBytes(3).toString('hex')}`;

  caller.passwordHash = await bcrypt.hash(password, 10);
  await caller.save();
  return {ok: true, temporaryPassword: password};
}

module.exports = {
  listCallers,
  getCallerStats,
  getCallerDetail,
  resetCallerPassword,
};
