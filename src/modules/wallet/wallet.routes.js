const express = require('express');
const callerController = require('../../controllers/caller.controller');
const {authRequired} = require('../../middleware/auth');

const router = express.Router();

router.get('/daily-reward-status', authRequired, callerController.dailyRewardStatus);
router.post('/claim-daily-reward', authRequired, callerController.claimDailyReward);
router.post('/recharge/create-order', authRequired, callerController.createOrder);
router.post('/recharge/verify-payment', authRequired, callerController.verifyPayment);

module.exports = router;
