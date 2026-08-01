const {ok, fail} = require('../utils/response');
const supportTicketService = require('../services/supportTicket.service');

async function listSupportTickets(req, res) {
  try {
    const {q, status, role, userType, page, limit, dateFrom, dateTo} =
      req.query || {};
    const result = await supportTicketService.adminListTickets({
      q,
      status,
      role: role || userType,
      page,
      limit,
      dateFrom,
      dateTo,
    });
    return ok(res, result, 'Support tickets fetched');
  } catch (error) {
    console.error('[admin.listSupportTickets]', error);
    return fail(res, 'Failed to fetch support tickets.', 500);
  }
}

async function supportTicketStats(req, res) {
  try {
    const stats = await supportTicketService.adminGetStats();
    return ok(res, {stats}, 'Support ticket stats fetched');
  } catch (error) {
    console.error('[admin.supportTicketStats]', error);
    return fail(res, 'Failed to fetch support ticket stats.', 500);
  }
}

async function getSupportTicket(req, res) {
  try {
    const result = await supportTicketService.adminGetTicket(req.params.id);
    if (!result.ok) return fail(res, result.message, 404);
    return ok(res, {ticket: result.ticket}, 'Support ticket fetched');
  } catch (error) {
    console.error('[admin.getSupportTicket]', error);
    return fail(res, 'Failed to fetch support ticket.', 500);
  }
}

async function updateSupportTicketStatus(req, res) {
  try {
    const result = await supportTicketService.adminUpdateStatus(
      req.params.id,
      req.body || {},
      req.auth?.adminId || req.auth?.userId,
    );
    if (!result.ok) return fail(res, result.message, 400);
    return ok(res, {ticket: result.ticket}, 'Support ticket updated');
  } catch (error) {
    console.error('[admin.updateSupportTicketStatus]', error);
    return fail(res, 'Failed to update support ticket.', 500);
  }
}

module.exports = {
  listSupportTickets,
  supportTicketStats,
  getSupportTicket,
  updateSupportTicketStatus,
};
