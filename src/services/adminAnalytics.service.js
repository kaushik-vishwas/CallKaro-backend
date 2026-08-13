const Caller = require('../models/Caller');
const Receiver = require('../models/Receiver');
const Agent = require('../models/Agent');
const Call = require('../models/Call');
const Order = require('../models/Order');
const Withdrawal = require('../models/Withdrawal');
const UserReport = require('../models/UserReport');

const DAY_MS = 24 * 60 * 60 * 1000;
const AGENT_COMMISSION_RATE = 0.4;
const PACKAGE_TONES = ['pink', 'purple', 'blue', 'gold', 'green', 'dark'];

const DEDUCTION_RATES = [
  {id: 'gst', label: 'GST (18%)', rate: 0.18, color: '#ef4444'},
  {id: 'play', label: 'Google Play (15%)', rate: 0.15, color: '#f97316'},
  {id: 'gw', label: 'Payment GW (2%)', rate: 0.02, color: '#eab308'},
  {id: 'video', label: 'Video API (2%)', rate: 0.02, color: '#8b5cf6'},
  {id: 'misc', label: 'Misc (1%)', rate: 0.01, color: '#9ca3af'},
];

function realPaidOrderFilter(extra = {}) {
  return {
    status: 'paid',
    razorpayPaymentId: {
      $type: 'string',
      $ne: '',
      $not: /^pay_test_/i,
    },
    ...extra,
  };
}

function clampDays(value, fallback = 30, max = 365) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.round(n)));
}

function sinceFromDays(days) {
  return new Date(Date.now() - days * DAY_MS);
}

function periodToDays(period) {
  const key = String(period || '').toLowerCase();
  if (key === 'daily' || key === 'day') return 1;
  if (key === 'weekly' || key === 'week') return 7;
  if (key === 'monthly' || key === 'month') return 30;
  if (key === 'quarterly' || key === 'quarter') return 90;
  if (key === 'yearly' || key === 'year') return 365;
  if (key === 'lifetime' || key === 'all') return null;
  return 30;
}

function formatCompact(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2).replace(/\.0+$/, '')}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return n.toLocaleString('en-IN');
}

function formatInr(value) {
  const n = Number(value) || 0;
  return `₹${n.toLocaleString('en-IN', {
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  })}`;
}

