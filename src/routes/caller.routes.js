const express = require('express');
const callerController = require('../controllers/caller.controller');
const {authRequired} = require('../middleware/auth');

const router = express.Router();

// Auth (public)
router.post('/signup', callerController.signup);
router.post('/verify-otp', callerController.verifyOtp);
router.post('/resend-otp', callerController.resendOtp);
router.post('/forgot-password', callerController.forgotPassword);
router.post('/create-new-password', callerController.createNewPassword);
router.post('/login', callerController.login);
router.post('/quick-login', callerController.quickLogin);

// Auth / profile (token required)
router.get('/get-user', authRequired, callerController.getUser);
router.post('/update-password', authRequired, callerController.updatePassword);
router.patch('/edit-profile', authRequired, callerController.editProfile);

// Daily rewards / welcome talk (token required) — separate from wallet coins
router.get('/daily-reward-status', authRequired, callerController.dailyRewardStatus);
router.post('/claim-daily-reward', authRequired, callerController.claimDailyReward);
router.post('/claim-welcome-talk', authRequired, callerController.claimWelcomeTalk);
router.post('/consume-welcome-talk', authRequired, callerController.consumeWelcomeTalk);
router.get('/rewards-status', authRequired, callerController.rewardsStatus);
router.get('/milestones', authRequired, callerController.milestonesStatus);
router.post(
  '/milestones/:minutes/claim',
  authRequired,
  callerController.claimMilestone,
);

// Wallet activity (token required)
router.get(
  '/wallet-transactions',
  authRequired,
  callerController.walletTransactions,
);
router.get(
  '/support/categories',
  authRequired,
  callerController.listSupportCategories,
);
router.get(
  '/support/tickets',
  authRequired,
  callerController.listSupportTickets,
);
router.post(
  '/support/tickets',
  authRequired,
  callerController.createSupportTicket,
);
router.get(
  '/support/tickets/:ticketId',
  authRequired,
  callerController.getSupportTicket,
);

// Recharge / Razorpay (token required)
router.post('/recharge/create-order', authRequired, callerController.createOrder);
router.post('/recharge/verify-payment', authRequired, callerController.verifyPayment);

// VIP + Razorpay
router.get('/vip-status', authRequired, callerController.vipStatus);
router.post('/vip/create-order', authRequired, callerController.createVipOrder);
router.post('/vip/verify-payment', authRequired, callerController.verifyVipPayment);
router.post('/vip/activate', authRequired, callerController.activateVip);

router.get('/discover', authRequired, callerController.discoverReceivers);
router.post(
  '/receivers/:receiverId/follow',
  authRequired,
  callerController.followReceiver,
);
router.delete(
  '/receivers/:receiverId/follow',
  authRequired,
  callerController.unfollowReceiver,
);
router.post(
  '/receivers/:receiverId/view',
  authRequired,
  callerController.recordReceiverProfileView,
);

module.exports = router;
