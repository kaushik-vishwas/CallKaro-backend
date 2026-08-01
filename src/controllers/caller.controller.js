const {ok, fail} = require('../utils/response');
const {signToken} = require('../middleware/auth');
const callerService = require('../services/caller.service');

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

async function signup(req, res) {
  try {
    const {email, password, confirmPassword} = req.body || {};

    if (!isValidEmail(email)) {
      return fail(res, 'Please enter a valid email address.');
    }
    if (!password || String(password).length < 8) {
      return fail(res, 'Password must be at least 8 characters.');
    }
    if (password !== confirmPassword) {
      return fail(res, 'Passwords do not match.');
    }

    const user = await callerService.createPendingUser({email, password});
    const otpInfo = await callerService.saveOtp(email, 'signup');

    return ok(
      res,
      {
        email: user.email,
        name: user.name,
        otpExpiresInMinutes: otpInfo.otpExpiresInMinutes,
        emailSent: otpInfo.emailSent,
        // Only returned when email is not configured (local fallback)
        ...(otpInfo.otp ? {debugOtp: otpInfo.otp} : {}),
      },
      otpInfo.emailSent ? 'OTP sent successfully' : 'OTP generated (check server logs)',
      201,
    );
  } catch (error) {
    return fail(res, error.message || 'Signup failed.');
  }
}

async function verifyOtp(req, res) {
  try {
    const {email, otp, flow} = req.body || {};
    if (!isValidEmail(email) || !otp) {
      return fail(res, 'Email and OTP are required.');
    }

    const purpose =
      flow === 'forgot-password' ? 'forgot-password' : 'signup';

    const result = await callerService.verifyStoredOtp(email, otp, purpose);
    if (!result.ok) {
      return fail(res, result.message);
    }

    // Forgot-password: only confirm OTP, then client sets a new password
    if (purpose === 'forgot-password') {
      return ok(
        res,
        {email, verified: true},
        'OTP verified successfully',
      );
    }

    const user = await callerService.verifyUserSignup(email);
    if (!user) {
      return fail(res, 'User not found for this email.', 404);
    }

    const token = signToken(user);
    return ok(
      res,
      {
        token,
        accessToken: token,
        user: callerService.publicUser(user),
      },
      'OTP verified successfully',
    );
  } catch (error) {
    return fail(res, error.message || 'OTP verification failed.');
  }
}

async function forgotPassword(req, res) {
  try {
    const {email} = req.body || {};
    if (!isValidEmail(email)) {
      return fail(res, 'Please enter a valid email address.');
    }

    const user = await callerService.findUserByEmail(email);
    if (!user) {
      return ok(res, {email}, 'If an account exists, OTP has been sent.');
    }

    const otpInfo = await callerService.saveOtp(email, 'forgot-password');
    return ok(
      res,
      {
        email,
        otpExpiresInMinutes: otpInfo.otpExpiresInMinutes,
        emailSent: otpInfo.emailSent,
        ...(otpInfo.otp ? {debugOtp: otpInfo.otp} : {}),
      },
      otpInfo.emailSent ? 'OTP sent successfully' : 'OTP generated (check server logs)',
    );
  } catch (error) {
    return fail(res, error.message || 'Failed to send OTP.');
  }
}

async function createNewPassword(req, res) {
  try {
    const {email, newPassword, confirmNewPassword} = req.body || {};
    if (!isValidEmail(email)) {
      return fail(res, 'Please enter a valid email address.');
    }
    if (!newPassword || String(newPassword).length < 8) {
      return fail(res, 'Password must be at least 8 characters.');
    }
    if (newPassword !== confirmNewPassword) {
      return fail(res, 'Passwords do not match.');
    }

    const user = await callerService.setPassword(email, newPassword);
    if (!user) {
      return fail(res, 'User not found.', 404);
    }

    const token = signToken(user);
    return ok(
      res,
      {
        token,
        accessToken: token,
        user: callerService.publicUser(user),
      },
      'Password updated successfully',
    );
  } catch (error) {
    return fail(res, error.message || 'Password update failed.');
  }
}

async function login(req, res) {
  try {
    const {email, password} = req.body || {};
    if (!isValidEmail(email) || !password) {
      return fail(res, 'Email and password are required.');
    }

    const result = await callerService.validateLogin(email, password);
    if (!result.ok) {
      return fail(res, result.message, 401);
    }

    const token = signToken(result.user);
    return ok(
      res,
      {
        token,
        accessToken: token,
        user: callerService.publicUser(result.user),
      },
      'Login successful',
    );
  } catch (error) {
    return fail(res, error.message || 'Login failed.');
  }
}

