const Receiver = require('../models/Receiver');
const storageService = require('./storage.service');

function scoreOf(receiver) {
  return (
    Math.max(0, Number(receiver.totalCalls) || 0) * 3 +
    Math.max(0, Number(receiver.totalHours) || 0) * 5 +
    Math.max(0, Number(receiver.earnings) || 0) * 0.01 +
    Math.max(0, Number(receiver.followers) || 0)
  );
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
  };
}

async function getLeaderboard(receiverId, {limit = 20} = {}) {
  const receivers = await Receiver.find({
    status: {$in: ['active', 'inactive']},
  }).lean();

  const ranked = receivers
    .map(r => ({receiver: r, score: scoreOf(r)}))
    .sort((a, b) => b.score - a.score || String(a.receiver.name).localeCompare(String(b.receiver.name)));

  const meIndex = ranked.findIndex(row => row.receiver.id === receiverId);
  const myRank = meIndex >= 0 ? meIndex + 1 : null;
  const me = meIndex >= 0 ? ranked[meIndex].receiver : null;

  const topLimit = Math.min(Math.max(Number(limit) || 20, 5), 50);
  const entries = await Promise.all(
    ranked.slice(0, topLimit).map((row, index) => publicEntry(row.receiver, index + 1)),
  );

  let previousRank = me?.previousRank ?? null;
  let movedUp = false;
  if (myRank != null) {
    if (previousRank == null) {
      previousRank = Math.min(myRank + 3, Math.max(ranked.length, myRank + 3));
    }
    movedUp = previousRank > myRank;
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
    {id: 'l1', label: 'Level 1', hours: 25, done: level >= 1 || hours >= 25},
    {id: 'l2', label: 'Level 2', hours: 25, done: level >= 2 || hours >= 50},
    {id: 'l3', label: 'Level 3', hours: 25, done: level >= 3 || hours >= 75},
    {id: 'vip', label: 'VIP', hours: 30, done: hours >= 100 || level >= 3},
  ];
  // Recalculate done more accurately
  steps[0].done = level >= 1;
  steps[1].done = level >= 2;
  steps[2].done = level >= 3;
  steps[3].done = Boolean(receiver.isVip) || hours >= 100;

  const completed = steps.filter(s => s.done).length;
  const total = steps.length;
  const pct = Math.round((completed / total) * 100);
  return {
    percent: pct,
    completed,
    total,
    left: Math.max(0, total - completed),
    steps,
    headline:
      pct >= 100
        ? "You're a VIP Host"
        : `You're ${pct}% of the way.`,
    subtext:
      pct >= 100
        ? 'VIP host status is unlocked.'
        : `Complete ${Math.max(0, total - completed)} more requirement${
            total - completed === 1 ? '' : 's'
          } to unlock VIP host status.`,
  };
}

module.exports = {
  getLeaderboard,
  RANK_TIPS,
  vipProgress,
  scoreOf,
};
