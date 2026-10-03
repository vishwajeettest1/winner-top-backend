const express = require('express');
const { requireAuth } = require('../middleware/auth');
const depositOptions = require('../controllers/depositOptionController');

const router = express.Router();

router.get('/active', requireAuth, depositOptions.getActiveDepositOption);

module.exports = router;