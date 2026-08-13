const {ok, fail} = require('../utils/response');
const adminWithdrawalsService = require('../services/adminWithdrawals.service');

async function withdrawalStats(req, res) {
  try {
    const stats = await adminWithdrawalsService.getWithdrawalStats();
    return ok(res, {stats}, 'Withdrawal stats fetched');
  } catch (error) {
    console.error('[admin.withdrawalStats]', error);
    return fail(res, 'Failed to fetch withdrawal stats.', 500);
  }
}

async function listWithdrawals(req, res) {
  try {
    const {q, sort, page, limit, dateFrom, dateTo, receiverId, agentId, status} =
      req.query || {};
    const result = await adminWithdrawalsService.listWithdrawals({
      q,
      sort,
      page,
      limit,
      dateFrom,
      dateTo,
      receiverId,
      agentId,
      status,
    });
    return ok(res, result, 'Withdrawals fetched');
  } catch (error) {
    console.error('[admin.listWithdrawals]', error);
    return fail(res, 'Failed to fetch withdrawals.', 500);
  }
}

async function getWithdrawal(req, res) {
  try {
    const result = await adminWithdrawalsService.getWithdrawalDetail(
      req.params.id,
    );
    if (!result.ok) return fail(res, result.message, 404);
    return ok(res, {withdrawal: result.withdrawal}, 'Withdrawal fetched');
  } catch (error) {
    console.error('[admin.getWithdrawal]', error);
    return fail(res, 'Failed to fetch withdrawal.', 500);
  }
}

async function updateWithdrawal(req, res) {
  try {
    const {action, reason, utr} = req.body || {};
    const result = await adminWithdrawalsService.updateWithdrawalStatus(
      req.params.id,
      action,
      {reason, utr},
    );
    if (!result.ok) {
      return fail(
        res,
        result.message,
        result.message === 'Withdrawal not found.' ? 404 : 400,
      );
    }
    return ok(res, {withdrawal: result.withdrawal}, 'Withdrawal updated');
  } catch (error) {
    console.error('[admin.updateWithdrawal]', error);
    return fail(res, 'Failed to update withdrawal.', 500);
  }
}

module.exports = {
  withdrawalStats,
  listWithdrawals,
  getWithdrawal,
  updateWithdrawal,
};
