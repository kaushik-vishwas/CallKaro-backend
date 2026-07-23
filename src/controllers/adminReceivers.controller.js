const {ok, fail} = require('../utils/response');
const adminReceiversService = require('../services/adminReceivers.service');

async function listReceivers(req, res) {
  try {
    const {q, tab, page, limit, dateFrom, dateTo} = req.query || {};
    const result = await adminReceiversService.listReceivers({
      q,
      tab,
      page,
      limit,
      dateFrom,
      dateTo,
    });
    return ok(res, result, 'Receivers fetched');
  } catch (error) {
    console.error('[admin.listReceivers]', error);
    return fail(res, 'Failed to fetch receivers.', 500);
  }
}

async function receiverStats(req, res) {
  try {
    const stats = await adminReceiversService.getReceiverStats();
    return ok(res, {stats}, 'Receiver stats fetched');
  } catch (error) {
    console.error('[admin.receiverStats]', error);
    return fail(res, 'Failed to fetch receiver stats.', 500);
  }
}

async function listPending(req, res) {
  try {
    const pending = await adminReceiversService.listPendingReceivers();
    return ok(res, {pending}, 'Pending receivers fetched');
  } catch (error) {
    console.error('[admin.listPendingReceivers]', error);
    return fail(res, 'Failed to fetch pending receivers.', 500);
  }
}

async function getReceiver(req, res) {
  try {
    const result = await adminReceiversService.getReceiverDetail(req.params.id);
    if (!result.ok) return fail(res, result.message, 404);
    return ok(res, {receiver: result.receiver}, 'Receiver fetched');
  } catch (error) {
    console.error('[admin.getReceiver]', error);
    return fail(res, 'Failed to fetch receiver.', 500);
  }
}

async function updateReceiver(req, res) {
  try {
    const {action} = req.body || {};
    const result = await adminReceiversService.updateReceiverStatus(
      req.params.id,
      action,
    );
    if (!result.ok) {
      return fail(
        res,
        result.message,
        result.message === 'Receiver not found.' ? 404 : 400,
      );
    }
    return ok(res, {receiver: result.receiver}, 'Receiver updated');
  } catch (error) {
    console.error('[admin.updateReceiver]', error);
    return fail(res, 'Failed to update receiver.', 500);
  }
}

async function approveReceiver(req, res) {
  try {
    const result = await adminReceiversService.approveReceiver(req.params.id);
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(res, {receiver: result.receiver}, 'Receiver approved');
  } catch (error) {
    console.error('[admin.approveReceiver]', error);
    return fail(res, 'Failed to approve receiver.', 500);
  }
}

async function rejectReceiver(req, res) {
  try {
    const {reason} = req.body || {};
    const result = await adminReceiversService.rejectReceiver(
      req.params.id,
      reason,
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(res, {receiver: result.receiver}, 'Receiver rejected');
  } catch (error) {
    console.error('[admin.rejectReceiver]', error);
    return fail(res, 'Failed to reject receiver.', 500);
  }
}

async function requestChanges(req, res) {
  try {
    const {note} = req.body || {};
    const result = await adminReceiversService.requestChanges(
      req.params.id,
      note,
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(res, {receiver: result.receiver}, 'Changes requested');
  } catch (error) {
    console.error('[admin.requestChanges]', error);
    return fail(res, 'Failed to request changes.', 500);
  }
}

async function terminateReceiver(req, res) {
  try {
    const {reason} = req.body || {};
    const result = await adminReceiversService.terminateReceiver(
      req.params.id,
      reason,
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(res, {receiver: result.receiver}, 'Receiver terminated');
  } catch (error) {
    console.error('[admin.terminateReceiver]', error);
    return fail(res, 'Failed to terminate receiver.', 500);
  }
}

module.exports = {
  listReceivers,
  receiverStats,
  listPending,
  getReceiver,
  updateReceiver,
  approveReceiver,
  rejectReceiver,
  requestChanges,
  terminateReceiver,
};
