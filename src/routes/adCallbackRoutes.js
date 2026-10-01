const express = require('express');
const { admobSsv, unityAdsSsv } = require('../controllers/adCallbackController');

const router = express.Router();
router.post('/admob-ssv', admobSsv);
router.post('/unity-ads-ssv', unityAdsSsv);

module.exports = router;
