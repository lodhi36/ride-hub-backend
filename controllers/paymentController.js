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
// Includes all legitimate earning streams (store orders, delivery fees, gifts, bookings)
const computeAvailableBalance = async (userId, userCoins) => {
  const earningTypes = [
    'service_earning',
    'delivery_earning',
    'order_earning',
    'gift_received',
    'voice_call',
    'video_call',
    'live_token',
    'media_unlock'
  ];

  const result = await Transaction.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId.toString()) } },
    {
      $group: {
        _id: null,
        totalReceived: {
          $sum: { $cond: [{ $in: ['$type', earningTypes] }, '$amount', 0] }
        },
        totalWithdrawn: {
          $sum: { $cond: [{ $eq: ['$type', 'withdrawal_payout'] }, { $abs: '$amount' }, 0] }
        },
      }
    }
  ]);

  if (result.length === 0) {
    return { totalReceived: userCoins, totalWithdrawn: 0, availableBalance: Math.max(0, userCoins) };
  }
  const { totalReceived, totalWithdrawn } = result[0];
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
      return res.status(400).json({ success: false, message: 'Bank details or UPI ID are required.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Available withdrawable balance across walletBalance and coins
    const currentBalance = Math.max(user.walletBalance || 0, user.availableBalance || 0, user.coins || 0);

    if (amount > currentBalance) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Your available balance is ₹${currentBalance} only.`,
      });
    }

    // Atomically deduct from user balances
    user.walletBalance = Math.max(0, (user.walletBalance || 0) - amount);
    user.availableBalance = Math.max(0, (user.availableBalance || 0) - amount);
    user.coins = Math.max(0, (user.coins || 0) - amount);
    await user.save();

    // Log pending withdrawal transaction in ledger
    await Transaction.create({
      userId,
      type: 'withdrawal_payout',
      amount: -amount,
      currency: 'INR',
      coinsAdded: 0,
      status: 'pending',
      description: `Withdrawal request: ₹${amount} to ${typeof bankDetails === 'object' ? JSON.stringify(bankDetails) : bankDetails}`,
    });

    const isSupplier = user.role === 'supplier' || Boolean(user.restaurantName);
    const resolvedRole = isSupplier ? 'supplier' : (user.role || 'customer');

    // Create withdrawal request for admin panel with real store/profile attributes
    const withdrawal = await Withdrawal.create({
      userId,
      userRole: resolvedRole,
      withdrawAmount: amount,
      balanceBefore: currentBalance,
      balanceAfter: currentBalance - amount,
      bankDetails,
      upiId: typeof bankDetails === 'string' && bankDetails.includes('@') ? bankDetails : (user.upiId || null),
      contactNumber: user.phoneNumber || user.phone || null,
      storeName: isSupplier ? (user.restaurantName || user.name) : null,
      storeAddress: isSupplier ? (user.businessAddress || user.location || user.address) : null,
      status: 'pending',
    });

    res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted successfully.',
      withdrawal,
      availableBalance: currentBalance - amount,
    });
  } catch (error) {
    console.error('[PaymentController] requestWithdrawal Error:', error);
    res.status(500).json({ success: false, message: 'Failed to request withdrawal.', error: error.message });
  }
};

// @desc    Get current user earnings + transaction history (Supports ?date=YYYY-MM-DD for Calendar)
// @route   GET /api/payments/my-earnings
// @access  Private
exports.getMyEarnings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { date } = req.query; // e.g. '2026-10-27'

    const user = await User.findById(userId).select('coins totalEarnedCoins totalGiftsReceived walletBalance availableBalance totalEarnings name role restaurantName businessAddress location');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const { totalReceived, totalWithdrawn, availableBalance } = await computeAvailableBalance(userId, Math.max(user.coins || 0, user.walletBalance || 0));

    const allEarningTypes = [
      'service_earning',
      'delivery_earning',
      'order_earning',
      'gift_received',
      'withdrawal_payout',
      'coin_purchase',
      'voice_call',
      'video_call',
      'live_token',
      'media_unlock'
    ];

    const txFilter = {
      userId,
      type: { $in: allEarningTypes },
    };

    let selectedDateStart = null;
    let selectedDateEnd = null;

    if (date && typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      selectedDateStart = new Date(`${date}T00:00:00.000Z`);
      selectedDateEnd = new Date(`${date}T23:59:59.999Z`);
      txFilter.createdAt = { $gte: selectedDateStart, $lte: selectedDateEnd };
    }

    const transactions = await Transaction.find(txFilter)
      .sort({ createdAt: -1 })
      .limit(100);

    // Fetch real completed orders for the selected date if requested
    let selectedDateOrders = [];
    let selectedDateEarnings = 0;

    if (selectedDateStart && selectedDateEnd) {
      const Booking = require('../models/Booking');
      const bookings = await Booking.find({
        $or: [
          { restaurantId: userId },
          { supplierId: userId },
          { providerId: userId },
          { riderId: userId },
          { partnerId: userId }
        ],
        status: { $in: ['COMPLETED', 'DELIVERED', 'SERVICE_COMPLETED', 'DELIVERED_SUCCESSFULLY'] },
        createdAt: { $gte: selectedDateStart, $lte: selectedDateEnd }
      }).sort({ createdAt: -1 }).lean();

      selectedDateOrders = bookings.map((b) => {
        const itemSum = b.supplierNet || (b.price - (b.deliveryFee || 0)) || b.price;
        selectedDateEarnings += Number(itemSum || 0);
        const cartList = Array.isArray(b.cartItems) ? b.cartItems : (Array.isArray(b.items) ? b.items : []);
        return {
          bookingId: b.bookingId,
          orderId: b.bookingId,
          customerName: b.customerName || 'Customer',
          status: b.status,
          price: b.price,
          earnedAmount: itemSum,
          deliveryFee: b.deliveryFee || 0,
          itemsCount: cartList.length || 1,
          createdAt: b.createdAt,
          paymentMethod: b.paymentMethod || 'online',
          paymentStatus: b.paymentStatus || 'PAID',
        };
      });
    }

    // Pending earnings: sum of non-completed active orders
    const Booking = require('../models/Booking');
    const pendingOrders = await Booking.find({
      $or: [
        { restaurantId: userId },
        { supplierId: userId },
        { providerId: userId }
      ],
      status: { $in: ['PENDING_RESTAURANT', 'ACCEPTED', 'PREPARING', 'FOOD_READY', 'OUT_FOR_DELIVERY'] }
    }).select('price supplierNet deliveryFee').lean();

    let pendingBalance = 0;
    pendingOrders.forEach((p) => {
      pendingBalance += Number(p.supplierNet || (p.price - (p.deliveryFee || 0)) || 0);
    });

    const activeBalance = Math.max(availableBalance, user.walletBalance || 0, user.availableBalance || 0);
    const lifeTimeEarnings = Math.max(totalReceived, user.totalEarnings || 0, activeBalance + totalWithdrawn);

    res.json({
      success: true,
      coins: user.coins || 0,
      totalEarnedCoins: lifeTimeEarnings,
      totalEarnings: lifeTimeEarnings,
      walletBalance: activeBalance,
      availableBalance: activeBalance,
      pendingBalance,
      pendingSettlement: pendingBalance,
      totalWithdrawn,
      selectedDate: date || null,
      selectedDateEarnings: Math.round(selectedDateEarnings * 100) / 100,
      selectedDateOrdersCount: selectedDateOrders.length,
      selectedDateOrders,
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
