const express = require('express');
const callerController = require('../../controllers/caller.controller');
const {authRequired} = require('../../middleware/auth');

const router = express.Router();

router.get('/daily-reward-status', authRequired, callerController.dailyRewardStatus);
router.post('/claim-daily-reward', authRequired, callerController.claimDailyReward);
router.post('/claim-welcome-talk', authRequired, callerController.claimWelcomeTalk);
router.post('/consume-welcome-talk', authRequired, callerController.consumeWelcomeTalk);
router.get('/rewards-status', authRequired, callerController.rewardsStatus);
router.post('/recharge/create-order', authRequired, callerController.createOrder);
router.post('/recharge/verify-payment', authRequired, callerController.verifyPayment);
router.get('/vip-status', authRequired, callerController.vipStatus);
router.post('/vip/create-order', authRequired, callerController.createVipOrder);
router.post('/vip/verify-payment', authRequired, callerController.verifyVipPayment);
router.post('/vip/activate', authRequired, callerController.activateVip);

module.exports = router;
