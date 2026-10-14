const express = require('express');
const router = express.Router();
const { unlockMedia } = require('../controllers/mediaController');
const { protect } = require('../middleware/authMiddleware');

router.post('/unlock', protect, unlockMedia);

module.exports = router;
