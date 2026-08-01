const callService = require('../services/call.service');
const {ok, fail} = require('../utils/response');

async function start(req, res) {
  try {
    const call = await callService.startCall(req.auth, req.body?.receiverId);
    return ok(res, {call}, 'Call started', 201);
  } catch (error) {
    return fail(
      res,
      error.message || 'Failed to start call.',
      error.statusCode || 500,
      error.call
        ? [{call: error.call}]
        : error.code
          ? [{code: error.code}]
          : [],
    );
  }
}

async function accept(req, res) {
  try {
    const call = await callService.acceptCall(req.auth, req.params.id);
    return ok(res, {call}, 'Call accepted');
  } catch (error) {
    return fail(
      res,
      error.message || 'Failed to accept call.',
      error.statusCode || 500,
    );
  }
}

async function reject(req, res) {
  try {
    const call = await callService.rejectCall(req.auth, req.params.id);
    return ok(res, {call}, 'Call rejected');
  } catch (error) {
    return fail(
      res,
      error.message || 'Failed to reject call.',
      error.statusCode || 500,
    );
  }
}

async function end(req, res) {
  try {
    const call = await callService.endCall(
      req.auth,
      req.params.id,
      req.body?.reason,
    );
    return ok(res, {call}, 'Call ended');
  } catch (error) {
    return fail(
      res,
      error.message || 'Failed to end call.',
      error.statusCode || 500,
    );
  }
}

async function heartbeat(req, res) {
  try {
    const call = await callService.heartbeat(req.auth, req.params.id);
    return ok(res, {call}, 'Heartbeat recorded');
  } catch (error) {
    return fail(
      res,
      error.message || 'Heartbeat failed.',
      error.statusCode || 500,
    );
  }
}

async function getOne(req, res) {
  try {
    const call = await callService.getCall(req.auth, req.params.id);
    return ok(res, {call}, 'Call loaded');
  } catch (error) {
    return fail(
      res,
      error.message || 'Failed to load call.',
      error.statusCode || 500,
    );
  }
}

async function history(req, res) {
  try {
    const result = await callService.listHistory(req.auth, {
      limit: req.query.limit,
    });
    return ok(res, result, 'Call history loaded');
  } catch (error) {
    return fail(res, error.message || 'Failed to load history.', 500);
  }
}

async function active(req, res) {
  try {
    const call = await callService.getActive(req.auth);
    return ok(res, {call}, 'Active call loaded');
  } catch (error) {
    return fail(res, error.message || 'Failed to load active call.', 500);
  }
}

async function giftCatalog(req, res) {
  try {
    const catalog = callService.listGiftCatalog();
    return ok(res, catalog, 'Gift catalog loaded');
  } catch (error) {
    return fail(res, error.message || 'Failed to load gifts.', 500);
  }
}

async function sendGift(req, res) {
  try {
    const result = await callService.sendGift(
      req.auth,
      req.params.id,
      req.body?.giftId,
    );
    return ok(res, result, 'Gift sent', 201);
  } catch (error) {
    return fail(
      res,
      error.message || 'Failed to send gift.',
      error.statusCode || 500,
    );
  }
}

module.exports = {
  start,
  accept,
  reject,
  end,
  heartbeat,
  getOne,
  history,
  active,
  giftCatalog,
  sendGift,
};
