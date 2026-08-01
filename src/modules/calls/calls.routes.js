const express = require('express');
const callController = require('../../controllers/call.controller');
const {chatAuthRequired} = require('../../middleware/chatAuth');

const router = express.Router();

router.use(chatAuthRequired);

router.get('/history', callController.history);
router.get('/active', callController.active);
router.get('/gifts/catalog', callController.giftCatalog);
router.post('/start', callController.start);
router.get('/:id', callController.getOne);
router.post('/:id/accept', callController.accept);
router.post('/:id/reject', callController.reject);
router.post('/:id/end', callController.end);
router.post('/:id/heartbeat', callController.heartbeat);
router.post('/:id/gifts', callController.sendGift);

module.exports = router;
