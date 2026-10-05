const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { getProfile, changePassword, getPayoutDetails, updatePayoutDetails, submitContactRequest, getUserContactRequests } = require('../controllers/userController');

const router = express.Router();
const passwordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const payoutLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/profile', requireAuth, getProfile);
router.get('/payout-details', requireAuth, asyncRoute(getPayoutDetails));
router.put('/payout-details', requireAuth, payoutLimiter, asyncRoute(updatePayoutDetails));
router.post('/change-password', requireAuth, passwordLimiter, changePassword);
router.post('/contact-request', requireAuth, contactLimiter, asyncRoute(submitContactRequest));
router.get('/contact-requests', requireAuth, asyncRoute(getUserContactRequests));

module.exports = router;