async function getUser(req, res) {
  try {
    const user = await callerService.findUserById(req.auth.userId);
    if (!user) {
      return fail(res, 'User not found.', 404);
    }
    return ok(
      res,
      callerService.publicUser(user),
      'User fetched successfully',
    );
  } catch (error) {
    return fail(res, error.message || 'Failed to fetch user.');
  }
}

async function updatePassword(req, res) {
  try {
    const {currentPassword, newPassword, confirmNewPassword} = req.body || {};
    if (!currentPassword || !newPassword) {
      return fail(res, 'Current and new password are required.');
    }
    if (newPassword !== confirmNewPassword) {
      return fail(res, 'Passwords do not match.');
    }
    if (String(newPassword).length < 8) {
      return fail(res, 'Password must be at least 8 characters.');
    }

    const result = await callerService.updatePassword(
      req.auth.userId,
      currentPassword,
      newPassword,
    );
    if (!result.ok) {
      return fail(res, result.message);
    }

    return ok(res, {}, 'Password updated successfully');
  } catch (error) {
    return fail(res, error.message || 'Password update failed.');
  }
}

async function editProfile(req, res) {
  try {
    const {name, profile} = req.body || {};
    if (!name && typeof profile === 'undefined') {
      return fail(res, 'Provide name and/or profile.');
    }

    const user = await callerService.editProfile(req.auth.userId, {name, profile});
    if (!user) {
      return fail(res, 'User not found.', 404);
    }

    return ok(
      res,
      {user: callerService.publicUser(user)},
      'Profile updated successfully',
    );
  } catch (error) {
    return fail(res, error.message || 'Failed to update profile.');
  }
}

async function dailyRewardStatus(req, res) {
  try {
    const status = await callerService.getDailyRewardStatus(req.auth.userId);
    return ok(res, status, 'Daily reward status fetched');
  } catch (error) {
    return fail(res, error.message || 'Failed to fetch daily reward status.');
  }
}

async function claimDailyReward(req, res) {
  try {
    const result = await callerService.claimDailyReward(req.auth.userId);
    if (!result.ok) {
      return fail(res, result.message);
    }
    return ok(res, result.data, 'Daily check-in claimed successfully');
  } catch (error) {
    return fail(res, error.message || 'Failed to claim daily reward.');
  }
}

async function claimWelcomeTalk(req, res) {
  try {
    const result = await callerService.claimWelcomeTalk(req.auth.userId);
    if (!result.ok) {
      return fail(res, result.message);
    }
    return ok(res, result.data, 'Welcome free talk activated');
  } catch (error) {
    return fail(res, error.message || 'Failed to claim welcome talk.');
  }
}

async function consumeWelcomeTalk(req, res) {
  try {
    const minutesUsed = Number(req.body?.minutesUsed ?? 1);
    const result = await callerService.consumeWelcomeTalk(
      req.auth.userId,
      minutesUsed,
    );
    if (!result.ok) {
      return fail(res, result.message);
    }
    return ok(res, result.data, 'Welcome talk minutes updated');
  } catch (error) {
    return fail(res, error.message || 'Failed to consume welcome talk.');
  }
}

async function rewardsStatus(req, res) {
  try {
    const status = await callerService.getRewardsStatus(req.auth.userId);
    if (!status) {
      return fail(res, 'Caller not found.', 404);
    }
    return ok(res, status, 'Rewards status fetched');
  } catch (error) {
    return fail(res, error.message || 'Failed to fetch rewards status.');
  }
}

async function milestonesStatus(req, res) {
  try {
    const status = await callerService.getMilestonesStatus(req.auth.userId);
    if (!status) {
      return fail(res, 'Caller not found.', 404);
    }
    return ok(res, status, 'Milestones status fetched');
  } catch (error) {
    return fail(res, error.message || 'Failed to fetch milestones.');
  }
}

async function claimMilestone(req, res) {
  try {
    const minutes = Number(req.params.minutes || req.body?.minutes);
    const result = await callerService.claimTalkMilestone(
      req.auth.userId,
      minutes,
    );
    if (!result.ok) {
      return fail(res, result.message);
    }
    return ok(res, result.data, 'Milestone reward claimed');
  } catch (error) {
    return fail(res, error.message || 'Failed to claim milestone.');
  }
}

