const express = require('express');
const callerController = require('../../controllers/caller.controller');
const {authRequired} = require('../../middleware/auth');

const router = express.Router();

router.get('/get-user', authRequired, callerController.getUser);
router.patch('/edit-profile', authRequired, callerController.editProfile);

module.exports = router;
