const express = require('express');
const {adminAuthRequired} = require('../../middleware/auth');
const adminController = require('../../controllers/admin.controller');
const adminAgentsController = require('../../controllers/adminAgents.controller');
const adminCallersController = require('../../controllers/adminCallers.controller');
const adminReceiversController = require('../../controllers/adminReceivers.controller');

const router = express.Router();

router.post('/login', adminController.login);
router.post('/verify-2fa', adminController.verify2fa);
router.post('/resend-2fa', adminController.resend2fa);
router.post('/forgot-password', adminController.forgotPassword);
router.post('/reset-password', adminController.resetPassword);

router.get('/me', adminAuthRequired, adminController.me);

router.get('/agents/stats', adminAuthRequired, adminAgentsController.agentStats);
router.get('/agents', adminAuthRequired, adminAgentsController.listAgents);
router.post('/agents', adminAuthRequired, adminAgentsController.createAgent);
router.get('/agents/:id', adminAuthRequired, adminAgentsController.getAgent);
router.patch('/agents/:id', adminAuthRequired, adminAgentsController.updateAgent);
router.post(
  '/agents/:id/reset-password',
  adminAuthRequired,
  adminAgentsController.resetAgentPassword,
);

router.get('/callers/stats', adminAuthRequired, adminCallersController.callerStats);
router.get('/callers', adminAuthRequired, adminCallersController.listCallers);
router.get('/callers/:id', adminAuthRequired, adminCallersController.getCaller);
router.post(
  '/callers/:id/reset-password',
  adminAuthRequired,
  adminCallersController.resetCallerPassword,
);

router.get(
  '/receivers/stats',
  adminAuthRequired,
  adminReceiversController.receiverStats,
);
router.get(
  '/receivers/pending',
  adminAuthRequired,
  adminReceiversController.listPending,
);
router.get('/receivers', adminAuthRequired, adminReceiversController.listReceivers);
router.get('/receivers/:id', adminAuthRequired, adminReceiversController.getReceiver);
router.patch(
  '/receivers/:id',
  adminAuthRequired,
  adminReceiversController.updateReceiver,
);
router.post(
  '/receivers/:id/approve',
  adminAuthRequired,
  adminReceiversController.approveReceiver,
);
router.post(
  '/receivers/:id/reject',
  adminAuthRequired,
  adminReceiversController.rejectReceiver,
);
router.post(
  '/receivers/:id/request-changes',
  adminAuthRequired,
  adminReceiversController.requestChanges,
);
router.post(
  '/receivers/:id/terminate',
  adminAuthRequired,
  adminReceiversController.terminateReceiver,
);

module.exports = router;
