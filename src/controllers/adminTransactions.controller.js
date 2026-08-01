const {ok, fail} = require('../utils/response');
const adminTransactionsService = require('../services/adminTransactions.service');

async function listTransactions(req, res) {
  try {
    const {q, type, status, page, limit, dateFrom, dateTo} = req.query || {};
    const result = await adminTransactionsService.listTransactions({
      q,
      type,
      status,
      page,
      limit,
      dateFrom,
      dateTo,
    });
    return ok(res, result, 'Transactions fetched');
  } catch (error) {
    console.error('[admin.listTransactions]', error);
    return fail(res, 'Failed to fetch transactions.', 500);
  }
}

async function transactionStats(req, res) {
  try {
    const stats = await adminTransactionsService.getTransactionStats();
    return ok(res, {stats}, 'Transaction stats fetched');
  } catch (error) {
    console.error('[admin.transactionStats]', error);
    return fail(res, 'Failed to fetch transaction stats.', 500);
  }
}

async function getTransaction(req, res) {
  try {
    const result = await adminTransactionsService.getTransactionDetail(
      req.params.id,
    );
    if (!result.ok) return fail(res, result.message, 404);
    return ok(res, {transaction: result.transaction}, 'Transaction fetched');
  } catch (error) {
    console.error('[admin.getTransaction]', error);
    return fail(res, 'Failed to fetch transaction.', 500);
  }
}

module.exports = {
  listTransactions,
  transactionStats,
  getTransaction,
};
