const {SupportTicket, SUPPORT_CATEGORIES} = require('../models/SupportTicket');
const Caller = require('../models/Caller');
const Receiver = require('../models/Receiver');
const storageService = require('./storage.service');

const STATUS_LABELS = {
  open: 'Open',
  in_review: 'In Review',
  solved: 'Solved',
  closed: 'Closed',
};

const ADMIN_STATUSES = ['open', 'in_review', 'solved', 'closed'];

function formatDateLabel(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function attachmentPublicUrl(url) {
  if (!url) return '';
  try {
    if (typeof storageService.toPublicUrl === 'function') {
      return storageService.toPublicUrl(url) || url;
    }
  } catch {
    /* ignore */
  }
  return url;
}

function publicTicket(ticket) {
  return {
    id: ticket.id,
    category: ticket.category,
    subject: ticket.subject,
    description: ticket.description,
    mobile: ticket.mobile || '',
    email: ticket.email || '',
    attachments: Array.isArray(ticket.attachments) ? ticket.attachments : [],
    status: ticket.status,
    statusLabel: STATUS_LABELS[ticket.status] || ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    estimatedResponse: 'Within 24 Hours',
    adminNote: ticket.adminNote || '',
  };
}

function ownerFilter({callerId, receiverId}) {
  if (callerId) return {callerId};
  if (receiverId) return {receiverId};
  return null;
}

async function nextTicketId() {
  const year = new Date().getFullYear();
  const prefix = `TKT-${year}-`;
  const latest = await SupportTicket.findOne({id: new RegExp(`^${prefix}`)})
    .sort({id: -1})
    .lean();
  let seq = 1;
  if (latest?.id) {
    const part = Number(String(latest.id).split('-').pop());
    if (Number.isFinite(part)) seq = part + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

async function listTickets(owner, {limit = 20} = {}) {
  const filter = ownerFilter(owner);
  if (!filter) return [];
  const tickets = await SupportTicket.find(filter)
    .sort({createdAt: -1})
    .limit(Math.min(Number(limit) || 20, 50));
  return tickets.map(publicTicket);
}

async function getTicket(owner, ticketId) {
  const filter = ownerFilter(owner);
  if (!filter) {
    return {ok: false, message: 'Ticket not found.', status: 404};
  }
  const ticket = await SupportTicket.findOne({id: ticketId, ...filter});
  if (!ticket) {
    return {ok: false, message: 'Ticket not found.', status: 404};
  }
  return {ok: true, ticket: publicTicket(ticket)};
}

async function createTicket(owner, payload = {}) {
  const filter = ownerFilter(owner);
  if (!filter) {
    return {ok: false, message: 'Unauthorized.'};
  }

  const category = String(payload.category || '').trim();
  const subject = String(payload.subject || '').trim();
  const description = String(payload.description || '').trim();
  const mobile = String(payload.mobile || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();

  if (!SUPPORT_CATEGORIES.includes(category)) {
    return {ok: false, message: 'Please select a valid issue category.'};
  }
  if (subject.length < 3) {
    return {ok: false, message: 'Subject must be at least 3 characters.'};
  }
  if (description.length < 10) {
    return {ok: false, message: 'Description must be at least 10 characters.'};
  }
  if (description.length > 500) {
    return {ok: false, message: 'Description must be 500 characters or less.'};
  }

  const rawAttachments = Array.isArray(payload.attachments)
    ? payload.attachments
    : [];
  const attachments = rawAttachments
    .slice(0, 5)
    .map(item => ({
      type: item.type === 'document' ? 'document' : 'screenshot',
      url: storageService.toStorageUrl(item.url || ''),
      name: String(item.name || '').trim(),
    }))
    .filter(item => item.url);

  const id = await nextTicketId();
  const ticket = await SupportTicket.create({
    id,
    callerId: owner.callerId || null,
    receiverId: owner.receiverId || null,
    category,
    subject,
    description,
    mobile,
    email,
    attachments,
    // New tickets start as open so they appear under admin "Open" filter.
    status: 'open',
  });

  return {ok: true, ticket: publicTicket(ticket)};
}

async function resolveUserNames(tickets) {
  const callerIds = [
    ...new Set(tickets.map(t => t.callerId).filter(Boolean)),
  ];
  const receiverIds = [
    ...new Set(tickets.map(t => t.receiverId).filter(Boolean)),
  ];
  const [callers, receivers] = await Promise.all([
    callerIds.length
      ? Caller.find({id: {$in: callerIds}}).select('id name email phone').lean()
      : [],
    receiverIds.length
      ? Receiver.find({id: {$in: receiverIds}})
          .select('id name phone')
          .lean()
      : [],
  ]);
  const callerMap = Object.fromEntries(callers.map(c => [c.id, c]));
  const receiverMap = Object.fromEntries(receivers.map(r => [r.id, r]));
  return {callerMap, receiverMap};
}

function toAdminTicket(ticket, callerMap, receiverMap) {
  const isCaller = Boolean(ticket.callerId);
  const user = isCaller
    ? callerMap[ticket.callerId]
    : receiverMap[ticket.receiverId];
  const userId = isCaller ? ticket.callerId : ticket.receiverId;
  const userName = (user && user.name) || 'Unknown';
  const userEmail =
    (user && user.email) || ticket.email || '';
  const userPhone = (user && user.phone) || ticket.mobile || '';

  const attachments = (ticket.attachments || []).map((file, index) => {
    const url = attachmentPublicUrl(file.url);
    const isDoc = file.type === 'document';
    return {
      id: `${ticket.id}-att-${index}`,
      name: file.name || (isDoc ? 'Document' : 'Screenshot'),
      type: isDoc ? 'pdf' : 'image',
      sizeLabel: '',
      url,
    };
  });

  return {
    id: ticket.id,
    code: ticket.id,
    role: isCaller ? 'caller' : 'receiver',
    userId: userId || '',
    userName,
    userEmail,
    userPhone,
    category: ticket.category,
    subject: ticket.subject,
    description: ticket.description,
    mobile: ticket.mobile || '',
    email: ticket.email || '',
    status: ticket.status,
    statusLabel: STATUS_LABELS[ticket.status] || ticket.status,
    adminNote: ticket.adminNote || '',
    attachments,
    createdAt: ticket.createdAt
      ? new Date(ticket.createdAt).toISOString()
      : new Date().toISOString(),
    createdLabel: formatDateLabel(ticket.createdAt),
    updatedAt: ticket.updatedAt
      ? new Date(ticket.updatedAt).toISOString()
      : null,
    resolvedAt: ticket.resolvedAt
      ? new Date(ticket.resolvedAt).toISOString()
      : null,
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function adminListTickets({
  q,
  status,
  role,
  page = 1,
  limit = 10,
  dateFrom,
  dateTo,
} = {}) {
  const filter = {};
  const roleKey = String(role || 'all').toLowerCase();
  // Prefer $type string — $nin:[null,''] is unreliable for null/missing fields.
  if (roleKey === 'caller') {
    filter.callerId = {$type: 'string', $ne: ''};
  } else if (roleKey === 'receiver') {
    filter.receiverId = {$type: 'string', $ne: ''};
  }

  const statusKey = String(status || 'all').toLowerCase();
  if (statusKey === 'open') {
    // Treat "Open" as open + in_review (legacy tickets used in_review on create).
    filter.status = {$in: ['open', 'in_review']};
  } else if (ADMIN_STATUSES.includes(statusKey)) {
    filter.status = statusKey;
  }

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!Number.isNaN(from.getTime())) {
        from.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = from;
      }
    }
    if (dateTo) {
      const to = new Date(dateTo);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }
  }

  const search = String(q || '').trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    const [matchedCallers, matchedReceivers] = await Promise.all([
      Caller.find({
        $or: [{name: rx}, {email: rx}, {phone: rx}, {id: rx}],
      })
        .select('id')
        .limit(50)
        .lean(),
      Receiver.find({
        $or: [{name: rx}, {phone: rx}, {id: rx}],
      })
        .select('id')
        .limit(50)
        .lean(),
    ]);
    const callerIds = matchedCallers.map(c => c.id);
    const receiverIds = matchedReceivers.map(r => r.id);

    filter.$or = [
      {id: rx},
      {subject: rx},
      {category: rx},
      {description: rx},
      {email: rx},
      {mobile: rx},
      {callerId: rx},
      {receiverId: rx},
      ...(callerIds.length ? [{callerId: {$in: callerIds}}] : []),
      ...(receiverIds.length ? [{receiverId: {$in: receiverIds}}] : []),
    ];
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(50, Math.max(1, Number(limit) || 10));
  const skip = (pageNum - 1) * limitNum;

  const [total, rows] = await Promise.all([
    SupportTicket.countDocuments(filter),
    SupportTicket.find(filter)
      .sort({createdAt: -1})
      .skip(skip)
      .limit(limitNum)
      .lean(),
  ]);

  const {callerMap, receiverMap} = await resolveUserNames(rows);
  const tickets = rows.map(row => toAdminTicket(row, callerMap, receiverMap));

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

async function adminGetTicket(ticketId) {
  const ticket = await SupportTicket.findOne({id: ticketId}).lean();
  if (!ticket) {
    return {ok: false, message: 'Ticket not found.'};
  }
  const {callerMap, receiverMap} = await resolveUserNames([ticket]);
  return {
    ok: true,
    ticket: toAdminTicket(ticket, callerMap, receiverMap),
  };
}

async function adminGetStats() {
  const [total, open, inReview, solved, closed] = await Promise.all([
    SupportTicket.countDocuments({}),
    SupportTicket.countDocuments({status: 'open'}),
    SupportTicket.countDocuments({status: 'in_review'}),
    SupportTicket.countDocuments({status: 'solved'}),
    SupportTicket.countDocuments({status: 'closed'}),
  ]);
  return {
    total,
    open: open + inReview,
    inReview,
    solved,
    closed,
    resolved: solved + closed,
  };
}

async function adminUpdateStatus(ticketId, payload = {}, adminId) {
  const status = String(payload.status || '').trim();
  if (!ADMIN_STATUSES.includes(status)) {
    return {
      ok: false,
      message: 'Invalid status. Use open, in_review, solved, or closed.',
    };
  }

  const ticket = await SupportTicket.findOne({id: ticketId});
  if (!ticket) {
    return {ok: false, message: 'Ticket not found.'};
  }

  ticket.status = status;
  if (payload.adminNote !== undefined) {
    ticket.adminNote = String(payload.adminNote || '').trim().slice(0, 1000);
  }

  if (status === 'solved' || status === 'closed') {
    ticket.resolvedAt = new Date();
    ticket.resolvedByAdminId = adminId || null;
  } else {
    ticket.resolvedAt = null;
    ticket.resolvedByAdminId = null;
  }

  await ticket.save();
  const lean = ticket.toObject();
  const {callerMap, receiverMap} = await resolveUserNames([lean]);
  return {
    ok: true,
    ticket: toAdminTicket(lean, callerMap, receiverMap),
  };
}

module.exports = {
  SUPPORT_CATEGORIES,
  listTickets,
  getTicket,
  createTicket,
  publicTicket,
  adminListTickets,
  adminGetTicket,
  adminGetStats,
  adminUpdateStatus,
};
