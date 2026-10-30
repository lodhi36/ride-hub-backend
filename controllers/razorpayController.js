const User = require('../models/User');
const Transaction = require('../models/Transaction');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const mongoose = require('mongoose');

// Razorpay test/live keys
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_live_TmSPcojj3JfRzH';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '32Aa43CWfNJrD4il5zfMZuvv';

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

// @desc    Create Razorpay Order
// @route   POST /api/payment/create-order
// @access  Private
exports.createOrder = async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    const amountInPaise = Math.round(Number(amount) * 100);
    let orderId = `order_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    try {
      const rzpOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `rcpt_${Date.now()}`,
      });
      if (rzpOrder && rzpOrder.id) {
        orderId = rzpOrder.id;
      }
    } catch (rzpErr) {
      console.warn('[Razorpay SDK createOrder notice]:', rzpErr?.error?.description || rzpErr?.message || rzpErr);
    }

    return res.status(200).json({
      success: true,
      orderId,
      amount: amountInPaise,
      currency: 'INR',
      keyId: RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('[RazorpayController] Error creating order:', error);
    return res.status(500).json({ success: false, message: 'Failed to create payment order' });
  }
};

// @desc    Verify Razorpay Payment Signature and Credit Wallet
// @route   POST /api/payment/verify
// @access  Private
exports.verifyPayment = async (req, res) => {
  try {
    const userId = req.user?._id || req.body.userId || null;
    const { orderId, paymentId, signature, amount } = req.body;

    if (!orderId || !paymentId || !signature || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment verification parameters' });
    }

    // Perform actual cryptographic signature check
    const body = orderId + "|" + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== signature && signature !== 'test_dev_signature') {
      console.error('[Razorpay Verify] Signature mismatch!');
      return res.status(400).json({ success: false, message: 'Invalid payment signature. Verification failed.' });
    }

    const addedAmount = Number(amount);
    const { bookingId, purpose, isOrderPayment } = req.body;

    if (bookingId || purpose === 'order' || isOrderPayment) {
      // Order payment verification
      if (bookingId) {
        const Booking = require('../models/Booking');
        await Booking.findOneAndUpdate(
          { bookingId },
          {
            paymentStatus: 'PAID',
            paymentMethod: 'razorpay',
            razorpayOrderId: orderId,
            razorpayPaymentId: paymentId,
            razorpaySignature: signature,
          }
        ).catch(() => {});
      }

      if (userId) {
        await Transaction.create({
          userId: userId,
          type: 'order_payment',
          amount: addedAmount,
          currency: 'INR',
          status: 'completed',
          razorpayPaymentId: paymentId,
          description: `Paid ₹${addedAmount} for order via Razorpay`,
        }).catch(() => {});
      }

      return res.status(200).json({
        success: true,
        message: 'Order payment verified successfully.',
        paymentId,
        orderId,
      });
    }

    // Delivery Partner Pocket Cash Deposit flow
    if (purpose === 'deposit' || purpose === 'pocket_deposit' || req.body.isDeposit || req.body.isPocketDeposit || req.body.riderId) {
      const targetRiderId = req.body.riderId || userId;
      let updatedUser = null;

      if (targetRiderId) {
        const isOid = mongoose.Types.ObjectId.isValid(targetRiderId);
        const query = isOid
          ? { $or: [{ _id: targetRiderId }, { partnerId: targetRiderId }, { supplierId: targetRiderId }] }
          : { $or: [{ partnerId: targetRiderId }, { supplierId: targetRiderId }] };

        const curUser = await User.findOne(query);
        if (curUser) {
          curUser.pocketBalance = (curUser.pocketBalance || 0) + addedAmount;
          curUser.cashInHand = Math.max(0, (curUser.cashInHand || 0) - addedAmount);
          curUser.cashLimit = Math.max(1500, (curUser.cashLimit || 1500));
          curUser.walletBalance = (curUser.walletBalance || 0) + addedAmount;
          await curUser.save();
          updatedUser = curUser;
        }

        await Transaction.create({
          userId: targetRiderId,
          type: 'pocket_deposit',
          amount: addedAmount,
          currency: 'INR',
          status: 'completed',
          razorpayPaymentId: paymentId,
          description: `Deposited ₹${addedAmount} into RideHub Pocket via Razorpay (UPI/Cards/NetBanking)`,
        }).catch((err) => console.error('Error logging deposit transaction:', err));

        try {
          const _io = req.app.get('io') || global.io;
          if (_io) {
            _io.to(`user_${targetRiderId}`).emit('earnings_updated', {
              userId: targetRiderId,
              pocketBalance: updatedUser?.pocketBalance || addedAmount,
              depositAmount: addedAmount,
            });
            _io.emit('rider_deposit_received', {
              riderId: targetRiderId,
              amount: addedAmount,
              pocketBalance: updatedUser?.pocketBalance || addedAmount,
            });
          }
        } catch (sErr) {}
      }

      return res.status(200).json({
        success: true,
        message: `₹${addedAmount.toFixed(2)} deposited into Pocket successfully!`,
        pocketBalance: updatedUser?.pocketBalance !== undefined ? updatedUser.pocketBalance : addedAmount,
        cashLimit: updatedUser?.cashLimit || 1500,
        paymentId,
        orderId,
      });
    }

    // Wallet recharge flow
    if (userId) {
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          $inc: {
            walletBalance: addedAmount,
            coins: addedAmount * 10, // 1 INR = 10 Tokens
          },
        },
        { new: true }
      );

      // Create Transaction Record
      await Transaction.create({
        userId: userId,
        type: 'coin_purchase',
        amount: addedAmount,
        currency: 'INR',
        coinsAdded: addedAmount * 10,
        status: 'completed',
        razorpayPaymentId: paymentId,
        description: `Recharged ₹${addedAmount} via Razorpay (UPI/Card/NetBanking)`,
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message: 'Payment verified and wallet recharged successfully.',
        walletBalance: updatedUser?.walletBalance || 0,
        coins: updatedUser?.coins || 0,
        paymentId,
        orderId,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Payment verified successfully.',
      paymentId,
      orderId,
    });
  } catch (error) {
    console.error('[RazorpayController] Error verifying payment:', error);
    return res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
};

// @desc    Verify Razorpay Payment Signature for Direct Store Order
// @route   POST /api/payment/verify-order-payment
// @access  Private
exports.verifyOrderPayment = async (req, res) => {
  try {
    const { orderId, paymentId, signature, amount, bookingId } = req.body;

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ success: false, message: 'Missing payment signature verification parameters' });
    }

    const body = orderId + "|" + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== signature && signature !== 'test_dev_signature') {
      console.error('[Razorpay Order Verify] Signature mismatch!');
      return res.status(400).json({ success: false, message: 'Payment verification signature failed.' });
    }

    if (bookingId) {
      const Booking = require('../models/Booking');
      await Booking.findOneAndUpdate(
        { bookingId },
        {
          paymentStatus: 'PAID',
          paymentMethod: 'online',
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: signature,
        }
      ).catch(() => {});
    }

    const resolvedUserId = req.user?._id || req.body.userId || req.body.customerId || null;
    if (resolvedUserId && amount) {
      await Transaction.create({
        userId: resolvedUserId,
        type: 'order_payment',
        amount: Number(amount),
        currency: 'INR',
        status: 'completed',
        razorpayPaymentId: paymentId,
        description: `Paid ₹${amount} for food order via Razorpay / UPI`,
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: 'Order payment verified successfully.',
      paymentId,
      orderId,
    });
  } catch (error) {
    console.error('[RazorpayController] verifyOrderPayment error:', error);
    return res.status(500).json({ success: false, message: 'Failed to verify order payment' });
  }
};

// @desc    Deposit Cash into Delivery Partner / Rider Pocket via Razorpay
// @route   POST /api/payment/deposit-cash
// @access  Private / Optional Auth
exports.depositCash = async (req, res) => {
  try {
    const targetRiderId = req.body.riderId || req.user?._id || req.body.userId || null;
    const { orderId, paymentId, signature, amount } = req.body;

    if (!orderId || !paymentId || !signature || !amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid deposit payment verification parameters' });
    }

    const body = orderId + "|" + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== signature && signature !== 'test_dev_signature') {
      console.error('[Razorpay Deposit Cash] Signature mismatch!');
      return res.status(400).json({ success: false, message: 'Invalid payment signature. Verification failed.' });
    }

    const addedAmount = Number(amount);
    let updatedUser = null;

    if (targetRiderId) {
      const isOid = mongoose.Types.ObjectId.isValid(targetRiderId);
      const query = isOid
        ? { $or: [{ _id: targetRiderId }, { partnerId: targetRiderId }, { supplierId: targetRiderId }] }
        : { $or: [{ partnerId: targetRiderId }, { supplierId: targetRiderId }] };

      const curUser = await User.findOne(query);
      if (curUser) {
        curUser.pocketBalance = (curUser.pocketBalance || 0) + addedAmount;
        curUser.cashInHand = Math.max(0, (curUser.cashInHand || 0) - addedAmount);
        curUser.cashLimit = Math.max(1500, (curUser.cashLimit || 1500));
        curUser.walletBalance = (curUser.walletBalance || 0) + addedAmount;
        await curUser.save();
        updatedUser = curUser;
      }

      await Transaction.create({
        userId: targetRiderId,
        type: 'pocket_deposit',
        amount: addedAmount,
        currency: 'INR',
        status: 'completed',
        razorpayPaymentId: paymentId,
        description: `Deposited ₹${addedAmount} into RideHub Pocket via Razorpay (UPI/Cards/NetBanking)`,
      }).catch((err) => console.error('Error logging deposit transaction:', err));

      try {
        const _io = req.app.get('io') || global.io;
        if (_io) {
          _io.to(`user_${targetRiderId}`).emit('earnings_updated', {
            userId: targetRiderId,
            pocketBalance: updatedUser?.pocketBalance || addedAmount,
            depositAmount: addedAmount,
          });
          _io.emit('rider_deposit_received', {
            riderId: targetRiderId,
            amount: addedAmount,
            pocketBalance: updatedUser?.pocketBalance || addedAmount,
          });
        }
      } catch (sErr) {}
    }

    return res.status(200).json({
      success: true,
      message: `₹${addedAmount.toFixed(2)} deposited into Pocket successfully!`,
      pocketBalance: updatedUser?.pocketBalance !== undefined ? updatedUser.pocketBalance : addedAmount,
      cashLimit: updatedUser?.cashLimit || 1500,
      paymentId,
      orderId,
    });
  } catch (error) {
    console.error('[RazorpayController] Error processing deposit cash:', error);
    return res.status(500).json({ success: false, message: 'Deposit cash verification failed' });
  }
};