function formatInrCompact(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) {
    return `₹${(n / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  }
  if (n >= 1_000) {
    return `₹${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return formatInr(n);
}

function formatDurationHours(hours) {
  const h = Math.max(0, Number(hours) || 0);
  if (h >= 10) return `${Math.round(h).toLocaleString('en-IN')} hr`;
  return `${h.toFixed(1)} hr`;
}

function formatTalkTime(seconds) {
  const mins = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  return `${mins.toLocaleString('en-IN')} min`;
}

function relativeTime(date) {
  if (!date) return '';
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function paidWhenMatch(since) {
  if (!since) return {};
  return {
    $or: [{paidAt: {$gte: since}}, {createdAt: {$gte: since}}],
  };
}

function callWhenMatch(since) {
  if (!since) return {};
  return {
    $or: [
      {endedAt: {$gte: since}},
      {connectedAt: {$gte: since}},
      {createdAt: {$gte: since}},
    ],
  };
}

async function sumPaidRevenue(since) {
  const match = {
    ...realPaidOrderFilter(),
    ...(since ? paidWhenMatch(since) : {}),
  };
  const rows = await Order.aggregate([
    {$match: match},
    {
      $group: {
        _id: null,
        total: {$sum: {$ifNull: ['$amount', 0]}},
        coins: {$sum: {$ifNull: ['$coins', 0]}},
        buyers: {$addToSet: '$userId'},
        count: {$sum: 1},
      },
    },
  ]);
  return {
    total: Number(rows[0]?.total) || 0,
    coins: Number(rows[0]?.coins) || 0,
    buyers: Array.isArray(rows[0]?.buyers) ? rows[0].buyers.length : 0,
    count: Number(rows[0]?.count) || 0,
  };
}

async function distinctActiveCallers(since) {
  const [fromPresence, fromCalls, fromOrders] = await Promise.all([
    Caller.distinct('id', {
      $or: [
        {chatLastSeenAt: {$gte: since}},
        {updatedAt: {$gte: since}},
      ],
    }),
    Call.distinct('callerId', {createdAt: {$gte: since}}),
    Order.distinct('userId', {
      ...realPaidOrderFilter(),
      ...paidWhenMatch(since),
    }),
  ]);
  return new Set([...fromPresence, ...fromCalls, ...fromOrders]).size;
}

async function buildRevenueSeries(days = 7) {
  const since = sinceFromDays(days);
  const rows = await Order.aggregate([
    {
      $match: {
        ...realPaidOrderFilter(),
        ...paidWhenMatch(since),
      },
    },
    {
      $project: {
        amount: {$ifNull: ['$amount', 0]},
        when: {$ifNull: ['$paidAt', '$createdAt']},
      },
    },
    {
      $group: {
        _id: {$dateToString: {format: '%Y-%m-%d', date: '$when'}},
        total: {$sum: '$amount'},
      },
    },
    {$sort: {_id: 1}},
  ]);
  const byDay = new Map(rows.map(r => [r._id, Number(r.total) || 0]));
  const points = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    const label = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    points.push({label, date: key, value: byDay.get(key) || 0});
  }
  return points;
}

async function buildUserGrowth(months = 6) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCMonth(start.getUTCMonth() - (months - 1));

  const rows = await Caller.aggregate([
    {$match: {createdAt: {$gte: start}}},
    {
      $group: {
        _id: {$dateToString: {format: '%Y-%m', date: '$createdAt'}},
        count: {$sum: 1},
      },
    },
    {$sort: {_id: 1}},
  ]);
  const byMonth = new Map(rows.map(r => [r._id, Number(r.count) || 0]));
  const points = [];
  let cumulative = await Caller.countDocuments({createdAt: {$lt: start}});
  for (let i = 0; i < months; i += 1) {
    const d = new Date(start);
    d.setUTCMonth(start.getUTCMonth() + i);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    cumulative += byMonth.get(key) || 0;
    points.push({
      label: d.toLocaleString('en-US', {month: 'short'}),
      value: cumulative,
    });
  }
  return points;
}

