const LiveStream = require('../models/LiveStream');
const Gift = require('../models/Gift');
const LiveRequest = require('../models/LiveRequest');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_dummykey123';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'dummysecret456';

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

let ioInstance = null;

const setIO = (io) => {
  ioInstance = io;
};

const getIO = () => ioInstance;

// @desc    Start a new live stream
// @route   POST /api/live/start
// @access  Private
const startStream = async (req, res, next) => {
  const { title } = req.body;
  try {
    // End any existing active streams for this user
    await LiveStream.updateMany(
      { hostId: req.user.id, status: 'live' },
      { $set: { status: 'ended', endedAt: Date.now() } }
    );

    const stream = await LiveStream.create({
      hostId: req.user.id,
      title: title || `${req.user.username}'s Live Stream`,
    });

    res.status(201).json({ success: true, stream });
  } catch (error) {
    next(error);
  }
};

// @desc    End an active live stream
// @route   POST /api/live/end
// @access  Private
const endStream = async (req, res, next) => {
  try {
    await LiveStream.updateMany(
      { hostId: req.user.id, status: 'live' },
      { $set: { status: 'ended', endedAt: Date.now() } }
    );
    res.json({ success: true, message: 'All live streams ended successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all active live streams
// @route   GET /api/live/active
// @access  Private
const getActiveStreams = async (req, res, next) => {
  try {
    const streams = await LiveStream.find({ status: 'live' })
      .populate('hostId', 'username name profilePicture')
      .sort('-startedAt');
    
    res.json({ success: true, streams });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all available gifts
// @route   GET /api/live/gifts
// @access  Private
const getGifts = async (req, res, next) => {
  try {
    const gifts = await Gift.find().sort('coinCost');
    res.json({ success: true, gifts });
  } catch (error) {
    next(error);
  }
};

// @desc    Initiate priority speak request (create order)
// @route   POST /api/live/priority-request/initiate
// @access  Private
const initiatePriorityRequest = async (req, res, next) => {
  try {
    const { broadcasterId, amount } = req.body;
    const viewerId = req.user._id;

    if (!broadcasterId) {
      return res.status(400).json({ success: false, message: 'Broadcaster ID is required' });
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount' });
    }

    // Determine call duration based on amount
    // ₹1–₹10 -> 1 minute
    // ₹11–₹99 -> 2 minutes
    // ₹100 or more -> 5 minutes
    let durationMinutes = 1;
    if (amt > 10 && amt < 100) {
      durationMinutes = 2;
    } else if (amt >= 100) {
      durationMinutes = 5;
    }

    // Check for existing active or pending request for this user and broadcaster
    const existingRequest = await LiveRequest.findOne({
      broadcasterId,
      viewerId,
      status: { $in: ['pending_payment', 'pending_acceptance'] }
    });

    if (existingRequest) {
      if (existingRequest.status === 'pending_acceptance') {
        if (existingRequest.isPriority) {
          return res.status(400).json({ success: false, message: 'You already have a pending priority request in the queue' });
        }
        // If it's a normal request, we allow them to upgrade it by setting its status back to pending_payment
      }
    }

    // Create Razorpay order
    const receiptId = `receipt_priority_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const options = {
      amount: amt * 100, // paise
      currency: 'INR',
      receipt: receiptId,
    };

    let order;
    try {
      order = await razorpay.orders.create(options);
    } catch (err) {
      console.warn('[Razorpay API Error] Falling back to mock order:', err.message);
      order = {
        id: `order_priority_mock_${Date.now()}`,
        amount: amt * 100,
        currency: 'INR',
        receipt: receiptId,
      };
    }

    // Save or update LiveRequest record
    let liveRequest;
    if (existingRequest) {
      existingRequest.isPriority = true;
      existingRequest.status = 'pending_payment';
      existingRequest.plan = { price: amt, durationMinutes };
      existingRequest.orderId = order.id;
      existingRequest.paidAmount = amt;
      liveRequest = await existingRequest.save();
    } else {
      liveRequest = await LiveRequest.create({
        broadcasterId,
        viewerId,
        viewerName: req.user.name || req.user.username || 'User',
        viewerAvatar: req.user.profilePicture || '',
        isPriority: true,
        plan: { price: amt, durationMinutes },
        status: 'pending_payment',
        orderId: order.id,
        paidAmount: amt,
      });
    }

    return res.status(200).json({
      success: true,
      liveRequestId: liveRequest._id,
      order,
      keyId: RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('Error initiating priority request:', error);
    next(error);
  }
};

// @desc    Verify Razorpay payment and place requester in priority queue
// @route   POST /api/live/priority-request/verify
// @access  Private
const verifyPriorityPayment = async (req, res, next) => {
  try {
    const { liveRequestId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const userId = req.user._id;

    if (!liveRequestId || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'All payment parameters are required' });
    }

    // Verify signature to prevent fake payments
    let isMockBypass = false;
    if (process.env.NODE_ENV === 'development' && razorpay_order_id.startsWith('order_priority_mock_')) {
      isMockBypass = true;
    }

    if (!isMockBypass) {
      const secret = RAZORPAY_KEY_SECRET;
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(body.toString())
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Payment verification failed: Invalid signature' });
      }
    }

    // Prevent duplicate payments
    const existingTxn = await Transaction.findOne({ razorpayPaymentId: razorpay_payment_id });
    if (existingTxn) {
      return res.status(400).json({ success: false, message: 'Duplicate payment detected' });
    }

    const liveRequest = await LiveRequest.findById(liveRequestId);
    if (!liveRequest) {
      return res.status(404).json({ success: false, message: 'Live request not found' });
    }

    if (liveRequest.status !== 'pending_payment') {
      return res.status(400).json({ success: false, message: `Request is already in status: ${liveRequest.status}` });
    }

    // Update LiveRequest
    liveRequest.status = 'pending_acceptance';
    liveRequest.paymentId = razorpay_payment_id;
    liveRequest.paymentTime = new Date();
    await liveRequest.save();

    // Create a transaction log representing this payment
    await Transaction.create({
      userId: userId,
      type: 'priority_token',
      amount: liveRequest.paidAmount,
      currency: 'INR',
      razorpayPaymentId: razorpay_payment_id,
      relatedLiveRequestId: liveRequest._id,
      status: 'completed',
      description: `Paid ₹${liveRequest.paidAmount} for Voice Live Priority Speak Request`,
    });

    // Place in socket handler queue
    const { liveQueues, userSockets, getLiveQueueFromDB } = require('../sockets/socketHandler');
    const bIdStr = liveRequest.broadcasterId.toString();

    let queueObj;
    if (getLiveQueueFromDB) {
      const { priorityQueue, normalQueue } = await getLiveQueueFromDB(bIdStr);
      queueObj = { priorityQueue, normalQueue };
      liveQueues.set(bIdStr, queueObj);
    } else {
      const vIdStr = liveRequest.viewerId.toString();
      if (!liveQueues.has(bIdStr)) {
        liveQueues.set(bIdStr, { priorityQueue: [], normalQueue: [] });
      }
      queueObj = liveQueues.get(bIdStr);
      const requestItem = {
        viewerId: vIdStr,
        viewerName: liveRequest.viewerName,
        viewerAvatar: liveRequest.viewerAvatar,
        plan: liveRequest.plan,
        isPriority: true,
        liveRequestId: liveRequest._id.toString(),
        paymentTime: liveRequest.paymentTime,
      };
      queueObj.priorityQueue = queueObj.priorityQueue.filter(i => i.viewerId !== vIdStr);
      queueObj.priorityQueue.push(requestItem);
      queueObj.priorityQueue.sort((a, b) => new Date(a.paymentTime) - new Date(b.paymentTime));
      queueObj.normalQueue = queueObj.normalQueue.filter(i => i.viewerId !== vIdStr);
    }

    // Notify Host via Socket
    const io = getIO();
    if (io) {
      const hostSocketId = userSockets.get(bIdStr);
      if (hostSocketId) {
        io.to(hostSocketId).emit('queue_updated', {
          priorityQueue: queueObj.priorityQueue,
          normalQueue: queueObj.normalQueue,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Payment verified and priority speak request activated',
      liveRequest,
    });
  } catch (error) {
    console.error('Error verifying payment:', error);
    next(error);
  }
};

// @desc    Initiate gift payment (create Razorpay order)
// @route   POST /api/live/gift/initiate
// @access  Private
const initiateGiftPayment = async (req, res, next) => {
  try {
    const { broadcasterId, amount, giftName, giftEmoji } = req.body;

    if (!broadcasterId) {
      return res.status(400).json({ success: false, message: 'Broadcaster ID is required' });
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount' });
    }

    const receiptId = `receipt_gift_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const options = {
      amount: amt * 100, // paise
      currency: 'INR',
      receipt: receiptId,
    };

    let order;
    try {
      order = await razorpay.orders.create(options);
    } catch (err) {
      console.warn('[Razorpay API Error] Falling back to mock order:', err.message);
      order = {
        id: `order_gift_mock_${Date.now()}`,
        amount: amt * 100,
        currency: 'INR',
        receipt: receiptId,
      };
    }

    return res.status(200).json({
      success: true,
      order,
      keyId: RAZORPAY_KEY_ID,
      broadcasterId,
      amount: amt,
      giftName,
      giftEmoji
    });
  } catch (error) {
    console.error('Error initiating gift payment:', error);
    next(error);
  }
};

// @desc    Verify Razorpay gift payment and credit broadcaster
// @route   POST /api/live/gift/verify
// @access  Private
const verifyGiftPayment = async (req, res, next) => {
  try {
    const { broadcasterId, amount, giftName, giftEmoji, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const userId = req.user._id;

    if (!broadcasterId || !amount || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'All parameters are required' });
    }

    // Verify signature to prevent fake payments
    let isMockBypass = false;
    if (process.env.NODE_ENV === 'development' && razorpay_order_id.startsWith('order_gift_mock_')) {
      isMockBypass = true;
    }

    if (!isMockBypass) {
      const secret = RAZORPAY_KEY_SECRET;
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(body.toString())
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Payment verification failed: Invalid signature' });
      }
    }

    // Prevent duplicate payments
    const existingTxn = await Transaction.findOne({ razorpayPaymentId: razorpay_payment_id });
    if (existingTxn) {
      return res.status(400).json({ success: false, message: 'Duplicate payment detected' });
    }

    // Credit paid amount to host My Earnings in real time!
    const host = await User.findById(broadcasterId);
    if (!host) {
      return res.status(404).json({ success: false, message: 'Broadcaster not found' });
    }

    const giftAmount = Number(amount);
    host.totalEarnings = (host.totalEarnings || 0) + giftAmount;
    host.availableBalance = (host.availableBalance || 0) + giftAmount;
    if (!host.earningsBreakdown) {
      host.earningsBreakdown = { voiceCalls: 0, videoCalls: 0, liveTokens: 0, lockedMedia: 0 };
    }
    host.earningsBreakdown.liveTokens = (host.earningsBreakdown.liveTokens || 0) + giftAmount;
    await host.save();

    // Log transaction for the host
    await Transaction.create({
      userId: broadcasterId,
      type: 'live_token',
      amount: giftAmount,
      currency: 'INR',
      description: `${req.user.name || req.user.username || 'Someone'} sent ${giftEmoji} ${giftName} (${giftAmount} tokens)`,
      relatedUserId: userId,
      razorpayPaymentId: razorpay_payment_id,
      status: 'completed',
    });

    // Notify all users in room via Socket
    const io = getIO();
    if (io) {
      io.to(`live_${broadcasterId}`).emit('live_token_received', {
        senderId: userId.toString(),
        senderName: req.user.name || req.user.username || 'User',
        amount: giftAmount,
        giftName: giftName,
        giftEmoji: giftEmoji,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Gift payment verified successfully',
    });
  } catch (error) {
    console.error('Error verifying gift payment:', error);
    next(error);
  }
};

module.exports = {
  startStream,
  endStream,
  getActiveStreams,
  getGifts,
  setIO,
  getIO,
  initiatePriorityRequest,
  verifyPriorityPayment,
  initiateGiftPayment,
  verifyGiftPayment,
};
