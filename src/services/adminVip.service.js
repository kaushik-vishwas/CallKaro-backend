const {config} = require('../config');
const Caller = require('../models/Caller');
const Call = require('../models/Call');
const Order = require('../models/Order');
const {
  isVipActive,
  callerCode,
  formatDateLabel,
  formatRelative,
  formatInrCompact,
  getCallCountsByCallerIds,
  getRechargeByUserIds,
  activeVipFilter,
} = require('./adminCallers.service');

function emptyRecharge() {
  return {totalRecharge: 0, coinsPurchased: 0, paidOrders: 0, firstPaidAt: null};
}

function emptyCalls() {
  return {total: 0, completed: 0, missed: 0, cancelled: 0, talkSeconds: 0};
}

function planLabel(planId) {
  const plan = config.vipPlans?.[planId];
  if (plan?.title) return plan.title;
  if (!planId) return 'VIP';
  return `${String(planId).charAt(0).toUpperCase()}${String(planId).slice(1)} VIP`;
}

function listPlans() {
  return Object.values(config.vipPlans || {}).map(plan => {
    const popular = plan.id === 'monthly';
    return {
      id: plan.id,
      name: plan.title || plan.label || plan.id,
      durationDays: Number(plan.days) || 0,
      durationLabel: `${Number(plan.days) || 0} Days`,
      price: Number(plan.priceInr) || 0,
      originalPrice: Number(plan.originalInr) || Number(plan.priceInr) || 0,
      bonusCoins: Number(plan.bonusCoins) || 0,
      perDayLabel: plan.perDayLabel || '',
      saveBadge: plan.saveBadge || null,
      status: 'active',
      popular,
      icon: plan.id === 'weekly' ? 'bolt' : 'calendar',
    };
  });
}

async function getPlanStats() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [activeVips, totalCallers, monthAgg] = await Promise.all([
    Caller.countDocuments(activeVipFilter(now)),
    Caller.countDocuments(),
    Order.aggregate([
      {
        $match: {
          status: 'paid',
          purpose: 'vip',
          paidAt: {$gte: monthStart},
        },
      },
      {
        $group: {
          _id: null,
          revenue: {$sum: {$ifNull: ['$amount', 0]}},
          count: {$sum: 1},
        },
      },
    ]),
  ]);

  const monthlyRevenue = monthAgg[0]?.revenue || 0;
  const conversionRate =
    totalCallers > 0
      ? `${((activeVips / totalCallers) * 100).toFixed(1)}%`
      : '0%';

  return {
    activeVips,
    monthlyRevenue,
    monthlyRevenueLabel: formatInrCompact(monthlyRevenue),
    conversionRate,
    totalCallers,
  };
}

