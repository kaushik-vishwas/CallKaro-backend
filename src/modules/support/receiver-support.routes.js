const express = require('express');
const receiverController = require('../../controllers/receiver.controller');
const {receiverAuthRequired} = require('../../middleware/auth');

/**
 * Receiver support tickets — also mounted at /api/receiver/support/*
 * (in addition to receiver.routes) for a clear, dedicated mount point.
 */
const router = express.Router();

router.get(
  '/support/categories',
  receiverAuthRequired,
  receiverController.listSupportCategories,
);
router.get(
  '/support/tickets',
  receiverAuthRequired,
  receiverController.listSupportTickets,
);
router.post(
  '/support/tickets',
  receiverAuthRequired,
  receiverController.createSupportTicket,
);
router.get(
  '/support/tickets/:ticketId',
  receiverAuthRequired,
  receiverController.getSupportTicket,
);

module.exports = router;
