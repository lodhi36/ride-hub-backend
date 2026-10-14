const express = require('express');
const { likeProfile, getLikesCount } = require('../controllers/likeController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/', protect, likeProfile);
router.get('/:userId', protect, getLikesCount);

module.exports = router;
