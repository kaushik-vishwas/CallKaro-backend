const express = require('express');
const {agentAuthRequired} = require('../../middleware/auth');
const agentController = require('../../controllers/agent.controller');

const router = express.Router();

router.post('/login', agentController.login);

router.get('/me', agentAuthRequired, agentController.me);
router.patch('/profile', agentAuthRequired, agentController.updateProfile);
router.post('/update-password', agentAuthRequired, agentController.updatePassword);

router.get('/receivers/stats', agentAuthRequired, agentController.receiverStats);
router.get('/receivers/pending', agentAuthRequired, agentController.listPending);
router.get(
  '/receivers/credentials',
  agentAuthRequired,
  agentController.listCredentials,
);
router.get('/receivers', agentAuthRequired, agentController.listReceivers);
router.post('/receivers', agentAuthRequired, agentController.createReceiver);
router.get('/receivers/:id', agentAuthRequired, agentController.getReceiver);
router.post(
  '/receivers/:id/approve',
  agentAuthRequired,
  agentController.approveReceiver,
);
router.post(
  '/receivers/:id/reject',
  agentAuthRequired,
  agentController.rejectReceiver,
);
router.post(
  '/receivers/:id/request-changes',
  agentAuthRequired,
  agentController.requestChanges,
);
router.post(
  '/receivers/:id/terminate',
  agentAuthRequired,
  agentController.terminateReceiver,
);
router.post(
  '/receivers/:id/activate',
  agentAuthRequired,
  agentController.activateReceiver,
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
