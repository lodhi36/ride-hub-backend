const express = require('express');
const router = express.Router();
const { getEarningsSummary } = require('../controllers/earningsController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, getEarningsSummary);

module.exports = router;
