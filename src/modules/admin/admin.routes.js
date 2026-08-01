const express = require('express');
const {adminAuthRequired} = require('../../middleware/auth');
const {ok} = require('../../utils/response');
const adminController = require('../../controllers/admin.controller');
const adminAgentsController = require('../../controllers/adminAgents.controller');
const adminCallersController = require('../../controllers/adminCallers.controller');
const adminReceiversController = require('../../controllers/adminReceivers.controller');
const adminTransactionsController = require('../../controllers/adminTransactions.controller');
const adminReportsController = require('../../controllers/adminReports.controller');
const adminSupportTicketsController = require('../../controllers/adminSupportTickets.controller');

const router = express.Router();

router.get('/health', (_req, res) => {
  return ok(res, {module: 'admin', ready: true}, 'Admin module ready');
});

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

router.get(
  '/transactions/stats',
  adminAuthRequired,
  adminTransactionsController.transactionStats,
);
router.get(
  '/transactions',
  adminAuthRequired,
  adminTransactionsController.listTransactions,
);
router.get(
  '/transactions/:id',
  adminAuthRequired,
  adminTransactionsController.getTransaction,
);

router.get('/reports/stats', adminAuthRequired, adminReportsController.reportStats);
router.get('/reports', adminAuthRequired, adminReportsController.listReports);
router.get('/reports/:id', adminAuthRequired, adminReportsController.getReport);
router.post(
  '/reports/:id/ignore',
  adminAuthRequired,
  adminReportsController.ignoreReport,
);
router.post(
  '/reports/:id/terminate',
  adminAuthRequired,
  adminReportsController.terminateReport,
);

router.get(
  '/support-tickets/stats',
  adminAuthRequired,
  adminSupportTicketsController.supportTicketStats,
);
router.get(
  '/support-tickets',
  adminAuthRequired,
  adminSupportTicketsController.listSupportTickets,
);
router.get(
  '/support-tickets/:id',
  adminAuthRequired,
  adminSupportTicketsController.getSupportTicket,
);
router.patch(
  '/support-tickets/:id/status',
  adminAuthRequired,
  adminSupportTicketsController.updateSupportTicketStatus,
);

module.exports = router;
