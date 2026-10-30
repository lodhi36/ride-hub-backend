const express = require('express');
const router = express.Router();
const { createOrder, verifyPayment, verifyOrderPayment, depositCash } = require('../controllers/razorpayController');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const optionalAuth = async (req, res, next) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      const token = req.headers.authorization.split(' ')[1];
      if (token && token !== 'jwt_token' && token !== 'undefined' && token !== 'null') {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwt_secret_dating_app_key');
        if (decoded && decoded.id) {
          req.user = await User.findById(decoded.id).select('-password');
        }
      }
    } catch (e) {}
  }
  next();
};

router.post('/create-order', optionalAuth, createOrder);
router.post('/verify', optionalAuth, verifyPayment);
router.post('/verify-order-payment', optionalAuth, verifyOrderPayment);
router.post('/deposit-cash', optionalAuth, depositCash);
router.post('/verify-deposit', optionalAuth, depositCash);

module.exports = router;
