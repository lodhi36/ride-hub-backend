const express = require('express');
const router = express.Router();
const cashfreeController = require('../controllers/cashfreeController');
const jwt = require('jsonwebtoken');

// Optional auth middleware
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwt_secret_dating_app_key');
      req.user = decoded;
    } catch (e) {
      // Proceed without blocking guest customer checkout
    }
  }
  next();
};

// Create Order Session
router.post('/create-order', optionalAuth, cashfreeController.createOrder);

// Verify Order Payment (for store/food/ride bookings)
router.post('/verify-order-payment', optionalAuth, cashfreeController.verifyOrderPayment);

// Verify Wallet Recharge Payment
router.post('/verify', optionalAuth, cashfreeController.verifyPayment);
router.post('/verify-payment', optionalAuth, cashfreeController.verifyPayment);

// Fetch Order Status
router.get('/order-status/:orderId', optionalAuth, cashfreeController.getOrderStatus);

// Webhook
router.post('/webhook', cashfreeController.handleWebhook);

module.exports = router;