async function buildActivityFeed(limit = 12) {
  const [callers, receivers, orders, calls, reports, withdrawals] =
    await Promise.all([
      Caller.find({}).sort({createdAt: -1}).limit(8).select('id name createdAt').lean(),
      Receiver.find({})
        .sort({updatedAt: -1})
        .limit(8)
        .select('id name status updatedAt submittedAt')
        .lean(),
      Order.find(realPaidOrderFilter())
        .sort({paidAt: -1, createdAt: -1})
        .limit(8)
        .select('id userId amount purpose paidAt createdAt')
        .lean(),
      Call.find({})
        .sort({createdAt: -1})
        .limit(8)
        .select('id callerId receiverId status createdAt connectedAt')
        .lean(),
      UserReport.find({})
        .sort({createdAt: -1})
        .limit(6)
        .select('id reporterRole reporterId reason createdAt')
        .lean(),
      Withdrawal.find({})
        .sort({createdAt: -1})
        .limit(6)
        .select('id receiverId amountInr status createdAt')
        .lean(),
    ]);

  const callerIds = new Set([
    ...orders.map(o => o.userId),
    ...calls.map(c => c.callerId),
    ...reports.filter(r => r.reporterRole === 'caller').map(r => r.reporterId),
  ]);
  const receiverIds = new Set([
    ...calls.map(c => c.receiverId),
    ...withdrawals.map(w => w.receiverId),
  ]);
  const [callerRows, receiverRows] = await Promise.all([
    Caller.find({id: {$in: [...callerIds]}})
      .select('id name')
      .lean(),
    Receiver.find({id: {$in: [...receiverIds]}})
      .select('id name')
      .lean(),
  ]);
  const callerName = new Map(callerRows.map(r => [r.id, r.name]));
  const receiverName = new Map(receiverRows.map(r => [r.id, r.name]));

  const events = [];
  for (const row of callers) {
    events.push({
      id: `reg-${row.id}`,
      text: `${row.name || 'Caller'} (New user registered)`,
      time: relativeTime(row.createdAt),
      at: new Date(row.createdAt).getTime(),
    });
  }
  for (const row of orders) {
    const name = callerName.get(row.userId) || 'Caller';
    events.push({
      id: `ord-${row.id}`,
      text: `${name} (${row.purpose === 'vip' ? 'Purchased VIP' : `Recharged ${formatInr(row.amount)}`})`,
      time: relativeTime(row.paidAt || row.createdAt),
      at: new Date(row.paidAt || row.createdAt).getTime(),
    });
  }
  for (const row of calls) {
    const from = callerName.get(row.callerId) || 'Caller';
    const to = receiverName.get(row.receiverId) || 'Receiver';
    events.push({
      id: `call-${row.id}`,
      text: `${from} + ${to} (Call ${row.status})`,
      time: relativeTime(row.connectedAt || row.createdAt),
      at: new Date(row.connectedAt || row.createdAt).getTime(),
    });
  }
  for (const row of reports) {
    events.push({
      id: `rpt-${row.id}`,
      text: `User #${String(row.reporterId || '').slice(-4) || '—'} (Report submitted)`,
      time: relativeTime(row.createdAt),
      at: new Date(row.createdAt).getTime(),
    });
  }
  for (const row of withdrawals) {
    const name = receiverName.get(row.receiverId) || 'Receiver';
    events.push({
      id: `wd-${row.id}`,
      text: `${name} (Withdrew ${formatInr(row.amountInr)})`,
      time: relativeTime(row.createdAt),
      at: new Date(row.createdAt).getTime(),
    });
  }
  for (const row of receivers) {
    if (row.status === 'pending_review' || row.submittedAt) {
      events.push({
        id: `kyc-${row.id}`,
        text: `${row.name || 'Receiver'} (Requested KYC review)`,
        time: relativeTime(row.submittedAt || row.updatedAt),
        at: new Date(row.submittedAt || row.updatedAt).getTime(),
      });
    }
  }

  return events
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map(({at, ...rest}) => rest);
}

