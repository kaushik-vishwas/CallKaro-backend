const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Caller = require('../models/Caller');
const Call = require('../models/Call');
const Order = require('../models/Order');
const {SupportTicket} = require('../models/SupportTicket');
const UserReport = require('../models/UserReport');

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

function formatDuration(totalSeconds) {
  const secs = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  }
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatCallClock(totalSeconds) {
  const secs = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function callerCode(caller) {
  const raw = String(caller.id || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-4)
    .toUpperCase();
  return `#CK${raw || '0000'}`;
}

function isVipActive(caller, now = new Date()) {
  if (!caller?.vipExpiresAt) return false;
  const expires = new Date(caller.vipExpiresAt);
  return !Number.isNaN(expires.getTime()) && expires.getTime() > now.getTime();
}

function callerStatus(caller) {
  if (caller.isBlocked) return 'blocked';
  if (caller.isSuspended) return 'suspended';
  return 'active';
}

function mapCallUiStatus(status) {
  if (status === 'ended') return 'completed';
  if (status === 'missed' || status === 'rejected' || status === 'busy') {
    return 'missed';
  }
  if (status === 'failed') return 'cancelled';
  return 'cancelled';
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

async function getCallCountsByCallerIds(userIds) {
  if (!userIds.length) return new Map();
  const rows = await Call.aggregate([
    {$match: {callerId: {$in: userIds}}},
    {
      $group: {
        _id: '$callerId',
        total: {$sum: 1},
        completed: {
          $sum: {$cond: [{$eq: ['$status', 'ended']}, 1, 0]},
        },
        missed: {
          $sum: {
            $cond: [
              {$in: ['$status', ['missed', 'rejected', 'busy']]},
              1,
              0,
            ],
          },
        },
        cancelled: {
          $sum: {
            $cond: [{$in: ['$status', ['failed', 'ringing']]}, 1, 0],
          },
        },
        talkSeconds: {$sum: {$ifNull: ['$durationSeconds', 0]}},
      },
    },
  ]);

  const map = new Map();
  for (const row of rows) {
    map.set(row._id, {
      total: row.total || 0,
      completed: row.completed || 0,
      missed: row.missed || 0,
      cancelled: row.cancelled || 0,
      talkSeconds: row.talkSeconds || 0,
    });
  }
  return map;
}

function emptyRecharge() {
  return {totalRecharge: 0, coinsPurchased: 0, paidOrders: 0, firstPaidAt: null};
}

function emptyCalls() {
  return {total: 0, completed: 0, missed: 0, cancelled: 0, talkSeconds: 0};
}

function toListItem(caller, recharge = emptyRecharge(), calls = emptyCalls()) {
  return {
    id: caller.id,
    code: callerCode(caller),
    name: caller.name || '',
    phone: caller.phone || '',
    email: caller.email || '',
    location: '',
    registeredAt: formatDateLabel(caller.createdAt),
    coins: caller.coins || 0,
    totalRecharge: recharge.totalRecharge || 0,
    calls: calls.total || 0,
    vip: isVipActive(caller),
    vipPlan: caller.vipPlan || null,
    vipExpiresAt: caller.vipExpiresAt
      ? new Date(caller.vipExpiresAt).toISOString()
      : null,
    status: callerStatus(caller),
    lastActive: formatRelative(caller.updatedAt),
    avatarUrl: caller.avatarUrl || caller.profile || '',
    isVerified: Boolean(caller.isVerified),
    createdAt: caller.createdAt,
    updatedAt: caller.updatedAt,
  };
}

function activeVipFilter(now = new Date()) {
  return {
    vipExpiresAt: {$ne: null, $gt: now},
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
  const now = new Date();

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

  const tabKey = String(tab || 'all').toLowerCase();
  if (tabKey === 'vip') {
    Object.assign(filter, activeVipFilter(now));
  } else if (tabKey === 'blocked') {
    filter.isBlocked = true;
  } else if (tabKey === 'suspended') {
    filter.isSuspended = true;
    filter.isBlocked = {$ne: true};
  } else if (tabKey === 'active') {
    filter.isBlocked = {$ne: true};
    filter.isSuspended = {$ne: true};
  }

  const total = await Caller.countDocuments(filter);
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 15));
  const skip = (pageNum - 1) * pageSize;

  const callers = await Caller.find(filter)
    .sort({createdAt: -1})
    .skip(skip)
    .limit(pageSize)
    .lean();

  const ids = callers.map(c => c.id);
  const [rechargeMap, callMap] = await Promise.all([
    getRechargeByUserIds(ids),
    getCallCountsByCallerIds(ids),
  ]);

  const items = callers.map(caller =>
    toListItem(
      caller,
      rechargeMap.get(caller.id) || emptyRecharge(),
      callMap.get(caller.id) || emptyCalls(),
    ),
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
  const now = new Date();
  const [
    totalCallers,
    vipCallers,
    blockedCallers,
    suspendedCallers,
    orderAgg,
    recentActive,
  ] = await Promise.all([
    Caller.countDocuments(),
    Caller.countDocuments(activeVipFilter(now)),
    Caller.countDocuments({isBlocked: true}),
    Caller.countDocuments({isSuspended: true, isBlocked: {$ne: true}}),
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
      isBlocked: {$ne: true},
      isSuspended: {$ne: true},
    }),
  ]);

  const totalRevenue = orderAgg[0]?.totalRevenue || 0;
  const avgRevenue = totalCallers
    ? Math.round(totalRevenue / totalCallers)
    : 0;
  const activeCallers = Math.max(
    0,
    totalCallers - blockedCallers - suspendedCallers,
  );

  return {
    totalUsers: totalCallers,
    activeNow: recentActive,
    totalCallers,
    activeCallers,
    vipCallers,
    blockedCallers,
    suspendedCallers,
    totalRevenue,
    avgRevenue,
    totalRevenueLabel: formatInrCompact(totalRevenue),
    avgRevenueLabel: `₹ ${avgRevenue.toLocaleString('en-IN')}`,
  };
}