async function walletTransactions(req, res) {
  try {
    const callerWalletTransactions = require('../services/callerWalletTransactions.service');
    const limit = Number(req.query?.limit) || 50;
    const data = await callerWalletTransactions.listWalletTransactions(
      req.auth.userId,
      {limit},
    );
    return ok(res, data, 'Wallet transactions fetched');
  } catch (error) {
    return fail(res, error.message || 'Failed to fetch wallet transactions.', 500);
  }
}

async function listSupportCategories(req, res) {
  try {
    const {SUPPORT_CATEGORIES} = require('../services/supportTicket.service');
    return ok(res, {categories: SUPPORT_CATEGORIES}, 'Categories fetched');
  } catch (error) {
    console.error('[caller.listSupportCategories]', error);
    return fail(res, 'Failed to fetch categories.', 500);
  }
}

async function listSupportTickets(req, res) {
  try {
    const supportTicketService = require('../services/supportTicket.service');
    const tickets = await supportTicketService.listTickets(
      {callerId: req.auth.userId},
      {limit: req.query.limit},
    );
    return ok(res, {tickets}, 'Tickets fetched');
  } catch (error) {
    console.error('[caller.listSupportTickets]', error);
    return fail(res, 'Failed to fetch tickets.', 500);
  }
}

async function getSupportTicket(req, res) {
  try {
    const supportTicketService = require('../services/supportTicket.service');
    const result = await supportTicketService.getTicket(
      {callerId: req.auth.userId},
      req.params.ticketId,
    );
    if (!result.ok) {
      return fail(res, result.message, result.status || 400);
    }
    return ok(res, {ticket: result.ticket}, 'Ticket fetched');
  } catch (error) {
    console.error('[caller.getSupportTicket]', error);
    return fail(res, 'Failed to fetch ticket.', 500);
  }
}

async function createSupportTicket(req, res) {
  try {
    const supportTicketService = require('../services/supportTicket.service');
    const result = await supportTicketService.createTicket(
      {callerId: req.auth.userId},
      req.body || {},
    );
    if (!result.ok) {
      return fail(res, result.message, result.status || 400);
    }
    return ok(res, {ticket: result.ticket}, 'Ticket created successfully', 201);
  } catch (error) {
    console.error('[caller.createSupportTicket]', error);
    return fail(res, 'Failed to create ticket.', 500);
  }
}

async function createOrder(req, res) {
  try {
    const amount = Number(req.body?.amount);
    const result = await callerService.createRechargeOrder(
      req.auth.userId,
      amount,
    );
    if (!result.ok) {
      return fail(res, result.message);
    }
    return ok(res, result.data, 'Order created successfully', 201);
  } catch (error) {
    return fail(res, error.message || 'Failed to create order.');
  }
}

async function verifyPayment(req, res) {
  try {
    const result = await callerService.verifyRechargePayment(
      req.auth.userId,
      req.body || {},
    );
    if (!result.ok) {
      const notificationService = require('../services/notification.service');
      notificationService
        .createForCaller({
          callerId: req.auth.userId,
          type: 'recharge_failed',
          title: 'Recharge failed',
          body: result.message || 'Your coin recharge could not be completed.',
        })
        .catch(() => undefined);
      return fail(res, result.message);
    }
    return ok(res, result.data, 'Payment verified successfully');
  } catch (error) {
    const notificationService = require('../services/notification.service');
    notificationService
      .createForCaller({
        callerId: req.auth.userId,
        type: 'recharge_failed',
        title: 'Recharge failed',
        body: error.message || 'Your coin recharge could not be completed.',
      })
      .catch(() => undefined);
    return fail(res, error.message || 'Payment verification failed.');
  }
}

async function discoverReceivers(req, res) {
  try {
    const receivers = await callerService.listDiscoverReceivers(req.auth.userId);
    return ok(res, {receivers}, 'Discover profiles fetched successfully');
  } catch (error) {
    return fail(res, error.message || 'Failed to fetch discover profiles.');
  }
}

async function followReceiver(req, res) {
  try {
    const followService = require('../services/follow.service');
    const receiverId = String(req.params.receiverId || '').trim();
    if (!receiverId) {
      return fail(res, 'Receiver id is required.');
    }
    const data = await followService.followReceiver(
      req.auth.userId,
      receiverId,
    );
    return ok(res, data, 'Followed successfully');
  } catch (error) {
    console.error('[caller.followReceiver]', error);
    return fail(
      res,
      error.message || 'Failed to follow receiver.',
      error.statusCode || 500,
    );
  }
}

