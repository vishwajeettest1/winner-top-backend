const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const payments = require('../controllers/paymentController');
const paymentProofs = require('../controllers/paymentProofController');
const { uploadSingle } = require('../utils/imageUploads');

const router = express.Router();
const paymentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post('/webhook', payments.webhook);
router.post('/create-order', requireAuth, paymentLimiter, payments.createOrder);
router.post('/submit-proof', requireAuth, paymentLimiter, uploadSingle('paymentScreenshot'), paymentProofs.submitProof);
router.post('/verify', requireAuth, paymentLimiter, payments.verifyPayment);
router.get('/:paymentId', requireAuth, payments.getPaymentStatus);

module.exports = router;