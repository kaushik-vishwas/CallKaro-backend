const callService = require('../services/call.service');
const streamVideo = require('../services/streamVideo.service');
const {ok, fail} = require('../utils/response');

function withMediaCredentials(call, auth) {
  if (!call) {
    return call;
  }
  return streamVideo.attachClientCredentials(call, auth);
}

async function start(req, res) {
  try {
    const call = await callService.startCall(req.auth, req.body?.receiverId);
    return ok(
      res,
      {call: withMediaCredentials(call, req.auth)},
      'Call started',
      201,
    );
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

async function startRandom(req, res) {
  try {
    const call = await callService.startRandomCall(req.auth);
    return ok(
      res,
      {call: withMediaCredentials(call, req.auth)},
      'Random call started',
      201,
    );
  } catch (error) {
    return fail(
      res,
      error.message || 'Failed to start random call.',
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
    return ok(
      res,
      {call: withMediaCredentials(call, req.auth)},
      'Call accepted',
    );
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
    return ok(res, {call: withMediaCredentials(call, req.auth)}, 'Call rejected');
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
    return ok(res, {call: withMediaCredentials(call, req.auth)}, 'Call ended');
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
    return ok(
      res,
      {call: withMediaCredentials(call, req.auth)},
      'Heartbeat recorded',
    );
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
    return ok(
      res,
      {call: withMediaCredentials(call, req.auth)},
      'Call loaded',
    );
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
    return ok(
      res,
      {call: withMediaCredentials(call, req.auth)},
      'Active call loaded',
    );
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
    if (result?.call) {
      result.call = withMediaCredentials(result.call, req.auth);
    }
    return ok(res, result, 'Gift sent', 201);
  } catch (error) {
    return fail(
      res,
      error.message || 'Failed to send gift.',
      error.statusCode || 500,
    );
  }
}

async function identityFeedback(req, res) {
  try {
    const call = await callService.submitIdentityFeedback(
      req.auth,
      req.params.id,
      req.body || {},
    );
    return ok(res, {call}, 'Feedback saved');
  } catch (error) {
    return fail(
      res,
      error.message || 'Failed to save feedback.',
      error.statusCode || 500,
    );
  }
}

async function requestCallback(req, res) {
  try {
    const callQueueService = require('../services/callQueue.service');
    const result = await callQueueService.requestCallback(req.auth, {
      receiverId: req.body?.receiverId,
      reason: req.body?.reason,
    });
    if (!result.ok) {
      return fail(res, result.message, result.status || 400);
    }
    return ok(
      res,
      {
        entry: result.entry,
        alreadyQueued: result.alreadyQueued,
        reason: result.reason,
      },
      result.alreadyQueued ? 'Already in queue' : 'Callback requested',
      result.alreadyQueued ? 200 : 201,
    );
  } catch (error) {
    console.error('[calls.requestCallback]', error);
    return fail(res, error.message || 'Failed to request callback.', 500);
  }
}

async function cancelCallback(req, res) {
  try {
    const callQueueService = require('../services/callQueue.service');
    const result = await callQueueService.cancelCallback(
      req.auth,
      req.params.id,
    );
    if (!result.ok) {
      return fail(res, result.message, result.status || 400);
    }
    return ok(res, {}, 'Callback cancelled');
  } catch (error) {
    console.error('[calls.cancelCallback]', error);
    return fail(res, error.message || 'Failed to cancel callback.', 500);
  }
}

async function listQueue(req, res) {
  try {
    const callQueueService = require('../services/callQueue.service');
    const result = await callQueueService.listQueueForReceiver(req.auth, {
      limit: req.query?.limit,
    });
    if (!result.ok) {
      return fail(res, result.message, result.status || 400);
    }
    return ok(
      res,
      {
        items: result.items,
        totalWaiting: result.totalWaiting,
        vipWaiting: result.vipWaiting,
      },
      'Queue fetched',
    );
  } catch (error) {
    console.error('[calls.listQueue]', error);
    return fail(res, error.message || 'Failed to fetch queue.', 500);
  }
}

module.exports = {
  start,
  startRandom,
  accept,
  reject,
  end,
  heartbeat,
  getOne,
  history,
  active,
  giftCatalog,
  sendGift,
  identityFeedback,
  requestCallback,
  cancelCallback,
  listQueue,
};
