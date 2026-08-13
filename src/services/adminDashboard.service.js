const Caller = require('../models/Caller');
const Receiver = require('../models/Receiver');
const Call = require('../models/Call');
const Order = require('../models/Order');
const Withdrawal = require('../models/Withdrawal');
const UserReport = require('../models/UserReport');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_BUCKETS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

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

function formatCompact(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2).replace(/\.0$/, '')}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(n >= 10_000 ? 1 : 1).replace(/\.0$/, '')}K`;
  }
  return n.toLocaleString('en-IN');
}

function formatInrCompact(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) {
    return `₹${(n / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  }
  if (n >= 1_000) {
    return `₹${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return `₹${n.toLocaleString('en-IN', {
    maximumFractionDigits: 0,
  })}`;
}

function formatInrFull(value) {
  const n = Number(value) || 0;
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
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

function dayLabel(date) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(date).getDay()];
}

function hourBucket(date) {
  const h = new Date(date).getHours();
  const snapped = Math.floor(h / 2) * 2;
  return snapped;
}

async function distinctActiveCallers(since) {
  const [fromPresence, fromCalls, fromOrders] = await Promise.all([
    Caller.distinct('id', {
      $or: [
        {chatLastSeenAt: {$gte: since}},
        {updatedAt: {$gte: since}},
      ],
    }),
    Call.distinct('callerId', {
      createdAt: {$gte: since},
    }),
    Order.distinct('userId', {
      ...realPaidOrderFilter(),
      $or: [{paidAt: {$gte: since}}, {createdAt: {$gte: since}}],
    }),
  ]);
  return new Set([...fromPresence, ...fromCalls, ...fromOrders]).size;
}

async function buildRevenueSeries(days = 7) {
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await Order.aggregate([
    {
      $match: {
        ...realPaidOrderFilter(),
        $or: [{paidAt: {$gte: since}}, {createdAt: {$gte: since}}],
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
        _id: {
          $dateToString: {format: '%Y-%m-%d', date: '$when'},
        },
        total: {$sum: '$amount'},
      },
    },
    {$sort: {_id: 1}},
  ]);

  const byDay = new Map(rows.map(r => [r._id, Number(r.total) || 0]));
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({
      day: dayLabel(d),
      date: key,
      value: byDay.get(key) || 0,
    });
  }
  return series;
}

async function buildActivityFeed(limit = 10) {
  const [newCallers, recharges, calls, reports] = await Promise.all([
    Caller.find({})
      .sort({createdAt: -1})
      .limit(limit)
      .select('id name createdAt')
      .lean(),
    Order.find(realPaidOrderFilter())
      .sort({paidAt: -1, createdAt: -1})
      .limit(limit)
      .select('id userId amount purpose paidAt createdAt')
      .lean(),
    Call.find({})
      .sort({createdAt: -1})
      .limit(limit)
      .select('id callerId receiverId status createdAt connectedAt')
      .lean(),
    UserReport.find({})
      .sort({createdAt: -1})
      .limit(limit)
      .select('id reporterId reporterRole reason createdAt')
      .lean(),
  ]);

  const callerIds = [
    ...new Set([
      ...recharges.map(o => o.userId).filter(Boolean),
      ...calls.map(c => c.callerId).filter(Boolean),
      ...reports
        .filter(r => r.reporterRole === 'caller')
        .map(r => r.reporterId)
        .filter(Boolean),
    ]),
  ];
  const receiverIds = [
    ...new Set(calls.map(c => c.receiverId).filter(Boolean)),
  ];

  const [callers, receivers] = await Promise.all([
    Caller.find({id: {$in: callerIds}}).select('id name').lean(),
    Receiver.find({id: {$in: receiverIds}}).select('id name').lean(),
  ]);
  const callerName = new Map(callers.map(c => [c.id, c.name || 'Caller']));
  const receiverName = new Map(
    receivers.map(r => [r.id, r.name || 'Receiver']),
  );

  const events = [];

  for (const row of newCallers) {
    events.push({
      id: `reg-${row.id}`,
      title: row.name || 'New caller',
      detail: 'New user registered',
      time: relativeTime(row.createdAt),
      at: new Date(row.createdAt).getTime(),
      tone: 'pink',
    });
  }

  for (const row of recharges) {
    const name = callerName.get(row.userId) || 'Caller';
    const amount = Number(row.amount) || 0;
    const detail =
      row.purpose === 'vip'
        ? `Bought VIP · ${formatInrFull(amount)}`
        : `Recharged ${formatInrFull(amount)}`;
    events.push({
      id: `pay-${row.id}`,
      title: name,
      detail,
      time: relativeTime(row.paidAt || row.createdAt),
      at: new Date(row.paidAt || row.createdAt).getTime(),
      tone: 'amber',
    });
  }

  for (const row of calls) {
    const from = callerName.get(row.callerId) || 'Caller';
    const to = receiverName.get(row.receiverId) || 'Receiver';
    const live = ['ringing', 'accepted', 'connected'].includes(row.status);
    events.push({
      id: `call-${row.id}`,
      title: `${from} → ${to}`,
      detail: live ? 'Call started' : `Call ${row.status}`,
      time: relativeTime(row.connectedAt || row.createdAt),
      at: new Date(row.connectedAt || row.createdAt).getTime(),
      tone: 'green',
    });
  }

  for (const row of reports) {
    events.push({
      id: `rpt-${row.id}`,
      title:
        row.reporterRole === 'caller'
          ? callerName.get(row.reporterId) || 'User'
          : 'User report',
      detail: row.reason
        ? `Report submitted · ${row.reason}`
        : 'Report submitted',
      time: relativeTime(row.createdAt),
      at: new Date(row.createdAt).getTime(),
      tone: 'blue',
    });
  }

  return events
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map(({at, ...rest}) => rest);
}

async function buildIdealTime(days = 30) {
  const since = new Date(Date.now() - days * DAY_MS);
  const calls = await Call.find({
    createdAt: {$gte: since},
    durationSeconds: {$gt: 0},
  })
    .select('callerId receiverId durationSeconds connectedAt startedAt createdAt')
    .lean();

  const callerCall = Object.fromEntries(HOUR_BUCKETS.map(h => [h, 0]));
  const receiverCall = Object.fromEntries(HOUR_BUCKETS.map(h => [h, 0]));
  const callerActors = Object.fromEntries(
    HOUR_BUCKETS.map(h => [h, new Set()]),
  );
  const receiverActors = Object.fromEntries(
    HOUR_BUCKETS.map(h => [h, new Set()]),
  );

  for (const call of calls) {
    const when = call.connectedAt || call.startedAt || call.createdAt;
    if (!when) continue;
    const bucket = hourBucket(when);
    const hours = Math.max(0, Number(call.durationSeconds) || 0) / 3600;
    callerCall[bucket] += hours;
    receiverCall[bucket] += hours;
    if (call.callerId) callerActors[bucket].add(call.callerId);
    if (call.receiverId) receiverActors[bucket].add(call.receiverId);
  }

  // Presence proxy: chatLastSeenAt hour-of-day for "online/app" engagement.
  const [callerSeen, receiverSeen] = await Promise.all([
    Caller.find({
      chatLastSeenAt: {$gte: since},
    })
      .select('id chatLastSeenAt')
      .lean(),
    Receiver.find({
      $or: [{chatLastSeenAt: {$gte: since}}, {isOnline: true}],
    })
      .select('id chatLastSeenAt isOnline updatedAt')
      .lean(),
  ]);

  for (const row of callerSeen) {
    if (!row.chatLastSeenAt) continue;
    const bucket = hourBucket(row.chatLastSeenAt);
    callerActors[bucket].add(row.id);
  }
  for (const row of receiverSeen) {
    const when = row.chatLastSeenAt || row.updatedAt;
    if (!when) continue;
    const bucket = hourBucket(when);
    receiverActors[bucket].add(row.id);
  }

  const toBuckets = (callMap, actorMap, sessionHours) =>
    HOUR_BUCKETS.map(hour => {
      const call = Number((callMap[hour] / days).toFixed(2));
      const actors = actorMap[hour]?.size || 0;
      const onlineRaw = call + (actors / days) * sessionHours;
      const online = Number(Math.max(call, onlineRaw).toFixed(2));
      const idle = Number(Math.max(0, online - call).toFixed(2));
      return {hour, call, online, idle};
    });

  return {
    receiverActivity: toBuckets(receiverCall, receiverActors, 1.2),
    callerActivity: toBuckets(callerCall, callerActors, 0.25),
  };
}

/**
 * Enterprise dashboard overview — all live Mongo aggregates.
 * @param {{rangeDays?: number}} opts
 */
async function getDashboardOverview({rangeDays = 30} = {}) {
  const days = Math.min(90, Math.max(1, Number(rangeDays) || 30));
  const now = Date.now();
  const since1d = new Date(now - DAY_MS);
  const since7d = new Date(now - 7 * DAY_MS);
  const since30d = new Date(now - 30 * DAY_MS);
  const sinceRange = new Date(now - days * DAY_MS);

  const [
    totalCallers,
    totalReceivers,
    activeCalls,
    pendingVerifications,
    dau,
    wau,
    mau,
    revenueAgg,
    revenuePrevAgg,
    withdrawalsAgg,
    revenueSeries,
    activityFeed,
    idealTime,
  ] = await Promise.all([
    Caller.countDocuments({}),
    Receiver.countDocuments({}),
    Call.countDocuments({
      status: {$in: ['ringing', 'accepted', 'connected']},
    }),
    Receiver.countDocuments({status: 'pending_review'}),
    distinctActiveCallers(since1d),
    distinctActiveCallers(since7d),
    distinctActiveCallers(since30d),
    Order.aggregate([
      {$match: realPaidOrderFilter()},
      {$group: {_id: null, total: {$sum: {$ifNull: ['$amount', 0]}}}},
    ]),
    Order.aggregate([
      {
        $match: {
          ...realPaidOrderFilter(),
          $or: [
            {paidAt: {$gte: sinceRange}},
            {createdAt: {$gte: sinceRange}},
          ],
        },
      },
      {$group: {_id: null, total: {$sum: {$ifNull: ['$amount', 0]}}}},
    ]),
    Withdrawal.aggregate([
      {
        $match: {
          status: {$in: ['paid', 'pending_review', 'approved']},
        },
      },
      {
        $group: {
          _id: null,
          total: {$sum: {$ifNull: ['$amountInr', 0]}},
          paid: {
            $sum: {
              $cond: [{$eq: ['$status', 'paid']}, {$ifNull: ['$amountInr', 0]}, 0],
            },
          },
        },
      },
    ]),
    buildRevenueSeries(7),
    buildActivityFeed(10),
    buildIdealTime(days),
  ]);

  const totalRevenue = Number(revenueAgg?.[0]?.total) || 0;
  const rangeRevenue = Number(revenuePrevAgg?.[0]?.total) || 0;
  const withdrawalsTotal = Number(withdrawalsAgg?.[0]?.total) || 0;
  const withdrawalsPaid = Number(withdrawalsAgg?.[0]?.paid) || 0;

  // Downloads: no install tracker yet — use caller installs with floor of 100
  // as requested baseline until store analytics are wired.
  const downloads = Math.max(100, totalCallers);

  const kpisTop = [
    {id: 'downloads', label: 'Downloads', value: formatCompact(downloads)},
    {id: 'dau', label: 'DAU', value: formatCompact(dau)},
    {id: 'wau', label: 'WAU', value: formatCompact(wau)},
    {id: 'mau', label: 'MAU', value: formatCompact(mau)},
    {id: 'users', label: 'Total Users', value: formatCompact(totalCallers)},
  ];

  const kpisBottom = [
    {
      id: 'receivers',
      label: 'Receivers',
      value: formatCompact(totalReceivers),
    },
    {
      id: 'calls',
      label: 'Active Calls',
      value: formatCompact(activeCalls),
    },
    {
      id: 'pending',
      label: 'Pending Verif.',
      value: formatCompact(pendingVerifications),
    },
    {
      id: 'revenue',
      label: 'Revenue',
      value: formatInrCompact(totalRevenue),
      trend: rangeRevenue > 0 ? 'up' : undefined,
    },
    {
      id: 'withdrawals',
      label: 'Withdrawals',
      value: formatInrCompact(withdrawalsTotal),
    },
  ];

  const receiverMax = Math.max(
    1,
    ...idealTime.receiverActivity.map(b => b.online),
  );
  const callerMax = Math.max(1, ...idealTime.callerActivity.map(b => b.online));

  return {
    rangeDays: days,
    generatedAt: new Date().toISOString(),
    kpisTop,
    kpisBottom,
    raw: {
      downloads,
      dau,
      wau,
      mau,
      totalCallers,
      totalReceivers,
      activeCalls,
      pendingVerifications,
      totalRevenue,
      rangeRevenue,
      withdrawalsTotal,
      withdrawalsPaid,
    },
    revenueSeries,
    activityFeed,
    receiverActivity: idealTime.receiverActivity,
    callerActivity: idealTime.callerActivity,
    receiverMaxY: Math.ceil(receiverMax),
    callerMaxY: Number(Math.max(0.5, callerMax).toFixed(1)),
  };
}

module.exports = {
  getDashboardOverview,
};
