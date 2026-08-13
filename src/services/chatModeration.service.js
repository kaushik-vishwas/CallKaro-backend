const ChatBlock = require('../models/ChatBlock');
const UserReport = require('../models/UserReport');
const Conversation = require('../models/Conversation');
const Caller = require('../models/Caller');
const Receiver = require('../models/Receiver');

const REPORT_REASONS = [
  'Spam',
  'Fake profile',
  'Inappropriate content',
  'Harassment',
  'Other',
];

function authIds(auth) {
  if (auth.role === 'caller') {
    return {role: 'caller', id: auth.userId};
  }
  return {role: 'receiver', id: auth.receiverId};
}

function peerFromConversation(conversation, viewerRole) {
  if (viewerRole === 'caller') {
    return {role: 'receiver', id: conversation.receiverId};
  }
  return {role: 'caller', id: conversation.callerId};
}

async function assertParticipant(conversation, auth) {
  if (auth.role === 'caller' && conversation.callerId === auth.userId) {
    return 'caller';
  }
  if (auth.role === 'receiver' && conversation.receiverId === auth.receiverId) {
    return 'receiver';
  }
  const err = new Error('Not allowed to access this chat.');
  err.statusCode = 403;
  throw err;
}

async function isBlockedEitherWay(aRole, aId, bRole, bId) {
  const hit = await ChatBlock.findOne({
    $or: [
      {
        blockerRole: aRole,
        blockerId: aId,
        blockedRole: bRole,
        blockedId: bId,
      },
      {
        blockerRole: bRole,
        blockerId: bId,
        blockedRole: aRole,
        blockedId: aId,
      },
    ],
  }).lean();
  return Boolean(hit);
}

async function assertNotBlocked(conversation, auth) {
  const viewer = authIds(auth);
  const peer = peerFromConversation(conversation, viewer.role);
  const blocked = await isBlockedEitherWay(
    viewer.role,
    viewer.id,
    peer.role,
    peer.id,
  );
  if (blocked) {
    const err = new Error('You cannot message this user.');
    err.statusCode = 403;
    throw err;
  }
}

async function getBlockState(auth, conversationId) {
  const conversation = await Conversation.findOne({id: conversationId});
  if (!conversation) {
    const err = new Error('Conversation not found.');
    err.statusCode = 404;
    throw err;
  }
  const viewerRole = await assertParticipant(conversation, auth);
  const viewer = authIds(auth);
  const peer = peerFromConversation(conversation, viewerRole);
  const iBlocked = await ChatBlock.findOne({
    blockerRole: viewer.role,
    blockerId: viewer.id,
    blockedRole: peer.role,
    blockedId: peer.id,
  }).lean();
  const blockedMe = await ChatBlock.findOne({
    blockerRole: peer.role,
    blockerId: peer.id,
    blockedRole: viewer.role,
    blockedId: viewer.id,
  }).lean();
  return {
    conversationId,
    blockedByMe: Boolean(iBlocked),
    blockedMe: Boolean(blockedMe),
    peerId: peer.id,
    peerRole: peer.role,
  };
}

async function blockUser(auth, conversationId) {
  const conversation = await Conversation.findOne({id: conversationId});
  if (!conversation) {
    const err = new Error('Conversation not found.');
    err.statusCode = 404;
    throw err;
  }
  const viewerRole = await assertParticipant(conversation, auth);
  const viewer = authIds(auth);
  const peer = peerFromConversation(conversation, viewerRole);

  await ChatBlock.findOneAndUpdate(
    {
      blockerRole: viewer.role,
      blockerId: viewer.id,
      blockedRole: peer.role,
      blockedId: peer.id,
    },
    {
      $set: {
        blockerRole: viewer.role,
        blockerId: viewer.id,
        blockedRole: peer.role,
        blockedId: peer.id,
        conversationId: conversation.id,
      },
    },
    {upsert: true, new: true},
  );

  return getBlockState(auth, conversationId);
}

