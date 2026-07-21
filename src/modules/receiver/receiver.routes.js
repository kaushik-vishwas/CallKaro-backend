const express = require('express');
const receiverController = require('../../controllers/receiver.controller');

const router = express.Router();

router.get('/onboard/:token', receiverController.getOnboarding);
router.put('/onboard/:token', receiverController.saveOnboarding);
router.post('/onboard/:token/submit', receiverController.submitOnboarding);
router.post('/onboard/:token/retry', receiverController.retryOnboarding);

module.exports = router;
