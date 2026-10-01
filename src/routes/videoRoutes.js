const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getDailyVideos, completeVideo } = require('../controllers/videoController');

const router = express.Router();
router.get('/daily', requireAuth, getDailyVideos);
router.post('/complete', requireAuth, completeVideo);

module.exports = router;
