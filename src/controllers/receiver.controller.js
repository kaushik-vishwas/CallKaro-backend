const {ok, fail} = require('../utils/response');
const {signToken} = require('../middleware/auth');
const receiverService = require('../services/receiver.service');

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

async function getOnboarding(req, res) {
  try {
    const result = await receiverService.getOnboarding(req.params.token);
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await receiverService.publicOnboardingReceiver(result.receiver)},
      'Onboarding profile fetched',
    );
  } catch (error) {
    console.error('[receiver.getOnboarding]', error);
    return fail(res, 'Failed to load onboarding profile.', 500);
  }
}

async function saveOnboarding(req, res) {
  try {
    const result = await receiverService.saveOnboarding(
      req.params.token,
      req.body || {},
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await receiverService.publicOnboardingReceiver(result.receiver)},
      'Profile saved',
    );
  } catch (error) {
    console.error('[receiver.saveOnboarding]', error);
    return fail(res, 'Failed to save profile.', 500);
  }
}

async function submitOnboarding(req, res) {
  try {
    const result = await receiverService.submitOnboarding(
      req.params.token,
      req.body || {},
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await receiverService.publicOnboardingReceiver(result.receiver)},
      'Profile submitted for review',
    );
  } catch (error) {
    console.error('[receiver.submitOnboarding]', error);
    return fail(res, 'Failed to submit profile.', 500);
  }
}

async function retryOnboarding(req, res) {
  try {
    const result = await receiverService.retryOnboarding(req.params.token);
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await receiverService.publicOnboardingReceiver(result.receiver)},
      'You can update and resubmit your profile',
    );
  } catch (error) {
    console.error('[receiver.retryOnboarding]', error);
    return fail(res, 'Failed to reopen onboarding.', 500);
  }
}

async function login(req, res) {
  try {
    const {email, password} = req.body || {};
    if (!isValidEmail(email) || !password) {
      return fail(res, 'Email and password are required.');
    }
    const result = await receiverService.login(email, password);
    if (!result.ok) {
      return fail(res, result.message, 401);
    }
    const token = signToken(
      {id: result.receiver.id, email: result.receiver.loginEmail},
      {role: 'receiver'},
    );
    const user = await receiverService.publicReceiverAppProfile(result.receiver);
    return ok(
      res,
      {
        token,
        accessToken: token,
        user,
        mustChangePassword: user.mustChangePassword,
      },
      'Login successful',
    );
  } catch (error) {
    console.error('[receiver.login]', error);
    return fail(res, 'Login failed.', 500);
  }
}

async function me(req, res) {
  try {
    const receiver = await receiverService.findById(req.auth.receiverId);
    if (!receiver) {
      return fail(res, 'Receiver not found.', 404);
    }
    return ok(
      res,
      {user: await receiverService.publicReceiverAppProfile(receiver)},
      'Receiver fetched',
    );
  } catch (error) {
    console.error('[receiver.me]', error);
    return fail(res, 'Failed to fetch receiver.', 500);
  }
}

async function getProfile(req, res) {
  try {
    const receiver = await receiverService.findById(req.auth.receiverId);
    if (!receiver) {
      return fail(res, 'Receiver not found.', 404);
    }
    return ok(
      res,
      {user: await receiverService.publicReceiverAppProfile(receiver)},
      'Profile fetched',
    );
  } catch (error) {
    console.error('[receiver.getProfile]', error);
    return fail(res, 'Failed to fetch profile.', 500);
  }
}

async function updateProfile(req, res) {
  try {
    const result = await receiverService.updateProfile(
      req.auth.receiverId,
      req.body || {},
    );
    if (!result.ok) {
      return fail(res, result.message, result.status || 400);
    }
    return ok(
      res,
      {user: await receiverService.publicReceiverAppProfile(result.receiver)},
      'Profile updated successfully',
    );
  } catch (error) {
    console.error('[receiver.updateProfile]', error);
    return fail(res, 'Failed to update profile.', 500);
  }
}

async function setOnline(req, res) {
  try {
    const {isOnline} = req.body || {};
    if (typeof isOnline !== 'boolean') {
      return fail(res, 'isOnline (boolean) is required.');
    }
    const result = await receiverService.setOnlineStatus(
      req.auth.receiverId,
      isOnline,
    );
    if (!result.ok) {
      return fail(res, result.message, result.status || 400);
    }
    return ok(
      res,
      {user: await receiverService.publicReceiverAppProfile(result.receiver)},
      isOnline ? 'You are online' : 'You are offline',
    );
  } catch (error) {
    console.error('[receiver.setOnline]', error);
    return fail(res, 'Failed to update online status.', 500);
  }
}

async function updatePassword(req, res) {
  try {
    const {
      newPassword,
      confirmNewPassword,
      password,
      confirmPassword,
      currentPassword,
    } = req.body || {};
    const nextPassword = newPassword || password;
    const confirm = confirmNewPassword || confirmPassword;
    if (!nextPassword) {
      return fail(res, 'New password is required.');
    }
    if (confirm != null && nextPassword !== confirm) {
      return fail(res, 'Passwords do not match.');
    }
    const result = await receiverService.updatePassword(
      req.auth.receiverId,
      nextPassword,
      currentPassword,
    );
    if (!result.ok) {
      return fail(res, result.message, result.status || 400);
    }
    return ok(
      res,
      {user: await receiverService.publicReceiverAppProfile(result.receiver)},
      'Password updated successfully',
    );
  } catch (error) {
    console.error('[receiver.updatePassword]', error);
    return fail(res, 'Failed to update password.', 500);
  }
}

