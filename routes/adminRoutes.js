const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { upload } = require('../middleware/uploadMiddleware');
const {
  adminLogin,
  getDashboardStats,
  getAllUsers,
  updateUserStatus,
  getSettings,
  updateSettings,
  getActiveLiveStreams,
  endLiveStream,
  getReports,
  resolveReport,
  getWithdrawals,
  updateWithdrawalStatus,
  getEarnings,
  sendAdminNotification,
  getSentNotifications,
  deleteAdminNotification,
  uploadBanner,
  getApprovalRequests,
  updateApprovalRequestStatus,
} = require('../controllers/adminController');

const router = express.Router();

// Middleware to ensure user is admin
const adminOnly = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Not authorized as an admin' });
  }
};

// Auth
router.post('/login', adminLogin);

// Protected routes
router.use(protect);
router.use(adminOnly);

// Stats
router.get('/dashboard-stats', getDashboardStats);

// Users & Approvals
router.get('/users', getAllUsers);
router.get('/approvals', getApprovalRequests);
router.post('/approvals/:id', updateApprovalRequestStatus);
router.put('/approvals/:id', updateApprovalRequestStatus);
router.put('/users/:id/status', updateUserStatus);
router.put('/users/:id/verify', async (req, res, next) => {
  try {
    const User = require('../models/User');
    const { id } = req.params;
    const { status } = req.body; // 'verified', 'pending', 'rejected'
    
    await User.findByIdAndUpdate(id, { verificationStatus: status });
    res.json({ success: true, message: `User marked as ${status}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Settings
router.get('/settings', getSettings);
router.put('/settings', updateSettings);
router.post('/settings/upload-banner', upload.single('image'), uploadBanner);

// Live Streams
router.get('/live-streams', getActiveLiveStreams);
router.post('/live-streams/:id/end', endLiveStream);

// Reports
router.get('/reports', getReports);
router.post('/reports/:id/resolve', resolveReport);

// Withdrawals
router.get('/withdrawals', getWithdrawals);
router.post('/withdrawals/:id/status', updateWithdrawalStatus);

// Earnings
router.get('/earnings', getEarnings);

// Admin Notifications
router.post('/send-notification', upload.single('image'), sendAdminNotification);
router.get('/notifications', getSentNotifications);
router.post('/delete-notification', deleteAdminNotification);

// ── Support Admin UPI Approval (Main Admin only) ──
router.get('/support-upis', async (req, res) => {
  try {
    const { SupportWallet } = require('../models/SupportWallet');
    const wallets = await SupportWallet.find({ 'upiRequests.status': 'pending_approval' }).lean();
    const pendingList = [];
    wallets.forEach((w) => {
      (w.upiRequests || []).forEach((r) => {
        if (r.status === 'pending_approval') {
          pendingList.push({
            agentId: w.agentId,
            agentName: w.agentName,
            agentEmail: w.agentEmail,
            ...r,
          });
        }
      });
    });
    res.json({ success: true, count: pendingList.length, requests: pendingList });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/support-upi/review', async (req, res) => {
  try {
    const { SupportWallet } = require('../models/SupportWallet');
    const AuditLog = require('../models/AuditLog');
    const { agentId, requestId, action, rejectionReason } = req.body; // action: 'approve' | 'reject'

    const wallet = await SupportWallet.findOne({ agentId });
    if (!wallet) return res.status(404).json({ success: false, message: 'Support wallet not found' });

    const reqItem = wallet.upiRequests.find((r) => r.requestId === requestId || !requestId);
    if (!reqItem) return res.status(404).json({ success: false, message: 'UPI request not found' });

    if (action === 'approve') {
      reqItem.status = 'approved';
      reqItem.reviewedAt = new Date();
      reqItem.reviewedBy = req.user?.username || 'Main Admin';
      wallet.activeUpiId = reqItem.upiId;
      wallet.activeUpiHolder = reqItem.holderName;
      wallet.upiStatus = 'approved';
    } else {
      reqItem.status = 'rejected';
      reqItem.rejectionReason = rejectionReason || 'Rejected by Main Admin';
      reqItem.reviewedAt = new Date();
      reqItem.reviewedBy = req.user?.username || 'Main Admin';
      wallet.upiStatus = 'rejected';
    }

    await wallet.save();

    await AuditLog.logAction({
      userId: req.user?._id || req.user?.id,
      userRole: 'admin',
      userName: req.user?.username || 'Main Admin',
      action: action === 'approve' ? 'SUPPORT_UPI_APPROVED' : 'SUPPORT_UPI_REJECTED',
      category: 'upi',
      targetType: 'SupportWallet',
      targetId: agentId,
      details: { agentId, upiId: reqItem.upiId, action, rejectionReason },
      ipAddress: req.ip || '',
    });

    res.json({ success: true, message: `Support UPI ${action}d successfully.`, wallet });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── Support Admin Withdrawal Review (Main Admin only) ──
router.get('/support-withdrawals', async (req, res) => {
  try {
    const { SupportWithdrawal } = require('../models/SupportWallet');
    const withdrawals = await SupportWithdrawal.find({}).sort({ createdAt: -1 }).lean();
    res.json({ success: true, count: withdrawals.length, withdrawals });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/support-withdrawal/review', async (req, res) => {
  try {
    const { SupportWallet, SupportWithdrawal } = require('../models/SupportWallet');
    const AuditLog = require('../models/AuditLog');
    const { withdrawalId, action, rejectionReason, transactionId } = req.body;

    const withdrawal = await SupportWithdrawal.findOne({
      $or: [{ requestId: withdrawalId }, { _id: withdrawalId }],
    });
    if (!withdrawal) return res.status(404).json({ success: false, message: 'Withdrawal not found' });

    const wallet = await SupportWallet.findOne({ agentId: withdrawal.agentId });

    if (action === 'approve') {
      withdrawal.status = 'approved';
      withdrawal.approvedBy = req.user?.username || 'Main Admin';
      withdrawal.reviewedAt = new Date();
      withdrawal.processedAt = new Date();
      withdrawal.transactionId = transactionId || 'TXN_' + Date.now();
      await withdrawal.save();

      if (wallet) {
        wallet.balance = Math.max(0, wallet.balance - withdrawal.amount);
        wallet.totalWithdrawn = (wallet.totalWithdrawn || 0) + withdrawal.amount;
        wallet.transactions.push({
          type: 'payout',
          amount: -withdrawal.amount,
          balanceAfter: wallet.balance,
          description: `Withdrawal Approved & Processed to ${withdrawal.upiId}`,
          status: 'completed',
          referenceId: withdrawal.transactionId,
        });
        await wallet.save();
      }
    } else {
      withdrawal.status = 'rejected';
      withdrawal.rejectionReason = rejectionReason || 'Rejected by Main Admin';
      withdrawal.reviewedAt = new Date();
      await withdrawal.save();
    }

    await AuditLog.logAction({
      userId: req.user?._id || req.user?.id,
      userRole: 'admin',
      userName: req.user?.username || 'Main Admin',
      action: action === 'approve' ? 'SUPPORT_WITHDRAWAL_APPROVED' : 'SUPPORT_WITHDRAWAL_REJECTED',
      category: 'payout',
      targetType: 'SupportWithdrawal',
      targetId: withdrawal.requestId,
      details: { amount: withdrawal.amount, upiId: withdrawal.upiId, action, rejectionReason },
      ipAddress: req.ip || '',
    });

    res.json({ success: true, message: `Withdrawal request ${action}d successfully.`, withdrawal });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── Restaurant Cancellation & Penalty Management ──
router.get('/restaurant-cancellations', async (req, res) => {
  try {
    const Booking = require('../models/Booking');
    const cancelledOrders = await Booking.find({
      status: { $regex: 'CANCEL', $options: 'i' },
    })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();

    res.json({ success: true, count: cancelledOrders.length, cancellations: cancelledOrders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/restaurant-penalty/waive', async (req, res) => {
  try {
    const Booking = require('../models/Booking');
    const AuditLog = require('../models/AuditLog');
    const { bookingId, waiverReason } = req.body;

    const booking = await Booking.findOne({
      $or: [{ bookingId }, { rideId: bookingId }],
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    booking.restaurantPenaltyWaived = true;
    booking.restaurantPenaltyReason = waiverReason || 'Penalty waived by Main Admin';
    await booking.save();

    await AuditLog.logAction({
      userId: req.user?._id || req.user?.id,
      userRole: 'admin',
      userName: req.user?.username || 'Main Admin',
      action: 'RESTAURANT_PENALTY_WAIVED',
      category: 'order',
      targetType: 'Booking',
      targetId: bookingId,
      details: { bookingId, penalty: booking.restaurantPenaltyAmount, waiverReason },
      ipAddress: req.ip || '',
    });

    res.json({ success: true, message: 'Restaurant penalty waived successfully.', booking });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── Audit Logs ──
router.get('/audit-logs', async (req, res) => {
  try {
    const AuditLog = require('../models/AuditLog');
    const { category, limit = 100 } = req.query;
    const query = {};
    if (category) query.category = category;
    const logs = await AuditLog.find(query).sort({ createdAt: -1 }).limit(Number(limit)).lean();
    res.json({ success: true, count: logs.length, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

