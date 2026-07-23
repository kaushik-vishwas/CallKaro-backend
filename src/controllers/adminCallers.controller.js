const {ok, fail} = require('../utils/response');
const adminCallersService = require('../services/adminCallers.service');

async function listCallers(req, res) {
  try {
    const {q, tab, page, limit, dateFrom, dateTo} = req.query || {};
    const result = await adminCallersService.listCallers({
      q,
      tab,
      page,
      limit,
      dateFrom,
      dateTo,
    });
    return ok(res, result, 'Callers fetched');
  } catch (error) {
    console.error('[admin.listCallers]', error);
    return fail(res, 'Failed to fetch callers.', 500);
  }
}

async function callerStats(req, res) {
  try {
    const stats = await adminCallersService.getCallerStats();
    return ok(res, {stats}, 'Caller stats fetched');
  } catch (error) {
    console.error('[admin.callerStats]', error);
    return fail(res, 'Failed to fetch caller stats.', 500);
  }
}

async function getCaller(req, res) {
  try {
    const result = await adminCallersService.getCallerDetail(req.params.id);
    if (!result.ok) return fail(res, result.message, 404);
    return ok(res, {caller: result.caller}, 'Caller fetched');
  } catch (error) {
    console.error('[admin.getCaller]', error);
    return fail(res, 'Failed to fetch caller.', 500);
  }
}

async function resetCallerPassword(req, res) {
  try {
    const {newPassword} = req.body || {};
    const result = await adminCallersService.resetCallerPassword(
      req.params.id,
      newPassword,
    );
    if (!result.ok) return fail(res, result.message, 404);
    return ok(
      res,
      {temporaryPassword: result.temporaryPassword},
      'Password reset',
    );
  } catch (error) {
    console.error('[admin.resetCallerPassword]', error);
    return fail(res, 'Failed to reset password.', 500);
  }
}

module.exports = {
  listCallers,
  callerStats,
  getCaller,
  resetCallerPassword,
};
