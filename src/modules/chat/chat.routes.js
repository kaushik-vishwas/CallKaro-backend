const express = require('express');
const chatController = require('../../controllers/chat.controller');
const {chatAuthRequired} = require('../../middleware/chatAuth');

const router = express.Router();

router.use(chatAuthRequired);

router.get('/conversations', chatController.listConversations);
router.post('/conversations', chatController.openConversation);
router.get('/conversations/:id', chatController.getConversation);
router.get('/conversations/:id/messages', chatController.listMessages);
router.post('/conversations/:id/messages', chatController.sendMessage);
router.post('/conversations/:id/read', chatController.markRead);
router.get('/conversations/:id/block', chatController.getBlockState);
router.post('/conversations/:id/block', chatController.blockUser);
router.delete('/conversations/:id/block', chatController.unblockUser);
router.post('/conversations/:id/report', chatController.reportUser);
router.post('/conversations/:id/clear', chatController.clearChat);

module.exports = router;