async function unblockUser(auth, conversationId) {
  const conversation = await Conversation.findOne({id: conversationId});
  if (!conversation) {
    const err = new Error('Conversation not found.');
    err.statusCode = 404;
    throw err;
  }
  const viewerRole = await assertParticipant(conversation, auth);
  const viewer = authIds(auth);
  const peer = peerFromConversation(conversation, viewerRole);

  await ChatBlock.deleteOne({
    blockerRole: viewer.role,
    blockerId: viewer.id,
    blockedRole: peer.role,
    blockedId: peer.id,
  });

  return getBlockState(auth, conversationId);
}

async function reportUser(auth, {conversationId, reason, details}) {
  const cleanedReason = String(reason || '').trim();
  if (!REPORT_REASONS.includes(cleanedReason)) {
    const err = new Error(
      `Invalid reason. Use: ${REPORT_REASONS.join(', ')}`,
    );
    err.statusCode = 400;
    throw err;
  }

  const conversation = await Conversation.findOne({id: conversationId});
  if (!conversation) {
    const err = new Error('Conversation not found.');
    err.statusCode = 404;
    throw err;
  }
  const viewerRole = await assertParticipant(conversation, auth);
  const viewer = authIds(auth);
  const peer = peerFromConversation(conversation, viewerRole);

  const report = await UserReport.create({
    reporterRole: viewer.role,
    reporterId: viewer.id,
    reportedRole: peer.role,
    reportedId: peer.id,
    conversationId: conversation.id,
    reason: cleanedReason,
    details: String(details || '').trim().slice(0, 2000),
    source: 'chat',
    detectionType: cleanedReason,
    caseCode: `CASE-${require('crypto').randomBytes(2).toString('hex').toUpperCase()}`,
    timeline: [
      {
        id: `TL-${require('crypto').randomBytes(3).toString('hex')}`,
        title: 'Case created from chat report',
        actor: 'System',
        at: new Date(),
      },
    ],
  });

  return {
    id: report.id,
    reason: report.reason,
    status: report.status,
    createdAt: report.createdAt,
  };
}

async function clearChat(auth, conversationId) {
  const conversation = await Conversation.findOne({id: conversationId});
  if (!conversation) {
    const err = new Error('Conversation not found.');
    err.statusCode = 404;
    throw err;
  }
  const viewerRole = await assertParticipant(conversation, auth);
  const now = new Date();
  if (viewerRole === 'caller') {
    conversation.callerClearedAt = now;
    conversation.callerUnread = 0;
  } else {
    conversation.receiverClearedAt = now;
    conversation.receiverUnread = 0;
  }
  await conversation.save();
  return {
    conversationId,
    clearedAt: now.toISOString(),
  };
}

async function displayName(role, id) {
  if (role === 'caller') {
    const caller = await Caller.findOne({id}).select('name').lean();
    return caller?.name || id;
  }
  const receiver = await Receiver.findOne({id}).select('name').lean();
  return receiver?.name || id;
}