async function buildChart(period = 'monthly') {
  const now = new Date();
  let buckets = [];
  let matchStart;

  if (period === 'weekly') {
    matchStart = new Date(now);
    matchStart.setDate(now.getDate() - 6);
    matchStart.setHours(0, 0, 0, 0);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      d.setHours(0, 0, 0, 0);
      buckets.push({
        key: d.toISOString().slice(0, 10),
        label: dayNames[d.getDay()],
        start: d,
        end: new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1),
      });
    }
  } else if (period === 'yearly') {
    matchStart = new Date(now.getFullYear(), 0, 1);
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    for (let m = 0; m < 12; m += 1) {
      const start = new Date(now.getFullYear(), m, 1);
      const end = new Date(now.getFullYear(), m + 1, 0, 23, 59, 59, 999);
      buckets.push({
        key: `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}`,
        label: monthNames[m],
        start,
        end,
      });
    }
  } else {
    // monthly → last 8 weeks
    matchStart = new Date(now);
    matchStart.setDate(now.getDate() - 7 * 7);
    matchStart.setHours(0, 0, 0, 0);
    for (let i = 7; i >= 0; i -= 1) {
      const start = new Date(now);
      start.setDate(now.getDate() - i * 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      buckets.push({
        key: `W${8 - i}`,
        label: `W${8 - i}`,
        start,
        end,
      });
    }
  }

  const rows = await Order.aggregate([
    {
      $match: {
        status: 'paid',
        purpose: 'vip',
        paidAt: {$gte: matchStart},
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {format: '%Y-%m-%d', date: '$paidAt'},
        },
        value: {$sum: {$ifNull: ['$amount', 0]}},
      },
    },
  ]);

  const byDay = new Map(rows.map(r => [r._id, r.value || 0]));
  return buckets.map(bucket => {
    let value = 0;
    for (const [day, amount] of byDay.entries()) {
      const t = new Date(`${day}T12:00:00.000Z`).getTime();
      if (t >= bucket.start.getTime() && t <= bucket.end.getTime()) {
        value += amount;
      }
    }
    // Also sum by iterating days in range for weekly/monthly buckets
    if (period !== 'yearly') {
      value = 0;
      const cursor = new Date(bucket.start);
      while (cursor.getTime() <= bucket.end.getTime()) {
        const key = cursor.toISOString().slice(0, 10);
        value += byDay.get(key) || 0;
        cursor.setDate(cursor.getDate() + 1);
      }
    } else {
      value = 0;
      for (const [day, amount] of byDay.entries()) {
        const d = new Date(`${day}T12:00:00.000Z`);
        if (
          d.getFullYear() === bucket.start.getFullYear() &&
          d.getMonth() === bucket.start.getMonth()
        ) {
          value += amount;
        }
      }
    }
    return {label: bucket.label, value};
  });
}

async function getAnalytics(period = 'monthly') {
  const now = new Date();
  const [revenueAgg, activeVipUsers, chart, topUsers] = await Promise.all([
    Order.aggregate([
      {$match: {status: 'paid', purpose: 'vip'}},
      {
        $group: {
          _id: null,
          revenue: {$sum: {$ifNull: ['$amount', 0]}},
        },
      },
    ]),
    Caller.countDocuments(activeVipFilter(now)),
    buildChart(period),
    listTopUsers(8),
  ]);

  const revenue = revenueAgg[0]?.revenue || 0;
  return {
    revenue,
    revenueLabel: formatInrCompact(revenue),
    activeVipUsers,
    chart,
    topUsers,
  };
}

async function listTopUsers(limit = 8) {
  const now = new Date();
  const vipSpend = await Order.aggregate([
    {$match: {status: 'paid', purpose: 'vip'}},
    {
      $group: {
        _id: '$userId',
        amountSpent: {$sum: {$ifNull: ['$amount', 0]}},
      },
    },
    {$sort: {amountSpent: -1}},
    {$limit: Math.max(1, Number(limit) || 8)},
  ]);

  const ids = vipSpend.map(r => r._id).filter(Boolean);
  if (!ids.length) return [];

  const [callers, callMap] = await Promise.all([
    Caller.find({id: {$in: ids}}).lean(),
    getCallCountsByCallerIds(ids),
  ]);
  const callerMap = new Map(callers.map(c => [c.id, c]));

  return vipSpend
    .map(row => {
      const caller = callerMap.get(row._id);
      if (!caller) return null;
      const calls = callMap.get(caller.id) || emptyCalls();
      return {
        id: caller.id,
        name: caller.name || 'Caller',
        userId: callerCode(caller),
        amountSpent: row.amountSpent || 0,
        totalCalls: calls.total || 0,
        status: caller.isBlocked
          ? 'blocked'
          : isVipActive(caller, now)
            ? 'active'
            : 'suspended',
      };
    })
    .filter(Boolean);
}