function buildWeeklyActivity(calls) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const counts = {Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0};
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const call of calls) {
    const at = call.startedAt || call.createdAt;
    if (!at) continue;
    const t = new Date(at).getTime();
    if (t < weekAgo) continue;
    const label = days[new Date(at).getDay()];
    counts[label] += 1;
  }
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => ({
    day,
    calls: counts[day] || 0,
  }));
}

async function getCallerDetail(id) {
  const caller = await Caller.findOne({id}).lean();
  if (!caller) return {ok: false, message: 'Caller not found.'};

  const [rechargeMap, callMap, recentCalls, weekCalls, ticketsRaised, reportsSubmitted] =
    await Promise.all([
      getRechargeByUserIds([caller.id]),
      getCallCountsByCallerIds([caller.id]),
      Call.find({callerId: caller.id})
        .sort({createdAt: -1})
        .limit(10)
        .lean(),
      Call.find({
        callerId: caller.id,
        createdAt: {$gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)},
      })
        .select('startedAt createdAt')
        .lean(),
      SupportTicket.countDocuments({
        callerId: caller.id,
      }),
      UserReport.countDocuments({
        reporterId: caller.id,
        reporterRole: 'caller',
      }),
    ]);

  const recharge = rechargeMap.get(caller.id) || emptyRecharge();
  const calls = callMap.get(caller.id) || emptyCalls();
  const listItem = toListItem(caller, recharge, calls);

  const purchased = recharge.coinsPurchased || 0;
  const currentBalance = caller.coins || 0;
  const consumed = Math.max(0, purchased - currentBalance);
  const bonus = Math.max(0, Math.round(purchased * 0.05));
  const avgDurationSecs =
    calls.completed > 0 ? calls.talkSeconds / calls.completed : 0;

  const vipActive = isVipActive(caller);

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
      analytics: {
        totalCalls: calls.total,
        completed: calls.completed,
        missed: calls.missed,
        cancelled: calls.cancelled,
        avgDuration: formatDuration(avgDurationSecs),
        totalTalkTime: formatDuration(calls.talkSeconds),
      },
      weeklyActivity: buildWeeklyActivity(weekCalls),
      recentCalls: recentCalls.map(call => ({
        id: call.id,
        receiver: call.receiverSnapshot?.name || call.receiverId || 'Receiver',
        duration: formatCallClock(call.durationSeconds),
        coins: Number(call.coinsCharged || 0),
        status: mapCallUiStatus(call.status),
      })),
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
          title: vipActive ? 'VIP active' : 'VIP not active',
          detail: vipActive
            ? `${String(caller.vipPlan || 'VIP').toUpperCase()} · expires ${formatDateLabel(caller.vipExpiresAt)}`
            : 'No active VIP plan',
          time: vipActive ? formatDateLabel(caller.vipExpiresAt) : '—',
          tone: 'purple',
        },
        {
          id: 't4',
          title: `${calls.total} total calls`,
          detail: `${calls.completed} completed · ${formatDuration(calls.talkSeconds)} talk time`,
          time: recentCalls[0]
            ? formatDateLabel(recentCalls[0].createdAt)
            : '—',
          tone: 'green',
        },
      ],
      ticketsRaised: Number(ticketsRaised) || 0,
      reportsSubmitted: Number(reportsSubmitted) || 0,
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

async function updateCallerStatus(id, action, reasonText = '') {
  const caller = await Caller.findOne({id});
  if (!caller) return {ok: false, message: 'Caller not found.'};

  const note = String(reasonText || '').trim();
  const key = String(action || '').toLowerCase();

  if (key === 'block') {
    caller.isBlocked = true;
    caller.isSuspended = false;
    caller.moderationReason = note || caller.moderationReason || 'Blocked by admin';
  } else if (key === 'suspend') {
    caller.isSuspended = true;
    caller.isBlocked = false;
    caller.moderationReason =
      note || caller.moderationReason || 'Suspended by admin';
  } else if (key === 'activate' || key === 'unblock') {
    caller.isBlocked = false;
    caller.isSuspended = false;
    caller.moderationReason = '';
  } else {
    return {ok: false, message: 'Invalid action.'};
  }

  await caller.save();
  return getCallerDetail(caller.id);
}

module.exports = {
  listCallers,
  getCallerStats,
  getCallerDetail,
  resetCallerPassword,
  updateCallerStatus,
  isVipActive,
  callerCode,
  formatDateLabel,
  formatRelative,
  formatInrCompact,
  getCallCountsByCallerIds,
  getRechargeByUserIds,
  activeVipFilter,
};