async function getOverview({rangeDays = 30} = {}) {
  const days = clampDays(rangeDays, 30, 365);
  const since = sinceFromDays(days);
  const since1d = sinceFromDays(1);
  const since7d = sinceFromDays(7);
  const since30d = sinceFromDays(30);

  const [
    totalCallers,
    totalReceivers,
    activeReceivers,
    totalAgents,
    dau,
    wau,
    mau,
    revenueAll,
    revenueRange,
    withdrawalsAgg,
    callsAll,
    callsRange,
    avgDurationAgg,
    payingCallers,
    revenueSeries,
    userGrowth,
    activityFeed,
  ] = await Promise.all([
    Caller.countDocuments({}),
    Receiver.countDocuments({}),
    Receiver.countDocuments({status: 'active'}),
    Agent.countDocuments({}),
    distinctActiveCallers(since1d),
    distinctActiveCallers(since7d),
    distinctActiveCallers(since30d),
    sumPaidRevenue(null),
    sumPaidRevenue(since),
    Withdrawal.aggregate([
      {
        $match: {
          status: {$in: ['paid', 'pending_review', 'approved']},
          createdAt: {$gte: since},
        },
      },
      {$group: {_id: null, total: {$sum: {$ifNull: ['$amountInr', 0]}}}},
    ]),
    Call.countDocuments({}),
    Call.countDocuments(callWhenMatch(since)),
    Call.aggregate([
      {$match: {durationSeconds: {$gt: 0}, ...callWhenMatch(since)}},
      {
        $group: {
          _id: null,
          avg: {$avg: '$durationSeconds'},
          count: {$sum: 1},
        },
      },
    ]),
    Order.distinct('userId', {
      ...realPaidOrderFilter(),
      ...paidWhenMatch(since),
    }),
    buildRevenueSeries(Math.min(days, 14)),
    buildUserGrowth(6),
    buildActivityFeed(12),
  ]);

  const avgSessionSec = Number(avgDurationAgg[0]?.avg) || 0;
  const avgMins = Math.floor(avgSessionSec / 60);
  const avgSecs = Math.round(avgSessionSec % 60);
  const conversion =
    totalCallers > 0
      ? ((payingCallers.length / totalCallers) * 100).toFixed(1)
      : '0.0';
  const withdrawals = Number(withdrawalsAgg[0]?.total) || 0;
  const revenueTrend =
    revenueRange.total > 0 && revenueAll.total > 0 ? 'up' : undefined;

  const kpis = [
    {
      id: 'downloads',
      label: 'Downloads',
      value: formatCompact(Math.max(100, totalCallers)),
      tone: 'pink',
    },
    {
      id: 'registered',
      label: 'Registered Users',
      value: formatCompact(totalCallers),
      tone: 'purple',
    },
    {
      id: 'receivers',
      label: 'Total Receivers',
      value: formatCompact(totalReceivers),
      tone: 'blue',
    },
    {
      id: 'activeReceivers',
      label: 'Active Receivers',
      value: formatCompact(activeReceivers),
      tone: 'green',
    },
    {
      id: 'agents',
      label: 'Total Agents',
      value: formatCompact(totalAgents),
      tone: 'gold',
    },
    {
      id: 'franchises',
      label: 'Total Franchises',
      value: '0',
      tone: 'dark',
    },
    {id: 'dau', label: 'DAU', value: formatCompact(dau), tone: 'pink'},
    {id: 'wau', label: 'WAU', value: formatCompact(wau), tone: 'purple'},
    {id: 'mau', label: 'MAU', value: formatCompact(mau), tone: 'blue'},
    {
      id: 'totalUsers',
      label: 'Total Users',
      value: formatCompact(totalCallers + totalReceivers),
      tone: 'dark',
    },
    {
      id: 'revenue',
      label: 'Revenue',
      value: formatInrCompact(revenueRange.total || revenueAll.total),
      tone: 'green',
      trend: revenueTrend,
    },
    {
      id: 'withdrawals',
      label: 'Withdrawals',
      value: formatInrCompact(withdrawals),
      tone: 'gold',
    },
    {
      id: 'calls',
      label: 'Total Calls',
      value: formatCompact(callsRange || callsAll),
      tone: 'pink',
    },
    {
      id: 'avgSession',
      label: 'Avg Session',
      value: avgSessionSec > 0 ? `${avgMins}m ${avgSecs}s` : '0m 0s',
      tone: 'purple',
    },
    {
      id: 'conversion',
      label: 'Conversion',
      value: `${conversion}%`,
      tone: 'green',
    },
  ];

  return {
    rangeDays: days,
    kpis,
    revenueSeries,
    userGrowth,
    activityFeed,
    raw: {
      totalCallers,
      totalReceivers,
      revenue: revenueRange.total,
      calls: callsRange,
    },
  };
}

