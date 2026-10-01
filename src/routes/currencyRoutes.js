const express = require('express');
const { quoteUsdToInr } = require('../controllers/currencyController');

const router = express.Router();

router.get('/usd-to-inr', quoteUsdToInr);

module.exports = router;