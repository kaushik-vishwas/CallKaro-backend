const express = require('express');
const {agentAuthRequired} = require('../../middleware/auth');
const agentController = require('../../controllers/agent.controller');

const router = express.Router();

router.post('/login', agentController.login);

router.get('/me', agentAuthRequired, agentController.me);
router.patch('/profile', agentAuthRequired, agentController.updateProfile);
router.post('/update-password', agentAuthRequired, agentController.updatePassword);

router.get('/receivers/stats', agentAuthRequired, agentController.receiverStats);
router.get(
  '/receivers/credentials',
  agentAuthRequired,
  agentController.listCredentials,
);
router.get('/receivers', agentAuthRequired, agentController.listReceivers);
router.post('/receivers', agentAuthRequired, agentController.createReceiver);
router.get('/receivers/:id', agentAuthRequired, agentController.getReceiver);
router.post(
  '/receivers/:id/submit-for-review',
  agentAuthRequired,
  agentController.submitForReview,
);
router.get(
  '/receivers/:id/credentials',
  agentAuthRequired,
  agentController.getCredentials,
);

module.exports = router;