async function getPackages({rangeDays = 30} = {}) {
  const days = clampDays(rangeDays, 30, 365);
  const since = sinceFromDays(days);
  const rows = await Order.aggregate([
    {
      $match: {
        ...realPaidOrderFilter(),
        purpose: {$ne: 'vip'},
        ...paidWhenMatch(since),
      },
    },
    {
      $group: {
        _id: {
          amount: {$ifNull: ['$amount', 0]},
          coins: {$ifNull: ['$coins', 0]},
        },
        revenue: {$sum: {$ifNull: ['$amount', 0]}},
        buyers: {$addToSet: '$userId'},
        orders: {$sum: 1},
      },
    },
    {$sort: {revenue: -1}},
    {$limit: 12},
  ]);

  const packages = rows.map((row, index) => {
    const amount = Number(row._id?.amount) || 0;
    const coins = Number(row._id?.coins) || 0;
    const buyers = Array.isArray(row.buyers) ? row.buyers.length : 0;
    return {
      id: `pkg-${amount}-${coins}-${index}`,
      priceLabel: `${formatInr(amount)} Package`,
      coins: `${coins.toLocaleString('en-IN')} Coins`,
      revenue: formatInr(Number(row.revenue) || 0),
      revenueValue: Number(row.revenue) || 0,
      buyers,
      orders: Number(row.orders) || 0,
      tone: PACKAGE_TONES[index % PACKAGE_TONES.length],
    };
  });

  return {rangeDays: days, packages};
}

async function getCallerRankings({limit = 10, rangeDays = 30} = {}) {
  const top = Math.min(100, Math.max(10, Number(limit) || 10));
  const days = clampDays(rangeDays, 30, 365);
  const since = sinceFromDays(days);

  const [spendRows, lifetimeRows, callRows] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          ...realPaidOrderFilter(),
          ...paidWhenMatch(since),
        },
      },
      {
        $group: {
          _id: '$userId',
          totalSpend: {$sum: {$ifNull: ['$amount', 0]}},
          coinsPurchased: {$sum: {$ifNull: ['$coins', 0]}},
        },
      },
      {$sort: {totalSpend: -1}},
      {$limit: top},
    ]),
    Order.aggregate([
      {$match: realPaidOrderFilter()},
      {
        $group: {
          _id: '$userId',
          lifetimeRevenue: {$sum: {$ifNull: ['$amount', 0]}},
        },
      },
    ]),
    Call.aggregate([
      {$match: callWhenMatch(since)},
      {
        $group: {
          _id: '$callerId',
          callsMade: {$sum: 1},
          talkSeconds: {$sum: {$ifNull: ['$durationSeconds', 0]}},
        },
      },
    ]),
  ]);

  const lifetimeMap = new Map(
    lifetimeRows.map(r => [r._id, Number(r.lifetimeRevenue) || 0]),
  );
  const callMap = new Map(
    callRows.map(r => [
      r._id,
      {
        callsMade: Number(r.callsMade) || 0,
        talkSeconds: Number(r.talkSeconds) || 0,
      },
    ]),
  );

  const ids = spendRows.map(r => r._id).filter(Boolean);
  const callers = await Caller.find({id: {$in: ids}})
    .select('id name lifetimeTalkSeconds lifetimeRechargedCoins')
    .lean();
  const nameMap = new Map(callers.map(c => [c.id, c]));

  const rankings = spendRows.map((row, index) => {
    const caller = nameMap.get(row._id);
    const calls = callMap.get(row._id) || {callsMade: 0, talkSeconds: 0};
    return {
      rank: index + 1,
      id: row._id,
      name: caller?.name || row._id || 'Caller',
      totalSpend: Number(row.totalSpend) || 0,
      coinsPurchased:
        Number(row.coinsPurchased) ||
        Number(caller?.lifetimeRechargedCoins) ||
        0,
      callsMade: calls.callsMade,
      talkTime: formatTalkTime(calls.talkSeconds),
      talkSeconds: calls.talkSeconds,
      lifetimeRevenue: lifetimeMap.get(row._id) || Number(row.totalSpend) || 0,
    };
  });

  return {rangeDays: days, limit: top, rankings};
}

