const notificationService = require('../services/notification.service');
const {ok, fail} = require('../utils/response');

const CALLER_CLIENT_TYPES = new Set([
  'recharge_failed',
  'vip_failed',
  'out_of_coins',
]);

const RECEIVER_CLIENT_TYPES = new Set([
  'withdraw_submitted',
  'withdraw_under_review',
  'withdraw_success',
  'withdraw_failed',
  'earnings_credit',
  'payment_received',
]);

const CALLER_CLIENT_COPY = {
  recharge_failed: {
    title: 'Recharge failed',
    body: 'Your coin recharge could not be completed. Please try again.',
  },
  vip_failed: {
    title: 'VIP purchase failed',
    body: 'We could not activate your VIP plan. Please try again.',
  },
  out_of_coins: {
    title: 'Out of coins',
    body: 'Your free minutes or coin balance ran out. Recharge to keep talking.',
  },
};

const RECEIVER_CLIENT_COPY = {
  withdraw_submitted: {
    title: 'Withdrawal submitted',
    body: 'Your withdrawal request was submitted and is awaiting review.',
  },
  withdraw_under_review: {
    title: 'Withdrawal under review',
    body: 'Our team is reviewing your withdrawal. You’ll be notified when it’s done.',
  },
  withdraw_success: {
    title: 'Withdrawal successful',
    body: 'Your money has been transferred to your bank account.',
  },
  withdraw_failed: {
    title: 'Withdrawal failed',
    body: 'We could not complete your withdrawal. Please try again or contact support.',
  },
  earnings_credit: {
    title: 'Earnings updated',
    body: 'New earnings were added to your wallet.',
  },
  payment_received: {
    title: 'Payment received',
    body: 'A payment was credited to your account.',
  },
};

function enrichReceiverBody(type, copyBody, data = {}) {
  const amount = data?.amountInr != null ? Number(data.amountInr) : null;
  if (amount == null || Number.isNaN(amount)) {
    return copyBody;
  }
  const pretty = `₹${Math.round(amount).toLocaleString('en-IN')}`;
  if (type === 'withdraw_submitted') {
    return `Your withdrawal of ${pretty} was submitted and is awaiting review.`;
  }
  if (type === 'withdraw_under_review') {
    return `Your withdrawal of ${pretty} is under review.`;
  }
  if (type === 'withdraw_success') {
    return `${pretty} was transferred to your bank account successfully.`;
  }
  if (type === 'withdraw_failed') {
    return `Withdrawal of ${pretty} failed. Please try again or contact support.`;
  }
  if (type === 'earnings_credit' || type === 'payment_received') {
    return `${pretty} was added to your wallet.`;
  }
  return `${copyBody} Amount: ${pretty}.`;
}

function ownerFromAuth(auth) {
  if (auth?.role === 'receiver') {
    return {audience: 'receiver', ownerId: auth.receiverId};
  }
  return {audience: 'caller', ownerId: auth.userId};
}

async function list(req, res) {
  try {
    const {audience, ownerId} = ownerFromAuth(req.auth);
    const result =
      audience === 'receiver'
        ? await notificationService.listForReceiver(ownerId, {
            limit: req.query.limit,
          })
        : await notificationService.listForCaller(ownerId, {
            limit: req.query.limit,
          });
    return ok(res, result, 'Notifications loaded');
  } catch (error) {
    return fail(res, error.message || 'Failed to load notifications.', 500);
  }
}

async function markRead(req, res) {
  try {
    const {audience, ownerId} = ownerFromAuth(req.auth);
    const notification = await notificationService.markRead(
      ownerId,
      req.params.id,
      audience,
    );
    return ok(res, {notification}, 'Notification marked as read');
  } catch (error) {
    return fail(
      res,
      error.message || 'Failed to mark notification.',
      error.statusCode || 500,
    );
  }
}

async function markAllRead(req, res) {
  try {
    const {audience, ownerId} = ownerFromAuth(req.auth);
    const result = await notificationService.markAllRead(ownerId, audience);
    return ok(res, result, 'All notifications marked as read');
  } catch (error) {
    return fail(res, error.message || 'Failed to mark all as read.', 500);
  }
}

async function report(req, res) {
  try {
    const type = String(req.body?.type || '').trim();
    const {audience, ownerId} = ownerFromAuth(req.auth);

    if (audience === 'receiver') {
      if (!RECEIVER_CLIENT_TYPES.has(type)) {
        return fail(res, 'Unsupported notification type.');
      }
      const copy = RECEIVER_CLIENT_COPY[type];
      const title = String(req.body?.title || copy.title);
      const data = req.body?.data || {};
      const body = String(
        req.body?.body || enrichReceiverBody(type, copy.body, data),
      );
      const notification = await notificationService.createForReceiver({
        receiverId: ownerId,
        type,
        title,
        body,
        data,
        dedupeMinutes:
          type === 'withdraw_submitted' || type === 'withdraw_under_review'
            ? 2
            : 0,
      });
      return ok(res, {notification}, 'Notification recorded', 201);
    }

    if (!CALLER_CLIENT_TYPES.has(type)) {
      return fail(res, 'Unsupported notification type.');
    }
    const copy = CALLER_CLIENT_COPY[type];
    const title = String(req.body?.title || copy.title);
    const body = String(req.body?.body || copy.body);
    const notification = await notificationService.createForCaller({
      callerId: ownerId,
      type,
      title,
      body,
      data: req.body?.data || {},
      dedupeMinutes:
        type === 'out_of_coins'
          ? 10
          : type === 'vip_failed' || type === 'recharge_failed'
            ? 2
            : 0,
    });
    return ok(res, {notification}, 'Notification recorded', 201);
  } catch (error) {
    return fail(res, error.message || 'Failed to record notification.', 500);
  }
}

module.exports = {list, markRead, markAllRead, report};
