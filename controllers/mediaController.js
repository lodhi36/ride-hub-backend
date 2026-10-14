const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Message = require('../models/Message');

// @desc    Unlock Premium Locked Photo
// @route   POST /api/media/unlock
// @access  Private
exports.unlockMedia = async (req, res) => {
  try {
    const buyerId = req.user._id;
    const { messageId } = req.body;

    if (!messageId) {
      return res.status(400).json({ success: false, message: 'Message ID is required' });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Locked media message not found' });
    }

    const price = message.unlockPrice || 50;
    const sellerId = message.sender;

    // Check Buyer Wallet Balance
    const buyer = await User.findById(buyerId);
    if (!buyer || buyer.walletBalance < price) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. You need ₹${price} to unlock this photo. Please recharge.`
      });
    }

    // Deduct from Buyer
    buyer.walletBalance -= price;
    await buyer.save();

    // Credit to Seller
    const seller = await User.findById(sellerId);
    if (seller) {
      seller.totalEarnings = (seller.totalEarnings || 0) + price;
      seller.availableBalance = (seller.availableBalance || 0) + price;
      if (!seller.earningsBreakdown) {
        seller.earningsBreakdown = { voiceCalls: 0, videoCalls: 0, liveTokens: 0, lockedMedia: 0 };
      }
      seller.earningsBreakdown.lockedMedia = (seller.earningsBreakdown.lockedMedia || 0) + price;
      await seller.save();
    }

    // Record Transaction for Seller Earnings
    await Transaction.create({
      userId: sellerId,
      type: 'media_unlock',
      amount: price,
      currency: 'INR',
      status: 'completed',
      description: `Earned ₹${price} from Premium Photo unlock`,
      relatedUserId: buyerId,
    });

    // Record Transaction for Buyer Deduction
    await Transaction.create({
      userId: buyerId,
      type: 'gift_sent',
      amount: price,
      currency: 'INR',
      status: 'completed',
      description: `Unlocked Premium Photo`,
      relatedUserId: sellerId,
    });

    // Mark message as unlocked for this buyer
    if (!message.unlockedBy) message.unlockedBy = [];
    if (!message.unlockedBy.includes(buyerId)) {
      message.unlockedBy.push(buyerId);
      await message.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Photo unlocked successfully!',
      mediaUrl: message.mediaUrl,
      walletBalance: buyer.walletBalance,
    });
  } catch (error) {
    console.error('[MediaController] Error unlocking media:', error);
    return res.status(500).json({ success: false, message: 'Server error unlocking media' });
  }
};