async function getReceiverRankings({period = 'monthly', limit = 50} = {}) {
  const days = periodToDays(period);
  const since = days == null ? null : sinceFromDays(days);
  const top = Math.min(100, Math.max(10, Number(limit) || 50));

  const callMatch = {
    status: 'ended',
    ...(since ? callWhenMatch(since) : {}),
  };

  const rows = await Call.aggregate([
    {$match: callMatch},
    {
      $group: {
        _id: '$receiverId',
        callsHandled: {$sum: 1},
        coinsEarned: {$sum: {$ifNull: ['$receiverCoinsCredited', 0]}},
        revenue: {$sum: {$ifNull: ['$receiverEarningsInr', 0]}},
        talkSeconds: {$sum: {$ifNull: ['$durationSeconds', 0]}},
      },
    },
    {$sort: {revenue: -1, callsHandled: -1}},
    {$limit: top},
  ]);

  // Fallback to receiver.earnings when no call window data
  let rankingsSource = rows;
  if (!rankingsSource.length && !since) {
    const receivers = await Receiver.find({})
      .sort({earnings: -1})
      .limit(top)
      .select('id name earnings totalCalls totalHours')
      .lean();
    rankingsSource = receivers.map(r => ({
      _id: r.id,
      callsHandled: Number(r.totalCalls) || 0,
      coinsEarned: Math.round((Number(r.earnings) || 0) * 25),
      revenue: Number(r.earnings) || 0,
      talkSeconds: Math.round((Number(r.totalHours) || 0) * 3600 * 0.7),
      _fallback: true,
    }));
  }

  const ids = rankingsSource.map(r => r._id).filter(Boolean);
  const receivers = await Receiver.find({id: {$in: ids}})
    .select('id name totalHours isOnline')
    .lean();
  const map = new Map(receivers.map(r => [r.id, r]));

  const rankings = rankingsSource.map((row, index) => {
    const receiver = map.get(row._id);
    const talkHours = (Number(row.talkSeconds) || 0) / 3600;
    const onlineHours = Math.max(
      talkHours,
      Number(receiver?.totalHours) || talkHours * 1.2,
    );
    const idleHours = Math.max(0, onlineHours - talkHours);
    const utilization =
      onlineHours > 0 ? Math.round((talkHours / onlineHours) * 100) : 0;
    return {
      rank: index + 1,
      id: row._id,
      name: receiver?.name || row._id || 'Receiver',
      callsHandled: Number(row.callsHandled) || 0,
      coinsEarned: Number(row.coinsEarned) || 0,
      revenue: Number(row.revenue) || 0,
      onlineTime: formatDurationHours(onlineHours),
      idleTime: formatDurationHours(idleHours),
      utilization,
    };
  });

  return {period: String(period || 'monthly'), rankings};
}

