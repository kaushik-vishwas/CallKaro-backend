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

// Daily rewards (token required)
router.get('/daily-reward-status', authRequired, callerController.dailyRewardStatus);
router.post('/claim-daily-reward', authRequired, callerController.claimDailyReward);

// Recharge / Razorpay test mode (token required)
router.post('/recharge/create-order', authRequired, callerController.createOrder);
router.post('/recharge/verify-payment', authRequired, callerController.verifyPayment);

module.exports = router;
