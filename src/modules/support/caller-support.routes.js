const express = require('express');
const callerController = require('../../controllers/caller.controller');
const {authRequired} = require('../../middleware/auth');

/**
 * Caller support tickets — mounted at /api/caller/support/*
 * Kept as its own router so these paths are always registered even if
 * wallet.routes is an older deploy without support handlers.
 */
const router = express.Router();

router.get(
  '/support/categories',
  authRequired,
  callerController.listSupportCategories,
);
router.get(
  '/support/tickets',
  authRequired,
  callerController.listSupportTickets,
);
router.post(
  '/support/tickets',
  authRequired,
  callerController.createSupportTicket,
);
router.get(
  '/support/tickets/:ticketId',
  authRequired,
  callerController.getSupportTicket,
);

module.exports = router;
