const express = require('express');
const {
  startStream,
  endStream,
  getActiveStreams,
  getGifts,
  initiatePriorityRequest,
  verifyPriorityPayment,
  initiateGiftPayment,
  verifyGiftPayment,
} = require('../controllers/liveController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/start', protect, startStream);
router.post('/end', protect, endStream);
router.get('/active', protect, getActiveStreams);
router.get('/gifts', protect, getGifts);
router.post('/priority-request/initiate', protect, initiatePriorityRequest);
router.post('/priority-request/verify', protect, verifyPriorityPayment);
router.post('/gift/initiate', protect, initiateGiftPayment);
router.post('/gift/verify', protect, verifyGiftPayment);

module.exports = router;
