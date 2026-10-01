const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getProfile } = require('../controllers/userController');

const router = express.Router();
router.get('/profile', requireAuth, getProfile);

module.exports = router;
