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
const adminVipController = require('../../controllers/adminVip.controller');
const adminDashboardController = require('../../controllers/adminDashboard.controller');
const adminWithdrawalsController = require('../../controllers/adminWithdrawals.controller');
const adminComplianceController = require('../../controllers/adminCompliance.controller');
const adminAnalyticsController = require('../../controllers/adminAnalytics.controller');

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
router.patch('/me', adminAuthRequired, adminController.updateProfile);
router.post(
  '/change-password',
  adminAuthRequired,
  adminController.changePassword,
);
router.get('/settings/wallet', adminAuthRequired, adminController.getWallet);
router.get('/settings/help', adminAuthRequired, adminController.getHelp);
router.get('/settings/bank', adminAuthRequired, adminController.getBank);
router.post(
  '/settings/bank/send-otp',
  adminAuthRequired,
  adminController.sendBankOtp,
);
router.post(
  '/settings/bank/verify-otp',
  adminAuthRequired,
  adminController.verifyBankOtp,
);
router.post(
  '/settings/bank/confirm',
  adminAuthRequired,
  adminController.confirmBank,
);

router.get(
  '/dashboard',
  adminAuthRequired,
  adminDashboardController.getDashboard,
);

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
router.get(
  '/agents/:id/commission-ledger',
  adminAuthRequired,
  adminAgentsController.commissionLedger,
);

router.get('/callers/stats', adminAuthRequired, adminCallersController.callerStats);
router.get('/callers', adminAuthRequired, adminCallersController.listCallers);
router.get('/callers/:id', adminAuthRequired, adminCallersController.getCaller);
router.patch(
  '/callers/:id',
  adminAuthRequired,
  adminCallersController.updateCaller,
);
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
  '/receivers/:id/assign-agent',
  adminAuthRequired,
  adminReceiversController.assignAgent,
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

router.get(
  '/withdrawals/stats',
  adminAuthRequired,
  adminWithdrawalsController.withdrawalStats,
);
router.get(
  '/withdrawals',
  adminAuthRequired,
  adminWithdrawalsController.listWithdrawals,
);
router.get(
  '/withdrawals/:id',
  adminAuthRequired,
  adminWithdrawalsController.getWithdrawal,
);
router.patch(
  '/withdrawals/:id',
  adminAuthRequired,
  adminWithdrawalsController.updateWithdrawal,
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
  '/compliance/stats',
  adminAuthRequired,
  adminComplianceController.caseStats,
);
router.get(
  '/compliance/cases',
  adminAuthRequired,
  adminComplianceController.listCases,
);
router.get(
  '/compliance/cases/:id',
  adminAuthRequired,
  adminComplianceController.getCase,
);
router.post(
  '/compliance/cases/:id/assign',
  adminAuthRequired,
  adminComplianceController.assignCase,
);
router.post(
  '/compliance/cases/:id/dismiss',
  adminAuthRequired,
  adminComplianceController.dismissCase,
);
router.post(
  '/compliance/cases/:id/block',
  adminAuthRequired,
  adminComplianceController.blockCase,
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

router.get('/vip/plans', adminAuthRequired, adminVipController.listVipPlans);
router.get(
  '/vip/analytics',
  adminAuthRequired,
  adminVipController.vipAnalytics,
);
router.get('/vip/users', adminAuthRequired, adminVipController.listVipUsers);
router.get('/vip/users/:id', adminAuthRequired, adminVipController.getVipUser);

router.get(
  '/analytics/overview',
  adminAuthRequired,
  adminAnalyticsController.overview,
);
router.get(
  '/analytics/packages',
  adminAuthRequired,
  adminAnalyticsController.packages,
);
router.get(
  '/analytics/callers',
  adminAuthRequired,
  adminAnalyticsController.callers,
);
router.get(
  '/analytics/receivers',
  adminAuthRequired,
  adminAnalyticsController.receivers,
);
router.get(
  '/analytics/agents',
  adminAuthRequired,
  adminAnalyticsController.agents,
);
router.get(
  '/analytics/gross-profit',
  adminAuthRequired,
  adminAnalyticsController.grossProfit,
);
router.get(
  '/analytics/net-profit',
  adminAuthRequired,
  adminAnalyticsController.netProfit,
);

module.exports = router;
