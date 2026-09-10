const express = require('express');
const {agentAuthRequired} = require('../../middleware/auth');
const agentController = require('../../controllers/agent.controller');

const router = express.Router();

router.post('/login', agentController.login);

router.get('/me', agentAuthRequired, agentController.me);
router.patch('/profile', agentAuthRequired, agentController.updateProfile);
router.post('/update-password', agentAuthRequired, agentController.updatePassword);
router.get('/analytics', agentAuthRequired, agentController.analytics);

router.get('/receivers/stats', agentAuthRequired, agentController.receiverStats);
router.get(
  '/receivers/credentials',
  agentAuthRequired,
  agentController.listCredentials,
);
router.get(
  '/receivers/pending',
  agentAuthRequired,
  agentController.listPendingApprovals,
);
router.get('/receivers', agentAuthRequired, agentController.listReceivers);
router.post('/receivers', agentAuthRequired, agentController.createReceiver);
router.get('/receivers/:id', agentAuthRequired, agentController.getReceiver);
router.patch(
  '/receivers/:id/proxy-profile',
  agentAuthRequired,
  agentController.updateProxyProfile,
);
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
