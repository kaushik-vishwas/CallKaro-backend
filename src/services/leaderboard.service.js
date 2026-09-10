const Receiver = require('../models/Receiver');
const storageService = require('./storage.service');

/** Peak demand window in IST (UTC+5:30): 6 PM – 11 PM. */
const PEAK_START_HOUR_IST = 18;
const PEAK_END_HOUR_IST = 23;

function toIstParts(date) {
  const istMs = date.getTime() + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  return {
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

function isPeakHourIst(date) {
  const {hour} = toIstParts(date);
  return hour >= PEAK_START_HOUR_IST && hour < PEAK_END_HOUR_IST;
}

/**
 * Minutes of [start, end) that fall inside IST peak hours.
 */
function peakMinutesBetween(startDate, endDate) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  let total = 0;
  let cursor = start;
  while (cursor < end) {
    const ist = new Date(cursor + 5.5 * 60 * 60 * 1000);
    const minsIntoHour = ist.getUTCMinutes();
    const secsIntoHour = ist.getUTCSeconds();
    const msIntoHour =
      minsIntoHour * 60_000 + secsIntoHour * 1000 + ist.getUTCMilliseconds();
    const sliceEnd = Math.min(cursor + (3_600_000 - msIntoHour), end);
    const sliceMinutes = (sliceEnd - cursor) / 60_000;
    if (isPeakHourIst(new Date(cursor))) {
      total += sliceMinutes;
    }
    cursor = sliceEnd;
  }
  return Math.max(0, Math.floor(total));
}

function answerRate(receiver) {
  const answered = Math.max(0, Number(receiver.answeredCalls) || 0);
  const missed = Math.max(0, Number(receiver.missedCalls) || 0);
  const total = answered + missed;
  if (total <= 0) {
    return 0.5; // Neutral until we have ringing outcomes
  }
  return answered / total;
}

/**
 * Rank score — mirrors Figma "How to Improve Rank" rules:
 * 1. Stay online more often
 * 2. Answer incoming calls quickly (answer rate)
 * 3. Avoid missing calls
 * 4. Stay online during peak hours
 * 5. Complete more calls
 * 6. Increase total talk time
 */
function scoreOf(receiver) {
  const totalCalls = Math.max(0, Number(receiver.totalCalls) || 0);
  const totalHours = Math.max(0, Number(receiver.totalHours) || 0);
  const onlineMinutes = Math.max(0, Number(receiver.onlineMinutes) || 0);
  const peakOnlineMinutes = Math.max(
    0,
    Number(receiver.peakOnlineMinutes) || 0,
  );
  const missedCalls = Math.max(0, Number(receiver.missedCalls) || 0);
  const rate = answerRate(receiver);

  const score =
    totalCalls * 5 +
    totalHours * 12 +
    onlineMinutes * 0.08 +
    peakOnlineMinutes * 0.18 +
    rate * 100 -
    missedCalls * 4;

  return Math.max(0, score);
}

function firstName(name) {
  return String(name || 'Receiver').trim().split(/\s+/)[0] || 'Receiver';
}

async function publicEntry(receiver, rank) {
  const photos = await storageService.mapAccessUrls(
    Array.isArray(receiver.photos) ? receiver.photos : [],
  );
  return {
    id: receiver.id,
    name: firstName(receiver.name),
    fullName: receiver.name,
    avatarUrl: photos[0] || '',
    level: receiver.level,
    rank,
    points: Math.round(scoreOf(receiver)),
    totalCalls: Number(receiver.totalCalls) || 0,
    totalHours: Number(receiver.totalHours) || 0,
    answeredCalls: Number(receiver.answeredCalls) || 0,
    missedCalls: Number(receiver.missedCalls) || 0,
    onlineMinutes: Number(receiver.onlineMinutes) || 0,
    peakOnlineMinutes: Number(receiver.peakOnlineMinutes) || 0,
    answerRate: Math.round(answerRate(receiver) * 100),
  };
}

async function getLeaderboard(receiverId, {limit = 20} = {}) {
  const receivers = await Receiver.find({
    status: {$in: ['active', 'inactive']},
  }).lean();

  const ranked = receivers
    .map(r => ({receiver: r, score: scoreOf(r)}))
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(a.receiver.name).localeCompare(String(b.receiver.name)),
    );

  const meIndex = ranked.findIndex(row => row.receiver.id === receiverId);
  const myRank = meIndex >= 0 ? meIndex + 1 : null;
  const me = meIndex >= 0 ? ranked[meIndex].receiver : null;

  const topLimit = Math.min(Math.max(Number(limit) || 20, 5), 50);
  const entries = await Promise.all(
    ranked
      .slice(0, topLimit)
      .map((row, index) => publicEntry(row.receiver, index + 1)),
  );

  const previousRank =
    me?.previousRank != null ? Number(me.previousRank) : null;
  const movedUp =
    myRank != null && previousRank != null && previousRank > myRank;

  // Persist current rank so next visit can detect movement.
  if (myRank != null && receiverId) {
    Receiver.updateOne(
      {id: receiverId},
      {$set: {previousRank: myRank}},
    ).catch(() => undefined);
  }

  const meEntry =
    meIndex >= 0
      ? await publicEntry(ranked[meIndex].receiver, myRank)
      : null;

  return {
    movedUp,
    previousRank,
    currentRank: myRank,
    totalReceivers: ranked.length,
    podium: entries.slice(0, 3),
    entries,
    me: meEntry
      ? {
          ...meEntry,
          isYou: true,
        }
      : null,
  };
}

