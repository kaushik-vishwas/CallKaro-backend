const express = require('express');
const callerController = require('../controllers/caller.controller');
const {authRequired} = require('../middleware/auth');

const router = express.Router();

// Auth (public)
router.post('/signup', callerController.signup);
router.post('/verify-otp', callerController.verifyOtp);
router.post('/forgot-password', callerController.forgotPassword);
router.post('/create-new-password', callerController.createNewPassword);
router.post('/login', callerController.login);

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

// Recharge / Razorpay test mode (token required)
router.post('/recharge/create-order', authRequired, callerController.createOrder);
router.post('/recharge/verify-payment', authRequired, callerController.verifyPayment);

// Discover feed — only admin-approved (active) receivers
router.get('/vip-status', authRequired, callerController.vipStatus);
router.post('/vip/activate', authRequired, callerController.activateVip);

router.get('/discover', authRequired, callerController.discoverReceivers);

module.exports = router;
