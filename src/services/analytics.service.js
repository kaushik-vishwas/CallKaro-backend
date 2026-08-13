const Call = require('../models/Call');
const EarningLedger = require('../models/EarningLedger');
const Receiver = require('../models/Receiver');

const RANGES = {
  '7d': {days: 7, label: 'LAST 7 DAYS'},
  '1m': {days: 30, label: 'LAST 1 MONTH'},
  '3m': {days: 90, label: 'LAST 3 MONTHS'},
};

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDuration(totalMinutes) {
  const totalSecs = Math.max(0, Math.round(Number(totalMinutes) * 60));
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${String(s).padStart(2, '0')} min`;
}

function bucketMeta(days) {
  const labels = [];
  const today = startOfDay(new Date());
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    labels.push({
      key: dayKey(d),
      label:
        days <= 7
          ? DAY_SHORT[d.getDay()]
          : days <= 30
            ? String(d.getDate())
            : DAY_SHORT[d.getDay()],
      date: d,
      fullDayName: d.toLocaleDateString('en-IN', {weekday: 'long'}),
      weekday: DAY_SHORT[d.getDay()],
    });
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
    const peakInSlice = slice.reduce((a, b) =>
      b.earningsInr > a.earningsInr ? b : a,
    );
    out.push({
      key: last.key,
      label: last.label,
      earningsInr: Math.round(earningsInr * 100) / 100,
      calls,
      weekday: last.weekday,
      fullDayName: peakInSlice.fullDayName,
      // Preserve peak day key for isPeak mapping against daily top
      peakKey: peakInSlice.key,
    });
  }
  return out;
}

async function getAnalytics(receiverId, range = '7d') {
  const key = String(range || '7d').toLowerCase();
  const rangeKey = RANGES[key] ? key : '7d';
  const cfg = RANGES[rangeKey];
  const rid = String(receiverId || '').trim();

  const receiver = await Receiver.findOne({id: rid}).lean();
  if (!receiver) {
    const err = new Error('Receiver not found');
    err.statusCode = 404;
    throw err;
  }

  const since = startOfDay(new Date());
  since.setDate(since.getDate() - (cfg.days - 1));

  const [ledgerRows, callRows] = await Promise.all([
    EarningLedger.find({
      receiverId: rid,
      source: {$ne: 'withdrawal'},
      createdAt: {$gte: since},
    })
      .select('amountInr coins createdAt source')
      .lean(),
    Call.find({
      receiverId: rid,
      status: 'ended',
      connectedAt: {$ne: null, $gte: since},
      durationSeconds: {$gt: 0},
    })
      .select('durationSeconds connectedAt endedAt receiverEarningsInr')
      .lean(),
  ]);

  const earnByDay = new Map();
  const coinsByDay = new Map();
  for (const row of ledgerRows) {
    const k = dayKey(row.createdAt);
    earnByDay.set(
      k,
      (earnByDay.get(k) || 0) + Math.max(0, Number(row.amountInr) || 0),
    );
    coinsByDay.set(
      k,
      (coinsByDay.get(k) || 0) + Math.max(0, Number(row.coins) || 0),
    );
  }

  const callsByDay = new Map();
  const durationByDay = new Map();
  for (const row of callRows) {
    const when = row.connectedAt || row.endedAt;
    if (!when) {
      continue;
    }
    const k = dayKey(when);
    callsByDay.set(k, (callsByDay.get(k) || 0) + 1);
    durationByDay.set(
      k,
      (durationByDay.get(k) || 0) + Math.max(0, Number(row.durationSeconds) || 0),
    );
  }

  const dayMeta = bucketMeta(cfg.days);
  const daily = dayMeta.map(meta => ({
    key: meta.key,
    label: meta.label,
    earningsInr: Math.round((earnByDay.get(meta.key) || 0) * 100) / 100,
    calls: callsByDay.get(meta.key) || 0,
    durationSeconds: durationByDay.get(meta.key) || 0,
    weekday: meta.weekday,
    fullDayName: meta.fullDayName,
  }));

  const totalEarningsInr =
    Math.round(
      daily.reduce((s, d) => s + d.earningsInr, 0) * 100,
    ) / 100;
  const totalCalls = daily.reduce((s, d) => s + d.calls, 0);
  const totalDurationSeconds = daily.reduce((s, d) => s + d.durationSeconds, 0);
  const totalCoins = daily.reduce(
    (s, d) => s + (coinsByDay.get(d.key) || 0),
    0,
  );

  const avgMinutes =
    totalCalls > 0 ? totalDurationSeconds / 60 / totalCalls : 0;

  const top = daily.reduce(
    (best, cur) => (cur.earningsInr > best.earningsInr ? cur : best),
    daily[0] || {
      key: '',
      earningsInr: 0,
      fullDayName: '—',
      weekday: '—',
    },
  );

  const chartPoints =
    cfg.days <= 7
      ? daily
      : cfg.days <= 30
        ? compressToChartPoints(daily, 10)
        : compressToChartPoints(daily, 12);

  const peakKey = top.earningsInr > 0 ? top.key : null;

  return {
    range: rangeKey,
    rangeLabel: cfg.label,
    totalEarningsInr,
    coins: totalCoins,
    totalCalls,
    avgDurationLabel: formatDuration(avgMinutes),
    avgDurationMinutes: Math.round(avgMinutes * 10) / 10,
    topEarningDay: top.earningsInr > 0 ? top.fullDayName : '—',
    topEarningDayShort: top.earningsInr > 0 ? top.weekday : '—',
    peakEarningsInr: top.earningsInr,
    series: chartPoints.map(p => {
      const isPeak =
        peakKey != null &&
        (p.key === peakKey || p.peakKey === peakKey);
      return {
        key: p.key,
        label: p.label,
        earningsInr: p.earningsInr,
        calls: p.calls,
        isPeak,
      };
    }),
  };
}

module.exports = {
  getAnalytics,
  RANGES,
};