/** Exact Figma Rank Improvement Center tips (no duplicates). */
const RANK_TIPS = [
  {
    id: 'online',
    title: 'Stay Online More Often',
    description: 'Being online increases visibility and call opportunities.',
  },
  {
    id: 'answer',
    title: 'Answer Incoming Calls Quickly',
    description: 'Higher answer rates improve ranking.',
  },
  {
    id: 'missed',
    title: 'Avoid Missing Calls',
    description: 'Frequent missed calls lower your performance score.',
  },
  {
    id: 'peak',
    title: 'Stay Online During Peak Hours',
    description: 'Be available when caller demand is highest.',
  },
  {
    id: 'complete',
    title: 'Complete More Calls',
    description: 'Higher completed call count improves rank.',
  },
  {
    id: 'talktime',
    title: 'Increase Total Talk Time',
    description: 'Longer quality conversations contribute positively.',
  },
];

function vipProgress(receiver) {
  const level = Number(receiver.level) || 1;
  const hours = Math.max(0, Number(receiver.totalHours) || 0);
  const steps = [
    {id: 'l1', label: 'Level 1', hours: 25, done: level >= 1},
    {id: 'l2', label: 'Level 2', hours: 25, done: level >= 2},
    {id: 'l3', label: 'Level 3', hours: 25, done: level >= 3},
    {
      id: 'vip',
      label: 'VIP',
      hours: 30,
      done: Boolean(receiver.isVip) || hours >= 100 || level >= 3,
    },
  ];

  const completed = steps.filter(s => s.done).length;
  const total = steps.length;
  const pct = Math.round((completed / total) * 100);
  return {
    percent: pct,
    completed,
    total,
    left: Math.max(0, total - completed),
    steps,
    headline: pct >= 100 ? "You're a VIP Host" : `You're ${pct}% of the way.`,
    subtext:
      pct >= 100
        ? 'VIP host status is unlocked.'
        : `Complete ${Math.max(0, total - completed)} more requirement${
            total - completed === 1 ? '' : 's'
          } to unlock VIP host status.`,
  };
}

/**
 * Accumulate online / peak minutes when receiver goes offline.
 */
async function accumulateOnlineSession(receiverDoc, endedAt = new Date()) {
  if (!receiverDoc?.onlineStartedAt) {
    return receiverDoc;
  }
  const started = new Date(receiverDoc.onlineStartedAt);
  const ended = new Date(endedAt);
  const elapsed = Math.max(
    0,
    Math.floor((ended.getTime() - started.getTime()) / 60_000),
  );
  if (elapsed <= 0) {
    receiverDoc.onlineStartedAt = null;
    return receiverDoc;
  }
  receiverDoc.onlineMinutes =
    Math.max(0, Number(receiverDoc.onlineMinutes) || 0) + elapsed;
  receiverDoc.peakOnlineMinutes =
    Math.max(0, Number(receiverDoc.peakOnlineMinutes) || 0) +
    peakMinutesBetween(started, ended);
  try {
    const routing = require('./receiverRouting.service');
    routing.ensureDailyEngagement(receiverDoc, ended);
    receiverDoc.dailyEngagementMinutes =
      Math.max(0, Number(receiverDoc.dailyEngagementMinutes) || 0) + elapsed;
  } catch {
    /* optional */
  }
  receiverDoc.onlineStartedAt = null;
  return receiverDoc;
}

module.exports = {
  getLeaderboard,
  RANK_TIPS,
  vipProgress,
  scoreOf,
  answerRate,
  accumulateOnlineSession,
  peakMinutesBetween,
  isPeakHourIst,
};
