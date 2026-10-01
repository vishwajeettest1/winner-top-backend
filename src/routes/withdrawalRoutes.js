const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requestWithdrawal, getWithdrawalHistory } = require('../controllers/withdrawalController');

const router = express.Router();
router.post('/request', requireAuth, requestWithdrawal);
router.get('/history', requireAuth, getWithdrawalHistory);

module.exports = router;
