const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const {
	register,
	verifyOtp,
	resendOtp,
	login,
	refreshSession,
	logout,
} = require('../controllers/authController');

const router = express.Router();
router.post('/register', asyncHandler(register));
router.post('/verify-otp', asyncHandler(verifyOtp));
router.post('/resend-otp', asyncHandler(resendOtp));
router.post('/login', asyncHandler(login));
router.post('/refresh', asyncHandler(refreshSession));
router.post('/logout', asyncHandler(logout));

module.exports = router;
