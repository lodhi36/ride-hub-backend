const Razorpay = require('razorpay');
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const Transaction = require('../models/Transaction');
const AdminSettings = require('../models/AdminSettings');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_dummykey123',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummysecret456',
});

// ── Helper: get admin settings (cached pattern) ──────────────
const getAdminSettings = async () => {
  let settings = await AdminSettings.findOne();
  if (!settings) {
    settings = await AdminSettings.create({});
  }
  return settings;
};

// @desc    Create Razorpay order for wallet top-up
// @route   POST /api/payments/create-order
// @access  Private
exports.createOrder = async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt } = req.body;

    const options = {
      amount: amount * 100, // Amount in paise
      currency,
      receipt: receipt || `receipt_${Date.now()}`
    };

    try {
      const order = await razorpay.orders.create(options);
      return res.status(200).json({ success: true, order, keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_antigravity_key' });
    } catch (sdkError) {
      console.warn('[PaymentController] Razorpay SDK create failed, returning fallback order:', sdkError.message);
      const fallbackOrder = {
        id: `order_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`,
        amount: Math.round(amount * 100),
        currency,
        receipt: options.receipt,
        status: 'created',
      };
      return res.status(200).json({
        success: true,
        order: fallbackOrder,
        keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_antigravity_key',
        isFallback: true,
      });
    }
  } catch (error) {
    console.error('[PaymentController] createOrder Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create payment order' });
  }
};

const { sendInternalMessage } = require('./messageController');

// @desc    Verify Razorpay payment and credit wallet
// @route   POST /api/payments/verify-payment
// @access  Private
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, chatId, receiverId, giftName, amount } = req.body;

    const secret = process.env.RAZORPAY_KEY_SECRET || 'dummysecret456';
    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      // Credit wallet balance to the user who paid
      if (amount && req.user) {
        await User.findByIdAndUpdate(req.user.id, {
          $inc: { walletBalance: amount }
        });

        await Transaction.create({
          userId: req.user.id,
          type: 'coin_purchase',
          amount: amount,
          currency: 'INR',
          coinsAdded: 0,
          status: 'completed',
          description: `Wallet top-up of ₹${amount} via Razorpay`,
        });
      }

      res.status(200).json({ success: true, message: 'Payment verified. Wallet credited.' });
    } else {
      res.status(400).json({ success: false, message: 'Invalid payment signature' });
    }
  } catch (error) {
    console.error('[PaymentController] verifyPayment Error:', error);
    res.status(500).json({ success: false, message: 'Payment verification failed', error: error.message });
  }
};

// ── Helper: compute true available balance ──
// user.coins = primary withdrawable balance (incremented on gift receive)
// Cross-check with transaction history for new data
const computeAvailableBalance = async (userId, userCoins) => {
  const result = await Transaction.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId.toString()) } },
    {
      $group: {
        _id: null,
        totalReceived: {
          $sum: { $cond: [{ $eq: ['$type', 'gift_received'] }, '$amount', 0] }
        },
        totalWithdrawn: {
          $sum: { $cond: [{ $eq: ['$type', 'withdrawal_payout'] }, { $abs: '$amount' }, 0] }
        },
      }
    }
  ]);

  if (result.length === 0) {
    // No transactions found — fall back to user.coins (old data)
    return { totalReceived: userCoins, totalWithdrawn: 0, availableBalance: Math.max(0, userCoins) };
  }
  const { totalReceived, totalWithdrawn } = result[0];
  // Use whichever is higher: transaction-based OR user.coins (handles old data)
  const availableBalance = Math.max(userCoins, totalReceived - totalWithdrawn);
  return { totalReceived: Math.max(totalReceived, userCoins), totalWithdrawn, availableBalance };
};

// @desc    Request earnings withdrawal
// @route   POST /api/payments/withdraw
// @access  Private
exports.requestWithdrawal = async (req, res) => {
  try {
    const { withdrawAmount, bankDetails } = req.body;
    const userId = req.user.id;

    const amount = Number(withdrawAmount);
    if (isNaN(amount) || amount < 1) {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal amount. Minimum is ₹1.' });
    }

    if (!bankDetails) {
      return res.status(400).json({ success: false, message: 'Bank details are required.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // user.coins IS the withdrawable balance
    const currentBalance = user.coins || 0;

    if (amount > currentBalance) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Your available balance is ₹${currentBalance} only.`,
      });
    }

    // Deduct from user.coins instantly
    user.coins = currentBalance - amount;
    await user.save();

    // Log withdrawal transaction for history
    await Transaction.create({
      userId,
      type: 'withdrawal_payout',
      amount: -amount,
      currency: 'INR',
      coinsAdded: 0,
      status: 'pending',
      description: `Withdrawal request: ₹${amount} to ${bankDetails}`,
    });

    // Create withdrawal request for admin panel
    const withdrawal = await Withdrawal.create({
      userId,
      withdrawAmount: amount,
      balanceBefore: currentBalance,
      balanceAfter: user.coins,
      bankDetails,
      status: 'pending',
    });

    res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted successfully.',
      withdrawal,
      availableBalance: user.coins,
    });
  } catch (error) {
    console.error('[PaymentController] requestWithdrawal Error:', error);
    res.status(500).json({ success: false, message: 'Failed to request withdrawal.', error: error.message });
  }
};

// @desc    Get current user earnings + transaction history
// @route   GET /api/payments/my-earnings
// @access  Private
exports.getMyEarnings = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).select('coins totalEarnedCoins totalGiftsReceived walletBalance name');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // user.coins IS the withdrawable available balance
    // Cross-check with transactions for accuracy, but always show at least user.coins
    const { totalReceived, totalWithdrawn, availableBalance } = await computeAvailableBalance(userId, user.coins || 0);

    // Only show gift-related and withdrawal transactions in earnings view
    const transactions = await Transaction.find({
      userId,
      type: { $in: ['gift_received', 'withdrawal_payout', 'coin_purchase'] },
    })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      coins: user.coins || 0,
      totalEarnedCoins: totalReceived,
      totalGiftsReceived: user.totalGiftsReceived || 0,
      walletBalance: user.walletBalance || 0,
      availableBalance,          // user.coins is source of truth
      totalWithdrawn,
      transactions,
      minWithdrawAmount: 1,
      platformCommissionPercent: 0,
    });
  } catch (error) {
    console.error('[PaymentController] getMyEarnings Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get user's personal withdrawal history
// @route   GET /api/payments/withdraw-history
// @access  Private
exports.getWithdrawHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const withdrawals = await Withdrawal.find({ userId: userId })
      .sort({ createdAt: -1 })
      .limit(30);

    res.json({
      success: true,
      withdrawals,
    });
  } catch (error) {
    console.error('[PaymentController] getWithdrawHistory Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Pay for booking using wallet balance
// @route   POST /api/payments/pay-booking
// @access  Private
exports.payBooking = async (req, res) => {
  try {
    const { amount, bookingId } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if ((user.walletBalance || 0) < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance.' });
    }

    user.walletBalance = (user.walletBalance || 0) - amount;
    await user.save();

    await Transaction.create({
      userId: req.user.id,
      type: 'withdrawal_payout',
      amount: amount,
      currency: 'INR',
      status: 'completed',
      description: `Service Booking payment for ID ${bookingId}`
    });

    res.json({ success: true, message: 'Booking paid from wallet.', walletBalance: user.walletBalance });
  } catch (error) {
    console.error('[PaymentController] payBooking Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
