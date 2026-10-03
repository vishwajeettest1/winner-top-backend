const express = require('express');
const { requireAdminAuth, requireAdmin } = require('../middleware/auth');
const admin = require('../controllers/adminController');
const depositOptions = require('../controllers/depositOptionController');
const paymentProofs = require('../controllers/paymentProofController');
const { uploadSingle } = require('../utils/imageUploads');

const router = express.Router();

router.post('/login', admin.adminLogin);

// All routes below require a valid admin JWT.
router.use(requireAdminAuth, requireAdmin);

router.get('/deposit-options', depositOptions.listDepositOptions);
router.post('/deposit-options', uploadSingle('qrCode'), depositOptions.createDepositOption);
router.patch('/deposit-options/:id/active', depositOptions.setActiveDepositOption);
router.get('/payments', paymentProofs.listPaymentProofs);
router.get('/payments/:id/screenshot', paymentProofs.getPaymentProofScreenshot);
router.patch('/payments/:id', paymentProofs.reviewPaymentProof);

router.get('/videos', admin.listVideos);
router.post('/videos', admin.createVideo);
router.put('/videos/:id', admin.updateVideo);

router.get('/sponsored-content', admin.listSponsoredContent);
router.post('/sponsored-content', admin.createSponsoredContent);
router.put('/sponsored-content/:id', admin.updateSponsoredContent);

router.get('/users', admin.listUsers);
router.put('/users/:id/status', admin.setUserStatus);

router.get('/ledger', admin.getLedger);

router.get('/withdrawals', admin.listWithdrawals);
router.put('/withdrawals/:id', admin.reviewWithdrawal);

router.put('/settings/referral-share', admin.updateReferralShare);

module.exports = router;