async function listVipUsers({
  q = '',
  tab = 'vip',
  page = 1,
  limit = 10,
} = {}) {
  const now = new Date();
  const filter = {};
  const tabKey = String(tab || 'vip').toLowerCase();

  if (tabKey === 'vip' || tabKey === 'active') {
    Object.assign(filter, activeVipFilter(now));
    if (tabKey === 'active') filter.isBlocked = {$ne: true};
  } else if (tabKey === 'blocked' || tabKey === 'suspended') {
    filter.isBlocked = true;
    filter.vipPlan = {$ne: null};
  } else if (tabKey === 'all') {
    filter.$or = [
      activeVipFilter(now),
      {vipPlan: {$ne: null}},
      {vipExpiresAt: {$ne: null}},
    ];
  } else {
    Object.assign(filter, activeVipFilter(now));
  }

  const query = String(q || '').trim();
  if (query) {
    const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$and = [
      ...(filter.$and || []),
      {$or: [{name: rx}, {email: rx}, {phone: rx}, {id: rx}]},
    ];
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 10));
  const skip = (pageNum - 1) * pageSize;

  const [total, callers, directoryStats] = await Promise.all([
    Caller.countDocuments(filter),
    Caller.find(filter)
      .sort({vipExpiresAt: -1, createdAt: -1})
      .skip(skip)
      .limit(pageSize)
      .lean(),
    getDirectoryStats(now),
  ]);

  const ids = callers.map(c => c.id);
  const [rechargeMap, callMap] = await Promise.all([
    getRechargeByUserIds(ids),
    getCallCountsByCallerIds(ids),
  ]);

  const users = callers.map(caller => {
    const recharge = rechargeMap.get(caller.id) || emptyRecharge();
    const calls = callMap.get(caller.id) || emptyCalls();
    const vip = isVipActive(caller, now);
    return {
      id: caller.id,
      code: callerCode(caller),
      name: caller.name || '',
      phone: caller.phone || '',
      email: caller.email || '',
      gender: '',
      age: 0,
      location: '',
      regDate: formatDateLabel(caller.createdAt),
      coins: caller.coins || 0,
      totalRecharge: recharge.totalRecharge || 0,
      calls: calls.total || 0,
      vipPlan: planLabel(caller.vipPlan),
      vipPlanId: caller.vipPlan || null,
      vipExpiresAt: caller.vipExpiresAt
        ? new Date(caller.vipExpiresAt).toISOString()
        : null,
      status: caller.isBlocked ? 'blocked' : vip ? 'active' : 'suspended',
      lastActive: formatRelative(caller.updatedAt),
      joinDate: formatDateLabel(caller.createdAt),
      balance: caller.coins || 0,
      lastRecharge: recharge.firstPaidAt
        ? formatDateLabel(recharge.firstPaidAt)
        : '—',
      lastWithdrawal: '—',
      callSummary: {
        totalCalls: calls.total,
        totalMins: Math.round((calls.talkSeconds || 0) / 60),
        coinsSpent: Math.max(
          0,
          (recharge.coinsPurchased || 0) - (caller.coins || 0),
        ),
        level: calls.total >= 300 ? 'Level 4' : calls.total >= 150 ? 'Level 3' : calls.total >= 50 ? 'Level 2' : 'Level 1',
      },
      activityStats: {
        totalCalls: calls.total,
        vipCalls: calls.completed,
        coinsSpent: Math.max(
          0,
          (recharge.coinsPurchased || 0) - (caller.coins || 0),
        ),
        avgDuration:
          calls.completed > 0
            ? `${Math.round(calls.talkSeconds / calls.completed / 60)}m`
            : '—',
      },
      recentCalls: [],
      transactions: [],
    };
  });

  return {
    users,
    stats: directoryStats,
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function getDirectoryStats(now = new Date()) {
  const [totalCallers, activeCallers, vipCallers, revenueAgg] =
    await Promise.all([
      Caller.countDocuments(),
      Caller.countDocuments({isBlocked: {$ne: true}}),
      Caller.countDocuments(activeVipFilter(now)),
      Order.aggregate([
        {$match: {status: 'paid', purpose: 'vip'}},
        {
          $group: {
            _id: null,
            revenue: {$sum: {$ifNull: ['$amount', 0]}},
          },
        },
      ]),
    ]);

  const totalRevenue = revenueAgg[0]?.revenue || 0;
  const avgRevenue = totalCallers
    ? Math.round(totalRevenue / totalCallers)
    : 0;

  return {
    totalCallers,
    activeCallers,
    vipCallers,
    totalRevenue,
    totalRevenueLabel: formatInrCompact(totalRevenue),
    avgRevenueLabel: `₹ ${avgRevenue.toLocaleString('en-IN')}`,
  };
}

async function getVipUser(id) {
  const caller = await Caller.findOne({id}).lean();
  if (!caller) return {ok: false, message: 'VIP user not found.'};

  const [rechargeMap, callMap, vipOrders, recentCalls] = await Promise.all([
    getRechargeByUserIds([caller.id]),
    getCallCountsByCallerIds([caller.id]),
    Order.find({userId: caller.id, status: 'paid', purpose: 'vip'})
      .sort({paidAt: -1})
      .limit(10)
      .lean(),
    Call.find({callerId: caller.id}).sort({createdAt: -1}).limit(5).lean(),
  ]);

  const recharge = rechargeMap.get(caller.id) || emptyRecharge();
  const calls = callMap.get(caller.id) || emptyCalls();
  const now = new Date();
  const vip = isVipActive(caller, now);

  return {
    ok: true,
    user: {
      id: caller.id,
      code: callerCode(caller),
      name: caller.name || '',
      phone: caller.phone || '',
      email: caller.email || '',
      gender: '',
      age: 0,
      location: '',
      regDate: formatDateLabel(caller.createdAt),
      coins: caller.coins || 0,
      totalRecharge: recharge.totalRecharge || 0,
      calls: calls.total || 0,
      vipPlan: planLabel(caller.vipPlan),
      vipPlanId: caller.vipPlan || null,
      vipExpiresAt: caller.vipExpiresAt
        ? new Date(caller.vipExpiresAt).toISOString()
        : null,
      status: caller.isBlocked ? 'blocked' : vip ? 'active' : 'suspended',
      lastActive: formatRelative(caller.updatedAt),
      joinDate: formatDateLabel(caller.createdAt),
      balance: caller.coins || 0,
      lastRecharge: recharge.firstPaidAt
        ? formatDateLabel(recharge.firstPaidAt)
        : '—',
      lastWithdrawal: '—',
      callSummary: {
        totalCalls: calls.total,
        totalMins: Math.round((calls.talkSeconds || 0) / 60),
        coinsSpent: Math.max(
          0,
          (recharge.coinsPurchased || 0) - (caller.coins || 0),
        ),
        level:
          calls.total >= 300
            ? 'Level 4'
            : calls.total >= 150
              ? 'Level 3'
              : calls.total >= 50
                ? 'Level 2'
                : 'Level 1',
      },
      activityStats: {
        totalCalls: calls.total,
        vipCalls: calls.completed,
        coinsSpent: Math.max(
          0,
          (recharge.coinsPurchased || 0) - (caller.coins || 0),
        ),
        avgDuration:
          calls.completed > 0
            ? `${Math.round(calls.talkSeconds / calls.completed / 60)}m`
            : '—',
      },
      recentCalls: recentCalls.map(call => ({
        id: call.id,
        name: call.receiverSnapshot?.name || 'Receiver',
        callType: 'Video',
        duration: `${String(Math.floor((call.durationSeconds || 0) / 60)).padStart(2, '0')}:${String((call.durationSeconds || 0) % 60).padStart(2, '0')}`,
        coins: Number(call.coinsCharged || 0),
        dateTime: formatDateLabel(call.createdAt),
      })),
      transactions: vipOrders.map(order => ({
        id: order.id || order._id?.toString(),
        date: formatDateLabel(order.paidAt || order.createdAt),
        type: 'VIP Purchase',
        amount: Number(order.amount) || 0,
        status: 'success',
      })),
    },
  };
}

module.exports = {
  listPlans,
  getPlanStats,
  getAnalytics,
  listVipUsers,
  getVipUser,
  getDirectoryStats,
};
