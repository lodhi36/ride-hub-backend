const express = require('express');
const router = express.Router();
const {
  createOrder,
  verifyPayment,
  requestWithdrawal,
  getMyEarnings,
  getWithdrawHistory,
  payBooking,
} = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');

router.post('/create-order', protect, createOrder);
router.post('/verify-payment', protect, verifyPayment);
router.post('/withdraw', protect, requestWithdrawal);
router.get('/my-earnings', protect, getMyEarnings);
router.get('/withdraw-history', protect, getWithdrawHistory); // User's own payout history
router.post('/pay-booking', protect, payBooking);

module.exports = router;
