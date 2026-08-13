const express = require('express');
const receiverController = require('../../controllers/receiver.controller');
const {receiverAuthRequired} = require('../../middleware/auth');

const router = express.Router();

router.post('/login', receiverController.login);
router.get('/me', receiverAuthRequired, receiverController.me);
router.get('/profile', receiverAuthRequired, receiverController.getProfile);
router.patch('/profile', receiverAuthRequired, receiverController.updateProfile);
router.patch('/online', receiverAuthRequired, receiverController.setOnline);
router.post('/logout', receiverAuthRequired, receiverController.logout);
router.get(
  '/notification-preferences',
  receiverAuthRequired,
  receiverController.getNotificationPreferences,
);
router.patch(
  '/notification-preferences',
  receiverAuthRequired,
  receiverController.updateNotificationPreferences,
);
router.post(
  '/request-deletion',
  receiverAuthRequired,
  receiverController.requestAccountDeletion,
);
router.post(
  '/update-password',
  receiverAuthRequired,
  receiverController.updatePassword,
);

router.get(
  '/support/categories',
  receiverAuthRequired,
  receiverController.listSupportCategories,
);
router.get(
  '/support/tickets',
  receiverAuthRequired,
  receiverController.listSupportTickets,
);
router.post(
  '/support/tickets',
  receiverAuthRequired,
  receiverController.createSupportTicket,
);
router.get(
  '/support/tickets/:ticketId',
  receiverAuthRequired,
  receiverController.getSupportTicket,
);

router.get(
  '/leaderboard',
  receiverAuthRequired,
  receiverController.getLeaderboard,
);
router.get(
  '/rank-tips',
  receiverAuthRequired,
  receiverController.getRankTips,
);
router.get(
  '/analytics',
  receiverAuthRequired,
  receiverController.getAnalytics,
);

router.get('/wallet', receiverAuthRequired, receiverController.getWallet);
router.get('/bank', receiverAuthRequired, receiverController.getBank);
router.patch('/bank', receiverAuthRequired, receiverController.updateBank);
router.post(
  '/withdrawals',
  receiverAuthRequired,
  receiverController.createWithdrawal,
);
router.get(
  '/withdrawals/:id',
  receiverAuthRequired,
  receiverController.getWithdrawal,
);
router.post(
  '/withdrawals/:id/verify-otp',
  receiverAuthRequired,
  receiverController.verifyWithdrawalOtp,
);
router.post(
  '/withdrawals/:id/resend-otp',
  receiverAuthRequired,
  receiverController.resendWithdrawalOtp,
);

router.get('/onboard/:token', receiverController.getOnboarding);
router.put('/onboard/:token', receiverController.saveOnboarding);
router.post('/onboard/:token/submit', receiverController.submitOnboarding);
router.post('/onboard/:token/retry', receiverController.retryOnboarding);

module.exports = router;
