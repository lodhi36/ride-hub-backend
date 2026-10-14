const User = require('../models/User');
const Transaction = require('../models/Transaction');

// @desc    Get current user's earnings summary and transaction history
// @route   GET /api/earnings
// @access  Private
exports.getEarningsSummary = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select('totalEarnings availableBalance walletBalance earningsBreakdown name');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Fetch transactions where current user received earnings
    const transactions = await Transaction.find({
      userId: userId,
      type: { $in: ['voice_call', 'video_call', 'live_token', 'media_unlock', 'gift_received', 'coin_purchase'] }
    })
      .populate('relatedUserId', 'name profilePicture')
      .sort({ createdAt: -1 })
      .limit(100);

    const formattedTransactions = transactions.map(t => {
      const dateObj = new Date(t.createdAt);
      let paymentTypeLabel = 'Earning';
      if (t.type === 'voice_call') paymentTypeLabel = 'Voice Call';
      else if (t.type === 'video_call') paymentTypeLabel = 'Video Call';
      else if (t.type === 'live_token') paymentTypeLabel = 'Live Token';
      else if (t.type === 'media_unlock') paymentTypeLabel = 'Locked Photo Unlock';
      else if (t.type === 'gift_received') paymentTypeLabel = 'Gift Received';
      else if (t.type === 'coin_purchase') paymentTypeLabel = 'Wallet Recharge';

      return {
        id: t._id,
        transactionId: `TXN-${t._id.toString().substring(18).toUpperCase()}`,
        amount: t.amount,
        type: t.type,
        paymentType: paymentTypeLabel,
        senderName: t.relatedUserId ? t.relatedUserId.name : (t.description || 'User'),
        senderAvatar: t.relatedUserId ? t.relatedUserId.profilePicture : '',
        date: dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        time: dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
        status: t.status,
        createdAt: t.createdAt,
      };
    });

    const breakdown = user.earningsBreakdown || {
      voiceCalls: 0,
      videoCalls: 0,
      liveTokens: 0,
      lockedMedia: 0,
    };

    return res.status(200).json({
      success: true,
      userName: user.name,
      totalEarnings: user.totalEarnings || 0,
      availableBalance: user.availableBalance || user.walletBalance || 0,
      breakdown,
      transactions: formattedTransactions,
    });
  } catch (error) {
    console.error('[EarningsController] Error fetching earnings:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching earnings' });
  }
};