async function getAgentRankings({period = 'monthly'} = {}) {
  const days = periodToDays(period) ?? 30;
  const since = sinceFromDays(days);
  const prevSince = sinceFromDays(days * 2);

  const agents = await Agent.find({}).select('id name agentCode isActive').lean();
  const agentIds = agents.map(a => a.id);

  const receivers = await Receiver.find({agentId: {$in: agentIds}})
    .select('id agentId')
    .lean();
  const receiverToAgent = new Map(receivers.map(r => [r.id, r.agentId]));
  const receiversByAgent = new Map();
  for (const r of receivers) {
    const list = receiversByAgent.get(r.agentId) || [];
    list.push(r.id);
    receiversByAgent.set(r.agentId, list);
  }

  const [currentRows, prevRows] = await Promise.all([
    Call.aggregate([
      {$match: {status: 'ended', ...callWhenMatch(since)}},
      {
        $group: {
          _id: '$receiverId',
          revenue: {$sum: {$ifNull: ['$receiverEarningsInr', 0]}},
        },
      },
    ]),
    Call.aggregate([
      {
        $match: {
          status: 'ended',
          ...callWhenMatch(prevSince),
          endedAt: {$lt: since},
        },
      },
      {
        $group: {
          _id: '$receiverId',
          revenue: {$sum: {$ifNull: ['$receiverEarningsInr', 0]}},
        },
      },
    ]),
  ]);

  const currentByAgent = new Map();
  const prevByAgent = new Map();
  const receiverRevenue = new Map();

  for (const row of currentRows) {
    const agentId = receiverToAgent.get(row._id);
    if (!agentId) continue;
    const revenue = Number(row.revenue) || 0;
    receiverRevenue.set(row._id, revenue);
    currentByAgent.set(agentId, (currentByAgent.get(agentId) || 0) + revenue);
  }
  for (const row of prevRows) {
    const agentId = receiverToAgent.get(row._id);
    if (!agentId) continue;
    prevByAgent.set(
      agentId,
      (prevByAgent.get(agentId) || 0) + (Number(row.revenue) || 0),
    );
  }

  // Lifetime fallback when period has no calls
  if (![...currentByAgent.values()].some(v => v > 0)) {
    const lifetime = await Receiver.aggregate([
      {$match: {agentId: {$in: agentIds}}},
      {
        $group: {
          _id: '$agentId',
          earnings: {$sum: {$ifNull: ['$earnings', 0]}},
        },
      },
    ]);
    for (const row of lifetime) {
      currentByAgent.set(row._id, Number(row.earnings) || 0);
    }
  }

  const rankings = agents
    .map(agent => {
      const earnings = currentByAgent.get(agent.id) || 0;
      const prev = prevByAgent.get(agent.id) || 0;
      const receiversCount = (receiversByAgent.get(agent.id) || []).length;
      const revenue = Math.round(earnings * 2.5);
      const commission = Math.round(earnings * AGENT_COMMISSION_RATE);
      const growth =
        prev > 0
          ? Number((((earnings - prev) / prev) * 100).toFixed(1))
          : earnings > 0
            ? 100
            : 0;
      return {
        id: agent.id,
        name: agent.name,
        receivers: receiversCount,
        revenue,
        commission,
        avgReceiverRevenue:
          receiversCount > 0 ? Math.round(revenue / receiversCount) : 0,
        growth,
        earnings,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.commission - a.commission)
    .map((row, index) => ({...row, rank: index + 1}));

  const topAgent = rankings[0];
  let breakdown = [];
  if (topAgent) {
    const recvIds = receiversByAgent.get(topAgent.id) || [];
    const recvDocs = await Receiver.find({id: {$in: recvIds}})
      .select('id name earnings')
      .lean();
    breakdown = recvDocs
      .map(r => {
        const earnings =
          receiverRevenue.get(r.id) ?? (Number(r.earnings) || 0);
        const revenue = Math.round(earnings * 2.5);
        return {
          id: r.id,
          name: r.name,
          revenue,
          commission: Math.round(earnings * AGENT_COMMISSION_RATE),
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }

  return {
    period: String(period || 'monthly'),
    rankings: rankings.slice(0, 25),
    breakdown,
    topAgentId: topAgent?.id || null,
  };
}

async function monthlySplitSeries(months = 5) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCMonth(start.getUTCMonth() - (months - 1));

  const [orderRows, callRows] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          ...realPaidOrderFilter(),
          $or: [{paidAt: {$gte: start}}, {createdAt: {$gte: start}}],
        },
      },
      {
        $project: {
          amount: {$ifNull: ['$amount', 0]},
          when: {$ifNull: ['$paidAt', '$createdAt']},
        },
      },
      {
        $group: {
          _id: {$dateToString: {format: '%Y-%m', date: '$when'}},
          gross: {$sum: '$amount'},
        },
      },
    ]),
    Call.aggregate([
      {
        $match: {
          status: 'ended',
          $or: [
            {endedAt: {$gte: start}},
            {createdAt: {$gte: start}},
          ],
        },
      },
      {
        $project: {
          earnings: {$ifNull: ['$receiverEarningsInr', 0]},
          when: {$ifNull: ['$endedAt', '$createdAt']},
        },
      },
      {
        $group: {
          _id: {$dateToString: {format: '%Y-%m', date: '$when'}},
          receiver: {$sum: '$earnings'},
        },
      },
    ]),
  ]);

  const grossMap = new Map(orderRows.map(r => [r._id, Number(r.gross) || 0]));
  const recvMap = new Map(callRows.map(r => [r._id, Number(r.receiver) || 0]));
  const series = [];
  for (let i = 0; i < months; i += 1) {
    const d = new Date(start);
    d.setUTCMonth(start.getUTCMonth() + i);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const gross = grossMap.get(key) || 0;
    const receiver = recvMap.get(key) || 0;
    const agent = Math.round(receiver * AGENT_COMMISSION_RATE);
    const platform = Math.max(0, Math.round(gross - receiver - agent));
    series.push({
      label: d.toLocaleString('en-US', {month: 'short'}),
      platform,
      receiver,
      agent,
      gross,
    });
  }
  return series;
}

