const express = require('express');
const notificationController = require('../../controllers/notification.controller');
const {chatAuthRequired} = require('../../middleware/chatAuth');

const router = express.Router();

router.use(chatAuthRequired);

router.get('/', notificationController.list);
router.post('/read-all', notificationController.markAllRead);
router.post('/report', notificationController.report);
router.post('/:id/read', notificationController.markRead);

module.exports = router;
