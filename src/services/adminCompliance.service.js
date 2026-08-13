const crypto = require('crypto');
const UserReport = require('../models/UserReport');
const Caller = require('../models/Caller');
const Receiver = require('../models/Receiver');
const Agent = require('../models/Agent');
const Call = require('../models/Call');
const storageService = require('./storage.service');

function formatDateLabel(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTimeLabel(date) {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function uiStatus(status, adminAction) {
  if (adminAction === 'terminate' || status === 'resolved') {
    if (adminAction === 'terminate') return 'blocked';
    return 'closed';
  }
  if (status === 'ignored') return 'dismissed';
  if (status === 'assigned') return 'assigned';
  if (status === 'agent_accepted') return 'agent_accepted';
  if (status === 'agent_ignored') return 'agent_ignored';
  if (status === 'under_appeal') return 'under_appeal';
  return 'pending';
}

function uiStatusLabel(status) {
  const map = {
    pending: 'Pending Review',
    assigned: 'Assigned',
    agent_accepted: 'Agent Accepted',
    agent_ignored: 'Agent Ignored',
    dismissed: 'Dismissed',
    blocked: 'Blocked',
    closed: 'Closed',
    under_appeal: 'Under Appeal',
  };
  return map[status] || 'Pending Review';
}

function sourceLabel(source) {
  if (source === 'identity_mismatch') return 'Caller Report';
  if (source === 'in_call') return 'In-Call Report';
  if (source === 'chat') return 'Chat';
  return 'Report';
}

function detectionSourceLabel(source, reason) {
  if (source === 'identity_mismatch') return 'Caller Report';
  if (source === 'in_call') return 'In-Call Report';
  if (/whatsapp|phone|telegram|contact/i.test(reason || '')) {
    return 'AI Detection';
  }
  return 'User Report';
}

function makeCaseCode(source) {
  const year = new Date().getFullYear();
  const tail = crypto.randomBytes(2).toString('hex').toUpperCase();
  if (source === 'identity_mismatch') return `IM-${year}-${tail}`;
  return `CASE-${tail}`;
}

function pushTimeline(report, title, actor = 'System') {
  const events = Array.isArray(report.timeline) ? [...report.timeline] : [];
  events.push({
    id: `TL-${crypto.randomBytes(3).toString('hex')}`,
    title,
    actor,
    at: new Date(),
  });
  report.timeline = events;
}

async function displayName(role, id) {
  if (!id) return '—';
  if (role === 'caller') {
    const row = await Caller.findOne({id}).select('name phone').lean();
    return {name: row?.name || id, phone: row?.phone || ''};
  }
  const row = await Receiver.findOne({id})
    .select('name status createdAt photos kyc agentId')
    .lean();
  return {
    name: row?.name || id,
    phone: '',
    status: row?.status || '',
    createdAt: row?.createdAt || null,
    photos: row?.photos || [],
    kyc: row?.kyc || {},
    agentId: row?.agentId || '',
  };
}

async function mapComplianceCase(report, extras = {}) {
  const [reporter, reported, agent] = await Promise.all([
    displayName(report.reporterRole, report.reporterId),
    displayName(report.reportedRole, report.reportedId),
    report.assignedAgentId
      ? Agent.findOne({id: report.assignedAgentId})
          .select('id name agentCode')
          .lean()
      : null,
  ]);

  const status = uiStatus(report.status, report.adminAction);
  const priorCount = extras.priorCount ?? 0;
  let videoUrl = '';
  let videoThumb = '';
  if (report.reportedRole === 'receiver' && reported.kyc) {
    videoUrl = await storageService.toAccessUrl(reported.kyc.videoUrl || '');
    videoThumb = await storageService.toAccessUrl(
      reported.kyc.videoThumb || reported.photos?.[0] || '',
    );
  }

  const timeline = (Array.isArray(report.timeline) ? report.timeline : []).map(
    item => ({
      id: item.id,
      title: item.title,
      actor: item.actor || 'System',
      at: item.at ? new Date(item.at).toISOString() : null,
      atLabel: formatDateTimeLabel(item.at),
    }),
  );

  return {
    id: report.id,
    caseCode: report.caseCode || report.id,
    source: report.source || 'chat',
    sourceLabel: sourceLabel(report.source),
    detectionSource: detectionSourceLabel(report.source, report.reason),
    detectionType:
      report.detectionType ||
      report.reason ||
      (report.source === 'identity_mismatch'
        ? 'Identity Mismatch'
        : 'User Report'),
    callId: report.callId || null,
    conversationId: report.conversationId || null,
    reportDate: report.createdAt
      ? new Date(report.createdAt).toISOString()
      : new Date().toISOString(),
    reportDateLabel: formatDateLabel(report.createdAt),
    callerName:
      report.reporterRole === 'caller'
        ? reporter.name
        : report.reportedRole === 'caller'
          ? reported.name
          : reporter.name,
    callerPhone:
      report.reporterRole === 'caller'
        ? reporter.phone
        : report.reportedRole === 'caller'
          ? reported.phone || ''
          : '',
    callerId:
      report.reporterRole === 'caller'
        ? report.reporterId
        : report.reportedRole === 'caller'
          ? report.reportedId
          : report.reporterId,
    receiverName:
      report.reportedRole === 'receiver'
        ? reported.name
        : report.reporterRole === 'receiver'
          ? reporter.name
          : reported.name,
    receiverId:
      report.reportedRole === 'receiver'
        ? report.reportedId
        : report.reporterRole === 'receiver'
          ? report.reporterId
          : report.reportedId,
    receiverPriorViolations: priorCount,
    receiverStatus: reported.status || '',
    receiverMemberSince: reported.createdAt
      ? formatDateLabel(reported.createdAt)
      : '',
    assignedAgentId: report.assignedAgentId || '',
    assignedAgentName: agent?.name || '',
    assignedAgentCode: agent?.agentCode || '',
    status,
    statusLabel: uiStatusLabel(status),
    reason: report.reason,
    details: report.details || '',
    riskScore: report.riskScore,
    videoEvidence: Boolean(videoUrl),
    videoUrl,
    videoThumb,
    duplicateLabel: priorCount > 0 ? `${priorCount} prior` : 'Unique case',
    autoBlockAt: report.autoBlockAt
      ? new Date(report.autoBlockAt).toISOString()
      : null,
    autoBlockLabel: report.autoBlockAt
      ? `Auto-Block in ${Math.max(
          0,
          Math.round(
            (new Date(report.autoBlockAt).getTime() - Date.now()) / 3600000,
          ),
        )} Hours`
      : '',
    timeline,
    adminAction: report.adminAction || 'none',
    assignmentNote: report.assignmentNote || '',
  };
}

async function priorViolationCount(reportedId, excludeId) {
  if (!reportedId) return 0;
  return UserReport.countDocuments({
    reportedId,
    id: {$ne: excludeId},
    status: {$in: ['resolved', 'ignored', 'agent_ignored']},
  });
}

async function createIdentityMismatchReport(call, feedback) {
  if (!call?.receiverId || !call?.callerId) return null;
  const existing = await UserReport.findOne({
    callId: call.id,
    source: 'identity_mismatch',
  }).lean();
  if (existing) return existing;

  const reasons = Array.isArray(feedback.reasons) ? feedback.reasons : [];
  const reason =
    reasons.length > 0 ? reasons.join(', ') : 'Identity mismatch';
  const riskScore = Math.min(98, 60 + reasons.length * 8);

  const report = await UserReport.create({
    id: `IM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    caseCode: makeCaseCode('identity_mismatch'),
    source: 'identity_mismatch',
    callId: call.id,
    reporterRole: 'caller',
    reporterId: call.callerId,
    reportedRole: 'receiver',
    reportedId: call.receiverId,
    conversationId: null,
    reason,
    details: String(feedback.otherText || '').trim(),
    detectionType: 'Identity Mismatch',
    status: 'open',
    riskScore,
    autoBlockAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    timeline: [
      {
        id: `TL-${crypto.randomBytes(3).toString('hex')}`,
        title: 'Case created from caller report',
        actor: 'System',
        at: new Date(),
      },
      {
        id: `TL-${crypto.randomBytes(3).toString('hex')}`,
        title: `AI analysis completed - Critical risk flagged (${riskScore}/100)`,
        actor: 'AI System',
        at: new Date(),
      },
    ],
  });

  return report.toObject();
}

async function getComplianceStats(source) {
  let base = {};
  if (source === 'identity_mismatch') {
    base = {source: 'identity_mismatch'};
  } else if (source === 'detected' || source === 'general') {
    base = {source: {$in: ['chat', 'in_call']}};
  } else if (source) {
    base = {source};
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (source === 'identity_mismatch') {
    const [total, pending, assigned, highRisk, underAppeal, banned] =
      await Promise.all([
        UserReport.countDocuments(base),
        UserReport.countDocuments({...base, status: 'open'}),
        UserReport.countDocuments({
          ...base,
          status: {$in: ['assigned', 'agent_accepted']},
        }),
        UserReport.countDocuments({
          ...base,
          riskScore: {$gte: 80},
        }),
        UserReport.countDocuments({...base, status: 'under_appeal'}),
        UserReport.countDocuments({
          ...base,
          adminAction: 'terminate',
        }),
      ]);
    return {
      total,
      pending,
      assigned,
      highRisk,
      underAppeal,
      banned,
    };
  }

  const [total, pending, blockedToday] = await Promise.all([
    UserReport.countDocuments(base),
    UserReport.countDocuments({
      ...base,
      status: {$in: ['open', 'assigned']},
    }),
    UserReport.countDocuments({
      ...base,
      adminAction: 'terminate',
      resolvedAt: {$gte: dayAgo},
    }),
  ]);

  return {total, pending, blockedToday};
}

async function listComplianceCases({
  source,
  q,
  status,
  page = 1,
  limit = 10,
  dateFrom,
  dateTo,
  detectionSource,
} = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));
  const filter = {};

  if (source === 'identity_mismatch') {
    filter.source = 'identity_mismatch';
  } else if (source === 'detected' || source === 'general') {
    filter.source = {$in: ['chat', 'in_call']};
  } else if (source) {
    filter.source = source;
  }

  if (status && status !== 'all') {
    const key = String(status).toLowerCase();
    if (key === 'pending' || key === 'pending_review') filter.status = 'open';
    else if (key === 'assigned') {
      filter.status = {$in: ['assigned', 'agent_accepted']};
    } else if (key === 'dismissed') filter.status = 'ignored';
    else if (key === 'blocked') filter.adminAction = 'terminate';
    else if (key === 'closed') {
      filter.status = 'resolved';
      filter.adminAction = {$ne: 'terminate'};
    } else if (key === 'under_appeal') filter.status = 'under_appeal';
    else if (key === 'agent_ignored') filter.status = 'agent_ignored';
    else if (key === 'agent_accepted') filter.status = 'agent_accepted';
    else filter.status = key;
  }

  if (detectionSource && detectionSource !== 'all') {
    if (detectionSource === 'Video Call' || detectionSource === 'In-Call') {
      filter.source = 'in_call';
    } else if (detectionSource === 'Chat') {
      filter.source = 'chat';
    }
  }

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!Number.isNaN(from.getTime())) filter.createdAt.$gte = from;
    }
    if (dateTo) {
      const to = new Date(dateTo);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }
    if (!Object.keys(filter.createdAt).length) delete filter.createdAt;
  }

  const queryText = String(q || '').trim();
  let idFilterExtra = null;
  if (queryText) {
    const rx = new RegExp(queryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const [callers, receivers] = await Promise.all([
      Caller.find({$or: [{name: rx}, {id: rx}]}).select('id').lean(),
      Receiver.find({$or: [{name: rx}, {id: rx}]}).select('id').lean(),
    ]);
    const personIds = [
      ...callers.map(c => c.id),
      ...receivers.map(r => r.id),
    ];
    idFilterExtra = {
      $or: [
        {id: rx},
        {caseCode: rx},
        {reason: rx},
        {details: rx},
        {reporterId: {$in: personIds}},
        {reportedId: {$in: personIds}},
      ],
    };
    filter.$and = [...(filter.$and || []), idFilterExtra];
  }

  const [total, rows] = await Promise.all([
    UserReport.countDocuments(filter),
    UserReport.find(filter)
      .sort({createdAt: -1})
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
  ]);

  const cases = [];
  for (const row of rows) {
    const priorCount = await priorViolationCount(row.reportedId, row.id);
    cases.push(await mapComplianceCase(row, {priorCount}));
  }

  return {
    cases,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    },
  };
}

async function getComplianceCase(id) {
  const raw = String(id || '').replace(/^#/, '').trim();
  const report = await UserReport.findOne({
    $or: [{id: raw}, {caseCode: raw}],
  }).lean();
  if (!report) return {ok: false, message: 'Case not found.'};
  const priorCount = await priorViolationCount(report.reportedId, report.id);
  return {
    ok: true,
    case: await mapComplianceCase(report, {priorCount}),
  };
}

async function assignCase(id, agentId, note = '', adminId = '') {
  const report = await UserReport.findOne({
    $or: [{id: String(id).replace(/^#/, '')}, {caseCode: id}],
  });
  if (!report) return {ok: false, message: 'Case not found.'};

  const agent = await Agent.findOne({id: agentId, isActive: {$ne: false}});
  if (!agent) return {ok: false, message: 'Agent not found or inactive.'};

  report.assignedAgentId = agent.id;
  report.assignedAt = new Date();
  report.assignmentNote = String(note || '').trim();
  report.status = 'assigned';
  report.adminAction = 'assign';
  pushTimeline(
    report,
    `Assigned to agent ${agent.name}`,
    adminId ? 'Admin' : 'System',
  );
  await report.save();

  const priorCount = await priorViolationCount(report.reportedId, report.id);
  return {
    ok: true,
    case: await mapComplianceCase(report.toObject(), {priorCount}),
  };
}

async function dismissCase(id, adminId, reason = '') {
  const report = await UserReport.findOne({
    $or: [{id: String(id).replace(/^#/, '')}, {caseCode: id}],
  });
  if (!report) return {ok: false, message: 'Case not found.'};

  report.status = 'ignored';
  report.adminAction = 'ignore';
  report.resolvedAt = new Date();
  report.resolvedByAdminId = adminId || null;
  if (reason) report.details = `${report.details || ''}\n[Dismiss] ${reason}`.trim();
  pushTimeline(report, 'Case dismissed by admin', 'Admin');
  await report.save();

  const priorCount = await priorViolationCount(report.reportedId, report.id);
  return {
    ok: true,
    case: await mapComplianceCase(report.toObject(), {priorCount}),
  };
}

async function blockReportedUser(id, adminId, reason = '') {
  const chatModeration = require('./chatModeration.service');
  const result = await chatModeration.terminateReportedUser(
    id,
    adminId,
    reason || 'Blocked from Compliance module',
  );
  if (!result.ok) return result;

  const report = await UserReport.findOne({
    $or: [{id: String(id).replace(/^#/, '')}, {caseCode: id}],
  });
  if (report) {
    pushTimeline(report, 'Receiver/caller blocked by admin', 'Admin');
    await report.save();
  }

  return getComplianceCase(id);
}

module.exports = {
  createIdentityMismatchReport,
  getComplianceStats,
  listComplianceCases,
  getComplianceCase,
  assignCase,
  dismissCase,
  blockReportedUser,
  makeCaseCode,
  pushTimeline,
};