function formatCreatedLabel(date) {
  if (!date) return '';
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function mapReportToTicket(report) {
  const [reportBy, reportTo] = await Promise.all([
    displayName(report.reporterRole, report.reporterId),
    displayName(report.reportedRole, report.reportedId),
  ]);
  const status =
    report.status === 'open'
      ? 'open'
      : report.status === 'ignored'
        ? 'ignored'
        : 'resolved';
  return {
    id: report.id,
    code: `#${report.id}`,
    reportBy,
    reportById: report.reporterId,
    reportTo,
    reportToId: report.reportedId,
    issueType: report.reason,
    categories: [report.reason],
    status,
    userType: report.reporterRole,
    reportedRole: report.reportedRole,
    conversationId: report.conversationId,
    createdAt: report.createdAt
      ? new Date(report.createdAt).toISOString()
      : new Date().toISOString(),
    createdLabel: formatCreatedLabel(report.createdAt),
    description: report.details || report.reason,
    assignedToAdmin: true,
    attachments: [],
    adminAction: report.adminAction || 'none',
  };
}

async function getReportStats() {
  const [total, open, resolved, ignored] = await Promise.all([
    UserReport.countDocuments({}),
    UserReport.countDocuments({status: 'open'}),
    UserReport.countDocuments({status: 'resolved'}),
    UserReport.countDocuments({status: 'ignored'}),
  ]);
  return {
    total,
    open,
    resolved: resolved + ignored,
    ignored,
  };
}

async function listReports({
  q,
  status,
  userType,
  page = 1,
  limit = 20,
  dateFrom,
  dateTo,
} = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
  const filter = {};

  if (userType === 'caller' || userType === 'receiver') {
    filter.reporterRole = userType;
  }

  if (status === 'open') filter.status = 'open';
  else if (status === 'ignored') filter.status = 'ignored';
  else if (status === 'resolved') filter.status = {$in: ['resolved', 'ignored']};

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
  if (queryText) {
    filter.$or = [
      {id: {$regex: queryText, $options: 'i'}},
      {reason: {$regex: queryText, $options: 'i'}},
      {reporterId: {$regex: queryText, $options: 'i'}},
      {reportedId: {$regex: queryText, $options: 'i'}},
      {details: {$regex: queryText, $options: 'i'}},
    ];
  }

  const [total, rows] = await Promise.all([
    UserReport.countDocuments(filter),
    UserReport.find(filter)
      .sort({createdAt: -1})
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
  ]);

  const tickets = await Promise.all(rows.map(mapReportToTicket));
  return {
    tickets,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    },
  };
}

async function getReport(id) {
  const raw = String(id || '').replace(/^#/, '').trim();
  const report = await UserReport.findOne({id: raw}).lean();
  if (!report) {
    return {ok: false, message: 'Report not found.'};
  }
  return {ok: true, ticket: await mapReportToTicket(report)};
}

async function ignoreReport(id, adminId) {
  const raw = String(id || '').replace(/^#/, '').trim();
  const report = await UserReport.findOne({id: raw});
  if (!report) {
    return {ok: false, message: 'Report not found.'};
  }
  report.status = 'ignored';
  report.adminAction = 'ignore';
  report.resolvedAt = new Date();
  report.resolvedByAdminId = adminId || null;
  await report.save();
  return {ok: true, ticket: await mapReportToTicket(report.toObject())};
}

async function terminateReportedUser(id, adminId, reason) {
  const raw = String(id || '').replace(/^#/, '').trim();
  const report = await UserReport.findOne({id: raw});
  if (!report) {
    return {ok: false, message: 'Report not found.'};
  }

  if (report.reportedRole === 'receiver') {
    const adminReceiversService = require('./adminReceivers.service');
    const result = await adminReceiversService.terminateReceiver(
      report.reportedId,
      reason || `Terminated due to report ${report.id}`,
    );
    if (!result.ok) {
      return {ok: false, message: result.message || 'Failed to terminate receiver.'};
    }
  } else {
    const caller = await Caller.findOne({id: report.reportedId});
    if (!caller) {
      return {ok: false, message: 'Reported caller not found.'};
    }
    caller.isBlocked = true;
    await caller.save();
  }

  report.status = 'resolved';
  report.adminAction = 'terminate';
  report.resolvedAt = new Date();
  report.resolvedByAdminId = adminId || null;
  await report.save();

  return {ok: true, ticket: await mapReportToTicket(report.toObject())};
}

module.exports = {
  REPORT_REASONS,
  assertNotBlocked,
  getBlockState,
  blockUser,
  unblockUser,
  reportUser,
  clearChat,
  getReportStats,
  listReports,
  getReport,
  ignoreReport,
  terminateReportedUser,
};
