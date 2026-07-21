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
router.post('/update-password', authRequired, callerController.updatePassword);

module.exports = router;
