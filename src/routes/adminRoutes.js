const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const admin = require('../controllers/adminController');

const router = express.Router();

router.post('/login', admin.adminLogin);

// All routes below require a valid admin JWT.
router.use(requireAuth, requireAdmin);

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
