const express = require('express');
const callerController = require('../../controllers/caller.controller');
const {authRequired} = require('../../middleware/auth');

const router = express.Router();

router.post('/signup', callerController.signup);
router.post('/verify-otp', callerController.verifyOtp);
router.post('/forgot-password', callerController.forgotPassword);
router.post('/create-new-password', callerController.createNewPassword);
router.post('/login', callerController.login);
router.get('/get-user', authRequired, callerController.getUser);
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
router.post('/update-password', authRequired, callerController.updatePassword);

module.exports = router;
