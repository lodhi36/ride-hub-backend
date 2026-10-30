const express = require('express');
const mongoose = require('mongoose');
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
  if (req.user && (req.user.isAdmin || req.user.role === 'admin' || req.user.role === 'superadmin')) {
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


// ── Supplier Search by Registered Contact Number (Requirement 8) ──
router.get('/supplier-search', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ success: false, message: 'Please provide a contact number to search.' });
    }

    const raw = String(phone).trim();
    const User = require('../models/User');
    const Booking = require('../models/Booking');
    const MenuItem = require('../models/MenuItem');
    const Withdrawal = require('../models/Withdrawal');

    let suppliers = [];
    if (mongoose.Types.ObjectId.isValid(raw)) {
      suppliers = await User.find({ _id: new mongoose.Types.ObjectId(raw) }).select('-password').lean();
    }
    console.log('[SUPPLIER_SEARCH]', { raw, isValid: mongoose.Types.ObjectId.isValid(raw), count: suppliers.length });

    if (suppliers.length === 0) {
      const cleanDigits = raw.replace(/\D/g, '');
      const last10 = cleanDigits.slice(-10);

      if (last10.length < 5) {
        return res.status(400).json({ success: false, message: 'Please enter at least 5 digits of the contact number.' });
      }

      suppliers = await User.find({
        $and: [
          {
            $or: [
              { phoneNumber: { $regex: last10 } },
              { phone: { $regex: last10 } },
              { phoneNumber: raw },
              { phone: raw }
            ]
          },
          {
            $or: [
              { role: 'supplier' },
              { restaurantName: { $exists: true, $ne: '' } },
              { partnerType: { $exists: true } }
            ]
          }
        ]
      }).select('-password').lean();
    }

    if (suppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No registered supplier found matching contact number "${phone}".`,
        count: 0,
        matches: []
      });
    }

    // If multiple matches, return explicit disambiguation list (Requirement 8)
    if (suppliers.length > 1) {
      const summaryList = suppliers.map(s => ({
        _id: s._id,
        supplierId: s._id,
        name: s.name || s.username,
        storeName: s.restaurantName || s.name || 'Store',
        phoneNumber: s.phoneNumber || s.phone,
        businessAddress: s.businessAddress || s.location || s.address || 'Address not set',
        role: s.role,
        restaurant_status: s.restaurant_status || 'offline',
        createdAt: s.createdAt,
      }));
      return res.json({
        success: true,
        disambiguation: true,
        message: `Found ${suppliers.length} matching supplier accounts. Please select one.`,
        count: suppliers.length,
        matches: summaryList,
      });
    }

    // Single matching supplier: build complete store detail view with real records
    const supplier = suppliers[0];
    const suppId = supplier._id;

    const sIdStr = String(suppId);
    const [orders, withdrawalsList, products] = await Promise.all([
      Booking.find({
        $or: [
          { providerId: sIdStr },
          { restaurantId: sIdStr },
          { supplierId: sIdStr }
        ]
      })
        .select('bookingId rideId price status cancellationReason customerName createdAt deliveryFee supplierNet')
        .sort({ createdAt: -1 })
        .limit(60)
        .lean(),

      Withdrawal.find({ userId: sIdStr })
        .select('_id withdrawAmount status createdAt paymentMethod accountHolderName upiId')
        .sort({ createdAt: -1 })
        .limit(30)
        .lean(),

      MenuItem.find({
        $or: [{ restaurantId: suppId }, { restaurantId: sIdStr }]
      })
        .select('_id name price mrp category image isAvailable demographic')
        .sort({ createdAt: -1 })
        .limit(60)
        .lean()
    ]);

    const totalOrders = orders.length;
    const completedOrdersList = orders.filter(o => 
      ['COMPLETED', 'DELIVERED', 'SERVICE_COMPLETED', 'DELIVERED_SUCCESSFULLY'].includes(String(o.status || '').toUpperCase())
    );
    const completedOrders = completedOrdersList.length;

    const cancelledOrdersList = orders.filter(o => 
      ['CANCELLED', 'TIMEOUT', 'RESTAURANT_DECLINED', 'NO_RESPONSE'].includes(String(o.status || '').toUpperCase()) ||
      String(o.status || '').toUpperCase().includes('CANCEL')
    );
    const cancelledOrders = cancelledOrdersList.length;

    let totalEarnings = 0;
    completedOrdersList.forEach(o => {
      const earned = o.supplierNet || (o.price - (o.deliveryFee || 0)) || o.price || 0;
      totalEarnings += Number(earned);
    });

    const inProgressList = orders.filter(o => 
      ['PENDING_RESTAURANT', 'ACCEPTED', 'PREPARING', 'FOOD_READY', 'OUT_FOR_DELIVERY', 'STARTED'].includes(String(o.status || '').toUpperCase())
    );
    let pendingSettlement = 0;
    inProgressList.forEach(o => {
      const earned = o.supplierNet || (o.price - (o.deliveryFee || 0)) || o.price || 0;
      pendingSettlement += Number(earned);
    });

    res.json({
      success: true,
      disambiguation: false,
      supplier: {
        _id: supplier._id,
        supplierId: supplier._id,
        name: supplier.name || supplier.username,
        storeName: supplier.restaurantName || supplier.name || 'Store',
        phoneNumber: supplier.phoneNumber || supplier.phone,
        email: supplier.email || 'N/A',
        storeAddress: supplier.businessAddress || supplier.location || supplier.address || 'Address not specified',
        upiId: supplier.upiId || 'N/A',
        accountStatus: supplier.isBlocked ? 'Blocked' : (supplier.isVerified ? 'Verified' : 'Active'),
        restaurant_status: supplier.restaurant_status || (supplier.isOnline ? 'online' : 'offline'),
        walletBalance: supplier.walletBalance || supplier.availableBalance || 0,
        createdAt: supplier.createdAt,
      },
      metrics: {
        totalOrders,
        completedOrders,
        cancelledOrders,
        totalEarnings: Math.round(totalEarnings * 100) / 100,
        pendingSettlement: Math.round(pendingSettlement * 100) / 100,
        totalProducts: products.length,
        totalWithdrawals: withdrawalsList.length,
      },
      products,
      orders: orders.slice(0, 30),
      withdrawals: withdrawalsList,
    });
  } catch (error) {
    console.error('[supplier-search] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── Separate Order Sections & Real-Time Details (Requirement 9) ──
router.get('/orders', async (req, res) => {
  try {
    const { view, search, date } = req.query;
    const Booking = require('../models/Booking');

    const filters = [];

    if (view === 'cancelled') {
      filters.push({
        $or: [
          { status: { $regex: 'CANCEL', $options: 'i' } },
          { status: { $in: ['TIMEOUT', 'RESTAURANT_DECLINED', 'NO_RESPONSE', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT'] } },
          { deliveryStatus: 'CANCELLED' }
        ]
      });
    } else if (view === 'completed') {
      filters.push({
        status: { $in: ['COMPLETED', 'DELIVERED', 'SERVICE_COMPLETED', 'DELIVERED_SUCCESSFULLY'] }
      });
    } else if (view === 'supplier') {
      filters.push({
        $or: [
          { restaurantId: { $ne: null } },
          { supplierId: { $ne: null } },
          { partnerId: { $ne: null } },
          { bookingType: 'food' }
        ]
      });
    } else if (view === 'customer') {
      filters.push({
        $or: [
          { customerId: { $ne: null } },
          { customerPhone: { $ne: null } }
        ]
      });
    }

    if (date && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);
      filters.push({ createdAt: { $gte: startOfDay, $lte: endOfDay } });
    }

    if (search && String(search).trim()) {
      const q = String(search).trim();
      const searchRegex = new RegExp(q, 'i');
      filters.push({
        $or: [
          { bookingId: searchRegex },
          { rideId: searchRegex },
          { restaurantName: searchRegex },
          { customerName: searchRegex },
          { customerPhone: searchRegex },
          { providerName: searchRegex },
          { providerPhone: searchRegex }
        ]
      });
    }

    const finalQuery = filters.length > 0 ? { $and: filters } : {};

    const orders = await Booking.find(finalQuery)
      .select('bookingId rideId customerId customerName customerPhone restaurantName serviceName pickupAddress deliveryAddress providerName providerPhone price paymentMethod paymentStatus status cancellationReason refundStatus cartItems items createdAt')
      .sort({ createdAt: -1 })
      .limit(60)
      .lean();

    res.json({
      success: true,
      view: view || 'all',
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error('[admin/orders] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;


