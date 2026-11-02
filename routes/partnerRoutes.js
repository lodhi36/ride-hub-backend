const express = require('express');
const router = express.Router();
const { getEarningsByDate } = require('../controllers/partnerEarningsController');
const { protect } = require('../middleware/authMiddleware');

// GET /api/partner/earnings-by-date?date=YYYY-MM-DD
router.get('/earnings-by-date', protect, getEarningsByDate);

module.exports = router;
