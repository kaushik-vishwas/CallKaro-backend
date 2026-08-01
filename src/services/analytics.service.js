const Receiver = require('../models/Receiver');

const RANGES = {
  '7d': {days: 7, label: 'LAST 7 DAYS'},
  '1m': {days: 30, label: 'LAST 1 MONTH'},
  '3m': {days: 90, label: 'LAST 3 MONTHS'},
};

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function hashSeed(id) {
  const s = String(id || 'receiver');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h || 1;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function formatDuration(totalMinutes) {
  const totalSecs = Math.max(0, Math.round(Number(totalMinutes) * 60));
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${String(s).padStart(2, '0')} min`;
}

function avgCallMinutes(receiver) {
  const calls = Math.max(0, Number(receiver.totalCalls) || 0);
  const hours = Math.max(0, Number(receiver.totalHours) || 0);
  if (calls > 0 && hours > 0) {
    return (hours * 60) / calls;
  }
  // Default matching design when no real talk-time data
  return 7 + 24 / 60;
}

function bucketLabels(days) {
  const labels = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    if (days <= 7) {
      labels.push({
        key: d.toISOString().slice(0, 10),
        label: DAY_SHORT[d.getDay()],
        date: d,
      });
    } else if (days <= 30) {
      labels.push({
        key: d.toISOString().slice(0, 10),
        label: String(d.getDate()),
        date: d,
      });
    } else {
      // Weekly buckets for 3M — group later
      labels.push({
        key: d.toISOString().slice(0, 10),
        label: DAY_SHORT[d.getDay()],
        date: d,
      });
    }
  }
  return labels;
}

function compressToChartPoints(daily, maxPoints) {
  if (daily.length <= maxPoints) {
    return daily;
  }
  const size = Math.ceil(daily.length / maxPoints);
  const out = [];
  for (let i = 0; i < daily.length; i += size) {
    const slice = daily.slice(i, i + size);
    const earningsInr = slice.reduce((s, p) => s + p.earningsInr, 0);
    const calls = slice.reduce((s, p) => s + p.calls, 0);
    const last = slice[slice.length - 1];
    out.push({
      key: last.key,
      label: last.label,
      earningsInr: Math.round(earningsInr),
      calls,
    });
  }
  return out;
}

function buildSeries(receiver, rangeKey) {
  const cfg = RANGES[rangeKey] || RANGES['7d'];
  const days = cfg.days;
  const rand = mulberry32(hashSeed(receiver._id) + days);
  const totalBase =
    Number(receiver.earnings) ||
    Number(receiver.walletBalance) ||
    Number(receiver.pendingEarnings) ||
    0;

  // Scale period total from lifetime (demo-friendly floors)
  const periodShare = days <= 7 ? 0.35 : days <= 30 ? 0.7 : 1;
  let periodTotal = Math.round(totalBase * periodShare);
  if (periodTotal < 500) {
    periodTotal = days <= 7 ? 7060 : days <= 30 ? 18400 : 48200;
  }

  const totalCallsBase = Math.max(0, Number(receiver.totalCalls) || 0);
  let periodCalls = Math.max(
    1,
    Math.round(totalCallsBase * periodShare) || (days <= 7 ? 28 : days <= 30 ? 95 : 240),
  );

  const dayMeta = bucketLabels(days);
  const weights = dayMeta.map(() => 0.35 + rand() * 1.4);
  // Boost weekend / last day slightly for a clear "top day"
  const peakIndex = dayMeta.reduce((best, _, i) => {
    const w = weights[i] * (dayMeta[i].date.getDay() === 0 ? 1.55 : 1);
    weights[i] = w;
    return w > weights[best] ? i : best;
  }, 0);
  weights[peakIndex] *= 1.35;

  const weightSum = weights.reduce((a, b) => a + b, 0);
  let remainingEarn = periodTotal;
  let remainingCalls = periodCalls;
  const daily = dayMeta.map((meta, i) => {
    const isLast = i === dayMeta.length - 1;
    const earn = isLast
      ? remainingEarn
      : Math.max(0, Math.round((periodTotal * weights[i]) / weightSum));
    const calls = isLast
      ? remainingCalls
      : Math.max(0, Math.round((periodCalls * weights[i]) / weightSum));
    remainingEarn -= earn;
    remainingCalls -= calls;
    return {
      key: meta.key,
      label: meta.label,
      earningsInr: earn,
      calls,
      weekday: DAY_SHORT[meta.date.getDay()],
      fullDayName: meta.date.toLocaleDateString('en-IN', {weekday: 'long'}),
    };
  });

  const chartPoints =
    days <= 7
      ? daily
      : days <= 30
        ? compressToChartPoints(daily, 10)
        : compressToChartPoints(daily, 12);

  const top = daily.reduce((a, b) => (b.earningsInr > a.earningsInr ? b : a), daily[0]);
  const coins = periodTotal * 2;
  const avgMinutes = avgCallMinutes(receiver);

  return {
    range: rangeKey,
    rangeLabel: cfg.label,
    totalEarningsInr: periodTotal,
    coins,
    totalCalls: periodCalls,
    avgDurationLabel: formatDuration(avgMinutes),
    avgDurationMinutes: Math.round(avgMinutes * 10) / 10,
    topEarningDay: top.fullDayName,
    topEarningDayShort: top.weekday,
    peakEarningsInr: top.earningsInr,
    series: chartPoints.map(p => ({
      key: p.key,
      label: p.label,
      earningsInr: p.earningsInr,
      calls: p.calls,
      isPeak: p.key === top.key,
    })),
  };
}

async function getAnalytics(receiverId, range = '7d') {
  const key = String(range || '7d').toLowerCase();
  const rangeKey = RANGES[key] ? key : '7d';
  const receiver = await Receiver.findById(receiverId).lean();
  if (!receiver) {
    const err = new Error('Receiver not found');
    err.statusCode = 404;
    throw err;
  }
  return buildSeries(receiver, rangeKey);
}

module.exports = {
  getAnalytics,
  RANGES,
};