async function getGrossProfit({rangeDays = 30} = {}) {
  const days = clampDays(rangeDays, 30, 365);
  const since = sinceFromDays(days);
  const [grossAgg, receiverAgg, monthly] = await Promise.all([
    sumPaidRevenue(since),
    Call.aggregate([
      {$match: {status: 'ended', ...callWhenMatch(since)}},
      {
        $group: {
          _id: null,
          receiver: {$sum: {$ifNull: ['$receiverEarningsInr', 0]}},
        },
      },
    ]),
    monthlySplitSeries(5),
  ]);

  const totalGrossRevenue = grossAgg.total;
  const receiverShare = Number(receiverAgg[0]?.receiver) || 0;
  const agentShare = Math.round(receiverShare * AGENT_COMMISSION_RATE);
  const platformShare = Math.max(
    0,
    Math.round(totalGrossRevenue - receiverShare - agentShare),
  );
  const total = platformShare + receiverShare + agentShare || 1;
  const split = [
    {
      id: 'platform',
      label: 'Platform',
      percent: Math.round((platformShare / total) * 100),
      amount: platformShare,
      color: '#1e3a8a',
    },
    {
      id: 'receiver',
      label: 'Receiver',
      percent: Math.round((receiverShare / total) * 100),
      amount: Math.round(receiverShare),
      color: '#ec4899',
    },
    {
      id: 'agent',
      label: 'Agent',
      percent: Math.round((agentShare / total) * 100),
      amount: agentShare,
      color: '#f59e0b',
    },
  ];

  return {
    rangeDays: days,
    totalGrossRevenue,
    netPlatformShare: platformShare,
    split,
    monthly,
  };
}

async function getNetProfit({rangeDays = 30} = {}) {
  const days = clampDays(rangeDays, 30, 365);
  const since = sinceFromDays(days);
  const grossAgg = await sumPaidRevenue(since);
  const grossRevenue = grossAgg.total;
  const waterfall = [
    {
      id: 'gross',
      label: 'Gross Revenue',
      value: grossRevenue,
      kind: 'start',
      color: '#1e3a8a',
    },
  ];
  let running = grossRevenue;
  let totalDeductions = 0;
  for (const item of DEDUCTION_RATES) {
    const amount = -Math.round(grossRevenue * item.rate);
    totalDeductions += Math.abs(amount);
    running += amount;
    waterfall.push({
      id: item.id,
      label: item.label,
      value: amount,
      kind: 'deduction',
      color: item.color,
    });
  }
  const netRevenue = Math.max(0, Math.round(running));
  waterfall.push({
    id: 'net',
    label: 'Net Revenue',
    value: netRevenue,
    kind: 'end',
    color: '#ec4899',
  });
  const netMargin =
    grossRevenue > 0
      ? `${((netRevenue / grossRevenue) * 100).toFixed(1)}%`
      : '0.0%';

  return {
    rangeDays: days,
    grossRevenue,
    totalDeductions,
    netRevenue,
    netMargin,
    waterfall,
  };
}

module.exports = {
  getOverview,
  getPackages,
  getCallerRankings,
  getReceiverRankings,
  getAgentRankings,
  getGrossProfit,
  getNetProfit,
};
