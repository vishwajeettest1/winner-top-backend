const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getReferralStats } = require('../controllers/referralController');

const router = express.Router();
router.get('/stats', requireAuth, getReferralStats);

module.exports = router;
