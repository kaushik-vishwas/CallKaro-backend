const {SupportTicket, SUPPORT_CATEGORIES} = require('../models/SupportTicket');
const storageService = require('./storage.service');

function publicTicket(ticket) {
  const statusMap = {
    open: 'Open',
    in_review: 'In Review',
    solved: 'Solved',
    closed: 'Closed',
  };
  return {
    id: ticket.id,
    category: ticket.category,
    subject: ticket.subject,
    description: ticket.description,
    mobile: ticket.mobile || '',
    email: ticket.email || '',
    attachments: Array.isArray(ticket.attachments) ? ticket.attachments : [],
    status: ticket.status,
    statusLabel: statusMap[ticket.status] || ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    estimatedResponse: 'Within 24 Hours',
  };
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

async function listTickets(receiverId, {limit = 20} = {}) {
  const tickets = await SupportTicket.find({receiverId})
    .sort({createdAt: -1})
    .limit(Math.min(Number(limit) || 20, 50));
  return tickets.map(publicTicket);
}

async function getTicket(receiverId, ticketId) {
  const ticket = await SupportTicket.findOne({id: ticketId, receiverId});
  if (!ticket) {
    return {ok: false, message: 'Ticket not found.', status: 404};
  }
  return {ok: true, ticket: publicTicket(ticket)};
}

async function createTicket(receiverId, payload = {}) {
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
    receiverId,
    category,
    subject,
    description,
    mobile,
    email,
    attachments,
    status: 'in_review',
  });

  return {ok: true, ticket: publicTicket(ticket)};
}

module.exports = {
  SUPPORT_CATEGORIES,
  listTickets,
  getTicket,
  createTicket,
  publicTicket,
};
