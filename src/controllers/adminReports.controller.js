const {ok, fail} = require('../utils/response');
const chatModeration = require('../services/chatModeration.service');

async function listReports(req, res) {
  try {
    const {q, status, userType, page, limit, dateFrom, dateTo} = req.query || {};
    const result = await chatModeration.listReports({
      q,
      status,
      userType,
      page,
      limit,
      dateFrom,
      dateTo,
    });
    return ok(res, result, 'Reports fetched');
  } catch (error) {
    console.error('[admin.listReports]', error);
    return fail(res, 'Failed to fetch reports.', 500);
  }
}

async function reportStats(req, res) {
  try {
    const stats = await chatModeration.getReportStats();
    return ok(res, {stats}, 'Report stats fetched');
  } catch (error) {
    console.error('[admin.reportStats]', error);
    return fail(res, 'Failed to fetch report stats.', 500);
  }
}

async function getReport(req, res) {
  try {
    const result = await chatModeration.getReport(req.params.id);
    if (!result.ok) return fail(res, result.message, 404);
    return ok(res, {ticket: result.ticket}, 'Report fetched');
  } catch (error) {
    console.error('[admin.getReport]', error);
    return fail(res, 'Failed to fetch report.', 500);
  }
}

async function ignoreReport(req, res) {
  try {
    const result = await chatModeration.ignoreReport(
      req.params.id,
      req.auth?.adminId || req.auth?.userId,
    );
    if (!result.ok) return fail(res, result.message, 404);
    return ok(res, {ticket: result.ticket}, 'Report ignored');
  } catch (error) {
    console.error('[admin.ignoreReport]', error);
    return fail(res, 'Failed to ignore report.', 500);
  }
}

async function terminateReport(req, res) {
  try {
    const result = await chatModeration.terminateReportedUser(
      req.params.id,
      req.auth?.adminId || req.auth?.userId,
      req.body?.reason,
    );
    if (!result.ok) return fail(res, result.message, 400);
    return ok(res, {ticket: result.ticket}, 'Reported user terminated');
  } catch (error) {
    console.error('[admin.terminateReport]', error);
    return fail(res, 'Failed to terminate user.', 500);
  }
}

module.exports = {
  listReports,
  reportStats,
  getReport,
  ignoreReport,
  terminateReport,
};