async function getNotificationPreferences(req, res) {
  try {
    const result = await receiverService.getNotificationPreferences(
      req.auth.receiverId,
    );
    if (!result.ok) {
      return fail(res, result.message, result.status || 400);
    }
    return ok(res, {preferences: result.preferences}, 'Preferences fetched');
  } catch (error) {
    console.error('[receiver.getNotificationPreferences]', error);
    return fail(res, 'Failed to fetch notification preferences.', 500);
  }
}

async function updateNotificationPreferences(req, res) {
  try {
    const result = await receiverService.updateNotificationPreferences(
      req.auth.receiverId,
      req.body || {},
    );
    if (!result.ok) {
      return fail(res, result.message, result.status || 400);
    }
    return ok(res, {preferences: result.preferences}, 'Preferences updated');
  } catch (error) {
    console.error('[receiver.updateNotificationPreferences]', error);
    return fail(res, 'Failed to update notification preferences.', 500);
  }
}

async function requestAccountDeletion(req, res) {
  try {
    const {reason} = req.body || {};
    const result = await receiverService.requestAccountDeletion(
      req.auth.receiverId,
      reason,
    );
    if (!result.ok) {
      return fail(res, result.message, result.status || 400);
    }
    return ok(
      res,
      {
        deletionRequestedAt: result.receiver.deletionRequestedAt,
        deletionReason: result.receiver.deletionReason,
      },
      'Account deletion requested. Our team will contact you.',
    );
  } catch (error) {
    console.error('[receiver.requestAccountDeletion]', error);
    return fail(res, 'Failed to request account deletion.', 500);
  }
}

async function listSupportTickets(req, res) {
  try {
    const supportTicketService = require('../services/supportTicket.service');
    const tickets = await supportTicketService.listTickets(req.auth.receiverId, {
      limit: req.query.limit,
    });
    return ok(res, {tickets}, 'Tickets fetched');
  } catch (error) {
    console.error('[receiver.listSupportTickets]', error);
    return fail(res, 'Failed to fetch tickets.', 500);
  }
}

async function getSupportTicket(req, res) {
  try {
    const supportTicketService = require('../services/supportTicket.service');
    const result = await supportTicketService.getTicket(
      req.auth.receiverId,
      req.params.ticketId,
    );
    if (!result.ok) {
      return fail(res, result.message, result.status || 400);
    }
    return ok(res, {ticket: result.ticket}, 'Ticket fetched');
  } catch (error) {
    console.error('[receiver.getSupportTicket]', error);
    return fail(res, 'Failed to fetch ticket.', 500);
  }
}

async function createSupportTicket(req, res) {
  try {
    const supportTicketService = require('../services/supportTicket.service');
    const result = await supportTicketService.createTicket(
      req.auth.receiverId,
      req.body || {},
    );
    if (!result.ok) {
      return fail(res, result.message, result.status || 400);
    }
    return ok(res, {ticket: result.ticket}, 'Ticket created successfully', 201);
  } catch (error) {
    console.error('[receiver.createSupportTicket]', error);
    return fail(res, 'Failed to create ticket.', 500);
  }
}

async function listSupportCategories(req, res) {
  try {
    const {SUPPORT_CATEGORIES} = require('../services/supportTicket.service');
    return ok(res, {categories: SUPPORT_CATEGORIES}, 'Categories fetched');
  } catch (error) {
    console.error('[receiver.listSupportCategories]', error);
    return fail(res, 'Failed to fetch categories.', 500);
  }
}

async function getLeaderboard(req, res) {
  try {
    const leaderboardService = require('../services/leaderboard.service');
    const board = await leaderboardService.getLeaderboard(req.auth.receiverId, {
      limit: req.query.limit,
    });
    return ok(res, board, 'Leaderboard fetched');
  } catch (error) {
    console.error('[receiver.getLeaderboard]', error);
    return fail(res, 'Failed to fetch leaderboard.', 500);
  }
}

async function getRankTips(req, res) {
  try {
    const {RANK_TIPS} = require('../services/leaderboard.service');
    const receiver = await receiverService.findById(req.auth.receiverId);
    if (!receiver) {
      return fail(res, 'Receiver not found.', 404);
    }
    const board = await require('../services/leaderboard.service').getLeaderboard(
      req.auth.receiverId,
      {limit: 5},
    );
    return ok(
      res,
      {
        tips: RANK_TIPS,
        currentRank: board.currentRank,
        level: receiver.level,
        vipProgress: require('../services/leaderboard.service').vipProgress(
          receiver,
        ),
      },
      'Rank tips fetched',
    );
  } catch (error) {
    console.error('[receiver.getRankTips]', error);
    return fail(res, 'Failed to fetch rank tips.', 500);
  }
}

async function getAnalytics(req, res) {
  try {
    const analyticsService = require('../services/analytics.service');
    const data = await analyticsService.getAnalytics(
      req.auth.receiverId,
      req.query.range,
    );
    return ok(res, data, 'Analytics fetched');
  } catch (error) {
    console.error('[receiver.getAnalytics]', error);
    const status = error.statusCode || 500;
    return fail(
      res,
      error.message || 'Failed to fetch analytics.',
      status,
    );
  }
}

module.exports = {
  getOnboarding,
  saveOnboarding,
  submitOnboarding,
  retryOnboarding,
  login,
  me,
  getProfile,
  updateProfile,
  setOnline,
  updatePassword,
  getNotificationPreferences,
  updateNotificationPreferences,
  requestAccountDeletion,
  listSupportTickets,
  getSupportTicket,
  createSupportTicket,
  listSupportCategories,
  getLeaderboard,
  getRankTips,
  getAnalytics,
};