async function unfollowReceiver(req, res) {
  try {
    const followService = require('../services/follow.service');
    const receiverId = String(req.params.receiverId || '').trim();
    if (!receiverId) {
      return fail(res, 'Receiver id is required.');
    }
    const data = await followService.unfollowReceiver(
      req.auth.userId,
      receiverId,
    );
    return ok(res, data, 'Unfollowed successfully');
  } catch (error) {
    console.error('[caller.unfollowReceiver]', error);
    return fail(
      res,
      error.message || 'Failed to unfollow receiver.',
      error.statusCode || 500,
    );
  }
}

async function recordReceiverProfileView(req, res) {
  try {
    const followService = require('../services/follow.service');
    const receiverId = String(req.params.receiverId || '').trim();
    if (!receiverId) {
      return fail(res, 'Receiver id is required.');
    }
    const data = await followService.recordProfileView(
      req.auth.userId,
      receiverId,
    );
    return ok(res, data, 'Profile view recorded');
  } catch (error) {
    console.error('[caller.recordReceiverProfileView]', error);
    return fail(
      res,
      error.message || 'Failed to record profile view.',
      error.statusCode || 500,
    );
  }
}

async function createVipOrder(req, res) {
  try {
    const planId = String(req.body?.planId || '').toLowerCase();
    const result = await callerService.createVipOrder(req.auth.userId, planId);
    if (!result.ok) {
      return fail(res, result.message);
    }
    return ok(res, result.data, 'VIP order created successfully', 201);
  } catch (error) {
    return fail(res, error.message || 'Failed to create VIP order.');
  }
}

async function verifyVipPayment(req, res) {
  try {
    const result = await callerService.verifyVipPayment(
      req.auth.userId,
      req.body || {},
    );
    if (!result.ok) {
      const notificationService = require('../services/notification.service');
      notificationService
        .createForCaller({
          callerId: req.auth.userId,
          type: 'vip_failed',
          title: 'VIP purchase failed',
          body: result.message || 'We could not activate your VIP plan.',
        })
        .catch(() => undefined);
      return fail(res, result.message);
    }
    return ok(res, result.data, 'VIP payment verified successfully');
  } catch (error) {
    const notificationService = require('../services/notification.service');
    notificationService
      .createForCaller({
        callerId: req.auth.userId,
        type: 'vip_failed',
        title: 'VIP purchase failed',
        body: error.message || 'We could not activate your VIP plan.',
      })
      .catch(() => undefined);
    return fail(res, error.message || 'VIP payment verification failed.');
  }
}

async function vipStatus(req, res) {
  try {
    const result = await callerService.getVipStatus(req.auth.userId);
    if (!result.ok) {
      return fail(res, result.message, 404);
    }
    return ok(res, result.data, 'VIP status fetched');
  } catch (error) {
    return fail(res, error.message || 'Failed to fetch VIP status.');
  }
}

async function activateVip(req, res) {
  try {
    const planId = String(req.body?.planId || '').toLowerCase();
    const result = await callerService.activateVip(req.auth.userId, planId);
    if (!result.ok) {
      const notificationService = require('../services/notification.service');
      notificationService
        .createForCaller({
          callerId: req.auth.userId,
          type: 'vip_failed',
          title: 'VIP purchase failed',
          body: result.message || 'We could not activate your VIP plan.',
          data: {planId},
        })
        .catch(() => undefined);
      return fail(res, result.message);
    }
    return ok(res, result.data, 'VIP activated successfully');
  } catch (error) {
    const notificationService = require('../services/notification.service');
    notificationService
      .createForCaller({
        callerId: req.auth.userId,
        type: 'vip_failed',
        title: 'VIP purchase failed',
        body: error.message || 'We could not activate your VIP plan.',
      })
      .catch(() => undefined);
    return fail(res, error.message || 'Failed to activate VIP.');
  }
}

module.exports = {
  signup,
  verifyOtp,
  forgotPassword,
  createNewPassword,
  login,
  getUser,
  updatePassword,
  editProfile,
  dailyRewardStatus,
  claimDailyReward,
  claimWelcomeTalk,
  consumeWelcomeTalk,
  rewardsStatus,
  milestonesStatus,
  claimMilestone,
  walletTransactions,
  listSupportCategories,
  listSupportTickets,
  getSupportTicket,
  createSupportTicket,
  createOrder,
  verifyPayment,
  createVipOrder,
  verifyVipPayment,
  vipStatus,
  activateVip,
  discoverReceivers,
  followReceiver,
  unfollowReceiver,
  recordReceiverProfileView,
};
