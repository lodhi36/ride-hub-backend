const mongoose = require('mongoose');
const User = require('../models/User');
const AdminSettings = require('../models/AdminSettings');
const LiveStream = require('../models/LiveStream');
const LiveReport = require('../models/LiveReport');
const Withdrawal = require('../models/Withdrawal');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const Booking = require('../models/Booking');
const jwt = require('jsonwebtoken');
const { sendPushNotification, sendMulticastNotification } = require('../services/firebase');

// Socket.IO instance (set via setIO)
let _io = null;
const setIO = (io) => { _io = io; };
const getIO = () => _io;


// Helper to generate JWT for admin
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'fallback_secret', {
    expiresIn: '30d',
  });
};

// Admin Login
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const identifier = (email || '').trim().toLowerCase();
    const user = await User.findOne({
      $or: [
        { email: identifier },
        { username: identifier },
        { username: email }
      ]
    });

    if (!user || !user.isAdmin) {
      return res.status(401).json({ success: false, message: 'Invalid credentials or not an admin' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    res.json({
      success: true,
      token: generateToken(user._id),
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Dashboard Stats
exports.getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: { $ne: 'admin' }, isAdmin: { $ne: true } });
    
    // Active users: count users where isOnline is true (app is open/running)
    const activeUsers = await User.countDocuments({
      role: { $ne: 'admin' },
      isAdmin: { $ne: true },
      isOnline: true
    });

    const premiumUsers = await User.countDocuments({ isPremium: true, role: { $ne: 'admin' }, isAdmin: { $ne: true } });
    const reportedAccounts = await User.countDocuments({ blockedUsers: { $exists: true, $not: { $size: 0 } }, role: { $ne: 'admin' }, isAdmin: { $ne: true } });

    // Real Earnings
    const earningsAggr = await Transaction.aggregate([
      { $match: { type: 'coin_purchase', status: 'completed' } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalEarnings = earningsAggr.length > 0 ? earningsAggr[0].total : 0;

    // Pending Withdrawals
    const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });

    // Registration Trend (Last 7 Days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const usersTrendAggr = await User.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo }, role: { $ne: 'admin' }, isAdmin: { $ne: true } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Format for frontend
    const last7Days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toISOString().split('T')[0];
      const found = usersTrendAggr.find(u => u._id === dateStr);
      return {
        date: d.toLocaleDateString('en-US', { weekday: 'short' }),
        count: found ? found.count : 0
      };
    });

    const totalRiders = await User.countDocuments({ role: { $in: ['rider', 'delivery_partner'] } });
    const totalSuppliers = await User.countDocuments({ role: { $in: ['supplier', 'restaurant'] } });
    const totalBookings = await Booking.countDocuments();
    const activeBookings = await Booking.countDocuments({
      status: { $in: ['BOOKING_REQUESTED', 'SEARCHING_RIDER', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'TRANSFER_REQUESTED', 'TRANSFER_ACCEPTED_PENDING_HANDOVER'] }
    });

    res.json({
      success: true,
      stats: {
        totalUsers,
        activeUsers,
        premiumUsers,
        reportedAccounts,
        totalEarnings,
        pendingWithdrawals,
        totalRiders,
        totalSuppliers,
        totalBookings,
        activeBookings,
      },
      registrationTrend: last7Days
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all users with real-time completed orders & order amounts from Booking model
exports.getAllUsers = async (req, res) => {
  try {
    const Booking = require('../models/Booking');
    const users = await User.find({ role: { $ne: 'admin' }, isAdmin: { $ne: true } }).select('-password').sort({ createdAt: -1 }).lean();

    // Fetch all completed bookings to compute real order stats
    const completedBookings = await Booking.find({
      status: { $in: ['COMPLETED', 'DELIVERED', 'PAID', 'SUCCESS', 'completed', 'delivered'] }
    }).select('customerId customerPhone providerId riderId restaurantId partnerId price finalAmount totalAmount status createdAt').lean();

    // Map stats by User ID, phone, and partnerId
    const customerStats = {};
    const riderStats = {};
    const storeStats = {};

    completedBookings.forEach((b) => {
      const amt = Number(b.price || b.finalAmount || b.totalAmount || 0);

      // Customer stats
      if (b.customerId) {
        const cid = b.customerId.toString();
        if (!customerStats[cid]) customerStats[cid] = { count: 0, amount: 0 };
        customerStats[cid].count += 1;
        customerStats[cid].amount += amt;
      }
      if (b.customerPhone) {
        const cphone = b.customerPhone.toString();
        if (!customerStats[cphone]) customerStats[cphone] = { count: 0, amount: 0 };
        customerStats[cphone].count += 1;
        customerStats[cphone].amount += amt;
      }

      // Rider stats
      const rId = (b.providerId || b.riderId)?.toString();
      if (rId) {
        if (!riderStats[rId]) riderStats[rId] = { count: 0, amount: 0 };
        riderStats[rId].count += 1;
        riderStats[rId].amount += amt;
      }

      // Store / Supplier stats
      const sId = (b.restaurantId || b.partnerId)?.toString();
      if (sId) {
        if (!storeStats[sId]) storeStats[sId] = { count: 0, amount: 0 };
        storeStats[sId].count += 1;
        storeStats[sId].amount += amt;
      }
    });

    // Attach real order stats to each user
    const enrichedUsers = users.map((u) => {
      const uid = u._id.toString();
      const uphone = u.phoneNumber || u.phone || '';
      const partnerId = u.partnerId || '';
      const role = (u.role || '').toLowerCase();

      let completedOrdersCount = 0;
      let totalOrderAmount = 0;

      if (role === 'rider' || role === 'delivery_partner') {
        const st = riderStats[uid] || riderStats[partnerId] || riderStats[uphone] || { count: 0, amount: 0 };
        completedOrdersCount = st.count;
        totalOrderAmount = st.amount;
      } else if (role === 'supplier' || role === 'restaurant' || role === 'store') {
        const st = storeStats[uid] || storeStats[partnerId] || storeStats[uphone] || { count: 0, amount: 0 };
        completedOrdersCount = st.count;
        totalOrderAmount = st.amount;
      } else {
        // Customer
        const st = customerStats[uid] || customerStats[uphone] || { count: 0, amount: 0 };
        completedOrdersCount = st.count;
        totalOrderAmount = st.amount;
      }

      return {
        ...u,
        completedOrdersCount,
        totalOrderAmount,
      };
    });

    res.json({ success: true, users: enrichedUsers });
  } catch (error) {
    console.error('Error fetching enriched users:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update user status (block/unblock/suspend)
exports.updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, action } = req.body; // action: 'block', 'unblock', 'delete'
    
    if (action === 'delete') {
      await User.findByIdAndDelete(id);
      return res.json({ success: true, message: 'User deleted successfully' });
    }

    if (action === 'block') {
      await User.findByIdAndUpdate(id, { isSuspended: true });
      return res.json({ success: true, message: 'User blocked successfully' });
    }

    if (action === 'unblock') {
      await User.findByIdAndUpdate(id, { isSuspended: false });
      return res.json({ success: true, message: 'User unblocked successfully' });
    }

    if (action === 'updateStatus' || action === 'verification') {
      await User.findByIdAndUpdate(id, { verificationStatus: status });
      return res.json({ success: true, message: `User marked as ${status}` });
    }

    if (action === 'approval') {
      const approvalStatus = (status || 'APPROVED').toUpperCase();
      const updatedUser = await User.findByIdAndUpdate(
        id,
        { approvalStatus },
        { new: true }
      ).select('-password');

      // Real-time broadcast to Seller App
      const io = req.app.get('io');
      if (io) {
        console.log(`📡 [ADMIN] Emitting seller_approval_updated for Seller ${id}: ${approvalStatus}`);
        io.emit('seller_approval_updated', {
          sellerId: String(id),
          approvalStatus,
          user: updatedUser,
        });
        io.to(`user_${id}`).emit('seller_approval_updated', {
          sellerId: String(id),
          approvalStatus,
          user: updatedUser,
        });
        io.emit('seller_status_updated', {
          sellerId: String(id),
          approvalStatus,
          user: updatedUser,
        });
      }

      return res.json({
        success: true,
        message: `Seller application marked as ${approvalStatus}`,
        user: updatedUser,
      });
    }

    res.json({ success: true, message: 'User updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Settings
exports.getSettings = async (req, res) => {
  try {
    let settings = await AdminSettings.findOne();
    if (!settings) {
      settings = await AdminSettings.create({});
    }
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    let settings = await AdminSettings.findOne();
    if (!settings) {
      settings = new AdminSettings();
    }
    
    Object.assign(settings, req.body);
    await settings.save();
    
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- Live Streams ---
exports.getActiveLiveStreams = async (req, res) => {
  try {
    const streams = await LiveStream.find({ status: 'live' }).populate('hostId', 'name username profilePicture').sort({ startedAt: -1 });
    res.json({ success: true, streams });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.endLiveStream = async (req, res) => {
  try {
    const { id } = req.params;
    await LiveStream.findByIdAndUpdate(id, { status: 'ended', endedAt: new Date() });
    res.json({ success: true, message: 'Stream ended by admin' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- Moderation Reports ---
exports.getReports = async (req, res) => {
  try {
    const reports = await LiveReport.find()
      .populate('reporterId', 'name username')
      .populate('reportedUserId', 'name username profilePicture')
      .populate('streamId', 'title')
      .sort({ createdAt: -1 });
    res.json({ success: true, reports });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.resolveReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'dismiss', 'ban_user'
    const report = await LiveReport.findById(id);
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

    if (action === 'ban_user') {
       // Optional logic to ban user
       await User.findByIdAndUpdate(report.reportedUserId, { $set: { isSuspended: true }}); // assuming isSuspended exists or just add blockedUsers logic
    }
    
    await LiveReport.findByIdAndDelete(id); // remove resolved report
    res.json({ success: true, message: 'Report resolved' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- Withdrawals ---
exports.getWithdrawals = async (req, res) => {
  try {
    const rawWithdrawals = await Withdrawal.find().sort({ createdAt: -1 }).lean();
    const User = require('../models/User');

    const withdrawals = await Promise.all(
      rawWithdrawals.map(async (w) => {
        let userObj = null;
        if (w.userId) {
          if (mongoose.Types.ObjectId.isValid(w.userId)) {
            userObj = await User.findById(w.userId).select('name username profilePicture phoneNumber phone').lean();
          }
          if (!userObj) {
            userObj = await User.findOne({
              $or: [{ phoneNumber: w.userId }, { phone: w.userId }, { username: w.userId }]
            }).select('name username profilePicture phoneNumber phone').lean();
          }
        }

        const resolvedUser = userObj || {
          _id: String(w.userId || 'N/A'),
          name: typeof w.userId === 'string' ? `Rider / Partner (${w.userId})` : 'Rider / Partner',
          phoneNumber: typeof w.userId === 'string' && /^\d{10}$/.test(w.userId) ? w.userId : 'N/A'
        };

        return {
          ...w,
          userId: resolvedUser
        };
      })
    );

    res.json({ success: true, withdrawals });
  } catch (error) {
    console.error('Error fetching admin withdrawals:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateWithdrawalStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'approved', 'rejected', 'pending'
    const withdrawal = await Withdrawal.findByIdAndUpdate(id, { status }, { new: true });
    
    if (withdrawal) {
      try {
        const Transaction = require('../models/Transaction');
        await Transaction.create({
          userId: withdrawal.userId,
          type: 'withdrawal_payout',
          amount: status === 'rejected' ? withdrawal.withdrawAmount : -withdrawal.withdrawAmount,
          currency: 'INR',
          status: status === 'approved' ? 'completed' : status === 'pending' ? 'pending' : 'failed',
          description: `Withdrawal status changed to ${status} by Admin (₹${withdrawal.withdrawAmount})`,
        });
      } catch (tErr) {
        console.error('Error logging transaction on withdrawal status update:', tErr.message);
      }

      // Emit real-time socket event so rider app instantly updates/deducts balance on screen
      try {
        if (_io) {
          _io.emit('booking_status_updated', {
            userId: withdrawal.userId,
            withdrawalId: withdrawal._id,
            status,
            type: 'withdrawal_update'
          });
          _io.emit('service_completed', { userId: withdrawal.userId });
        }
      } catch (sErr) {}
    }

    res.json({ success: true, message: `Withdrawal marked as ${status}`, withdrawal });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- Earnings ---
exports.getEarnings = async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ createdAt: -1 });
    
    const totalEarningsAggr = await Transaction.aggregate([
      { $match: { type: 'coin_purchase', status: 'completed' } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalEarnings = totalEarningsAggr.length > 0 ? totalEarningsAggr[0].total : 0;

    const totalPayoutsAggr = await Withdrawal.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: null, total: { $sum: "$amountCurrency" } } }
    ]);
    const totalPayouts = totalPayoutsAggr.length > 0 ? totalPayoutsAggr[0].total : 0;

    let settings = await AdminSettings.findOne();
    const commissionCut = settings?.coinToCurrencyRatio ? "Active" : "30%"; // Example fallback

    res.json({ 
      success: true, 
      transactions, 
      totalEarnings,
      totalPayouts,
      commissionCut
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- Admin Notifications ---

// @desc  Send notification to users (all / specific / premium)
// @route POST /api/admin/send-notification
exports.sendAdminNotification = async (req, res) => {
  try {
    const { title, message, userId } = req.body;
    // When sending FormData, multer parses fields into req.body
    // Default to 'all' if target is somehow missing
    const target = req.body.target || 'all_users';

    if (!message) {
      return res.status(400).json({ success: false, message: 'message is required' });
    }

    // Handle Image Upload
    let imageFilename = null;
    if (req.file) {
      const fs = require('fs');
      const path = require('path');
      const sharp = require('sharp');
      const allowedTypes = /jpeg|jpg|png|webp|jfif|avif|heic|heif|gif|svg/i;
      const ext = path.extname(req.file.originalname || '').toLowerCase();
      const mimetype = req.file.mimetype || '';
      if (!allowedTypes.test(ext) && !allowedTypes.test(mimetype)) {
        return res.status(400).json({ success: false, message: 'Only image files (jpg, jpeg, png, webp, etc.) are allowed' });
      }

      const uploadDir = path.join(__dirname, '../uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      imageFilename = `notification-${uniqueSuffix}.jpg`;
      const outputPath = path.join(uploadDir, imageFilename);

      try {
        await sharp(req.file.buffer)
          .rotate()
          .resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80, progressive: true })
          .toFile(outputPath);
      } catch (sharpErr) {
        console.warn('Sharp optimize failed in notification, writing raw buffer:', sharpErr.message);
        fs.writeFileSync(outputPath, req.file.buffer);
      }
    }

    // Build user query based on target
    let userQuery = { role: { $ne: 'admin' }, isAdmin: { $ne: true } };
    if (target === 'specific') {
      if (!userId) {
        return res.status(400).json({ success: false, message: 'userId is required for specific target' });
      }
      userQuery = { _id: userId, role: { $ne: 'admin' }, isAdmin: { $ne: true } };
    } else if (target === 'premium') {
      userQuery = { isPremium: true, role: { $ne: 'admin' }, isAdmin: { $ne: true } };
    } else if (target === 'active') {
      userQuery = { isOnline: true, role: { $ne: 'admin' }, isAdmin: { $ne: true } };
    }
    // target === 'all' or 'all_users' => userQuery = { role: { $ne: 'admin' }, isAdmin: { $ne: true } }
    if (target === 'all' || target === 'all_users') {
      userQuery = { role: { $ne: 'admin' }, isAdmin: { $ne: true } };
    }

    const users = await User.find(userQuery).select('_id pushToken notificationsEnabled');

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'No users found for the given target' });
    }

    const imagePath = imageFilename ? `/uploads/${imageFilename}` : null;

    // Save notification for each user in DB
    const notifDocs = users.map((u) => ({
      receiver: u._id,
      sender: null,
      type: 'admin',
      title: title || 'Admin Notification',
      text: message,
      isRead: false,
      isAdminNotification: true,
      image: imagePath,
    }));

    await Notification.insertMany(notifDocs);

    // Send FCM Push Notifications to all target devices
    const validTokens = users
      .filter((u) => u.pushToken && u.notificationsEnabled !== false)
      .map((u) => u.pushToken);

    if (validTokens.length > 0) {
      const pushTitle = title || '📢 Admin Broadcast';
      console.log(`[Admin Notification] Sending FCM Push Notification to ${validTokens.length} device(s)`);
      if (validTokens.length === 1) {
        await sendPushNotification(validTokens[0], pushTitle, message, { type: 'ADMIN' });
      } else {
        await sendMulticastNotification(validTokens, pushTitle, message, { type: 'ADMIN' });
      }
    }

    // Broadcast via Socket.IO in real-time
    if (_io) {
      const payload = {
        _id: `admin_${Date.now()}`,
        type: 'admin',
        title: title || 'Admin Notification',
        text: message,
        isAdminNotification: true,
        sender: null,
        image: imagePath,
        createdAt: new Date().toISOString(),
      };

      if (target === 'specific' && userId) {
        // Emit only to that user's room
        _io.to(`user_${userId}`).emit('admin_broadcast', payload);
      } else {
        // Emit to ALL connected sockets
        _io.emit('admin_broadcast', payload);
      }
    }

    res.json({
      success: true,
      message: `Notification sent to ${users.length} user(s)`,
      sentTo: users.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get all admin-sent notifications (history)
// @route GET /api/admin/notifications
exports.getSentNotifications = async (req, res) => {
  try {
    // Get distinct admin notifications (by text+title+image+createdAt grouping)
    const notifications = await Notification.aggregate([
      { $match: { isAdminNotification: true } },
      {
        $group: {
          _id: { title: '$title', text: '$text', image: '$image', createdAt: { $dateToString: { format: '%Y-%m-%dT%H:%M', date: '$createdAt' } } },
          sentTo: { $sum: 1 },
          title: { $first: '$title' },
          text: { $first: '$text' },
          image: { $first: '$image' },
          createdAt: { $first: '$createdAt' },
        }
      },
      { $sort: { createdAt: -1 } },
      { $limit: 50 },
    ]);

    res.json({ success: true, notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Delete admin-sent notification (remove from all users who received it)
// @route POST /api/admin/delete-notification
exports.deleteAdminNotification = async (req, res) => {
  try {
    const { title, text, createdAt } = req.body;

    if (!text || !createdAt) {
      return res.status(400).json({ success: false, message: 'text and createdAt are required' });
    }

    // Since createdAt in aggregate grouping is formatted to %Y-%m-%dT%H:%M (minute precision),
    // we match documents created within that minute.
    const groupDate = new Date(createdAt);
    const startDate = new Date(groupDate.getTime() - 60000); // 1 minute before
    const endDate = new Date(groupDate.getTime() + 60000);   // 1 minute after

    const deleteQuery = {
      isAdminNotification: true,
      text: text,
      title: title || null,
      createdAt: { $gte: startDate, $lte: endDate }
    };

    const result = await Notification.deleteMany(deleteQuery);

    // Broadcast deletion via Socket.IO
    if (_io) {
      _io.emit('admin_notification_deleted', {
        title: title || 'Admin Notification',
        text: text,
        createdAt: createdAt
      });
    }

    res.json({
      success: true,
      message: `Successfully deleted notification and removed from ${result.deletedCount} user(s).`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Upload settings banner image
// @route   POST /api/admin/settings/upload-banner
exports.uploadBanner = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }

    const fs = require('fs');
    const path = require('path');
    const sharp = require('sharp');
    const allowedTypes = /jpeg|jpg|png|webp|jfif|avif|heic|heif|gif|svg/i;
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const mimetype = req.file.mimetype || '';
    if (!allowedTypes.test(ext) && !allowedTypes.test(mimetype)) {
      return res.status(400).json({ success: false, message: 'Only image files (jpg, jpeg, png, webp, etc.) are allowed' });
    }

    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const imageFilename = `banner-${uniqueSuffix}.webp`;
    const outputPath = path.join(uploadDir, imageFilename);

    try {
      await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(outputPath);
    } catch (sharpErr) {
      console.warn('Sharp optimize failed in uploadBanner, writing raw buffer:', sharpErr.message);
      fs.writeFileSync(outputPath, req.file.buffer);
    }

    res.json({
      success: true,
      imageUrl: `/uploads/${imageFilename}`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendAdminNotification = async (req, res) => {
  try {
    const { title, message, target, userId } = req.body;
    const User = require('../models/User');
    const Notification = require('../models/Notification');
    const AdminNotification = require('../models/AdminNotification');
    const { sendMulticastNotification } = require('../services/firebase');
    const fs = require('fs');
    const path = require('path');

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Notification message is required.' });
    }

    let imageUrl = null;
    if (req.file) {
      const uploadDir = path.join(__dirname, '../uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const ext = path.extname(req.file.originalname) || '.jpg';
      const filename = `notif-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      const destPath = path.join(uploadDir, filename);

      if (req.file.buffer) {
        fs.writeFileSync(destPath, req.file.buffer);
      }
      imageUrl = `/uploads/${filename}`;
    }

    // Determine target users
    let targetUsers = [];
    const normalizedTarget = (target || 'all_users').toLowerCase();

    if (normalizedTarget === 'specific' && userId) {
      targetUsers = await User.find({ _id: userId });
    } else if (normalizedTarget === 'customer' || normalizedTarget === 'customers' || normalizedTarget === 'user' || normalizedTarget === 'users') {
      targetUsers = await User.find({ 
        $or: [
          { role: { $in: ['customer', 'user', 'Customer', 'User', ''] } },
          { role: { $exists: false } },
          { role: null },
          { role: { $nin: ['admin', 'rider', 'delivery_partner', 'provider', 'supplier', 'seller_partner', 'restaurant', 'store'] } }
        ],
        isAdmin: { $ne: true }
      });
    } else if (normalizedTarget === 'rider' || normalizedTarget === 'riders') {
      targetUsers = await User.find({ 
        role: { $in: ['rider', 'delivery_partner', 'driver', 'provider', 'Rider'] },
        isAdmin: { $ne: true }
      });
    } else if (normalizedTarget === 'supplier' || normalizedTarget === 'store' || normalizedTarget === 'restaurant') {
      targetUsers = await User.find({ 
        role: { $in: ['supplier', 'restaurant', 'store', 'seller_partner', 'merchant', 'Supplier', 'Restaurant'] },
        isAdmin: { $ne: true }
      });
    } else if (normalizedTarget === 'active') {
      targetUsers = await User.find({ isOnline: true, role: { $ne: 'admin' }, isAdmin: { $ne: true } });
    } else if (normalizedTarget === 'premium') {
      targetUsers = await User.find({ isPremium: true, role: { $ne: 'admin' }, isAdmin: { $ne: true } });
    } else {
      // all_users / everyone
      targetUsers = await User.find({ role: { $ne: 'admin' }, isAdmin: { $ne: true } });
    }

    if (targetUsers.length === 0) {
      return res.status(404).json({ success: false, message: 'No recipients found for the selected target audience.' });
    }

    // Save in AdminNotification history database
    const adminNotif = await AdminNotification.create({
      title: title || 'RideHub Notification',
      text: message.trim(),
      target: target || 'all_users',
      sentTo: targetUsers.length,
      image: imageUrl,
      targetUserId: normalizedTarget === 'specific' ? userId : null,
    });

    // Create in-app Notification records for all target users
    const notifDocs = targetUsers.map(user => ({
      receiver: user._id,
      type: 'admin',
      title: title || 'RideHub Notification',
      text: message.trim(),
      image: imageUrl,
      isAdminNotification: true,
      isRead: false,
    }));
    await Notification.insertMany(notifDocs);

    const payload = {
      _id: adminNotif._id.toString(),
      id: adminNotif._id.toString(),
      title: title || 'RideHub Notification',
      text: message.trim(),
      message: message.trim(),
      target: target || 'all_users',
      targetUserId: normalizedTarget === 'specific' ? userId : null,
      image: imageUrl,
      type: 'admin',
      isAdminNotification: true,
      isRead: false,
      createdAt: adminNotif.createdAt,
      sender: {
        _id: 'admin',
        name: 'RideHub Admin',
        username: 'admin',
      }
    };

    // Broadcast real-time Socket.IO event to active app clients
    if (_io) {
      // Broadcast to specific user rooms
      targetUsers.forEach(u => {
        const uRoom = u._id.toString();
        _io.to(uRoom).emit('receive_notification', payload);
        _io.to(`user_${uRoom}`).emit('receive_notification', payload);
        _io.to(uRoom).emit('new_notification', payload);
        _io.to(`user_${uRoom}`).emit('new_notification', payload);
        _io.to(uRoom).emit('admin_broadcast', payload);
        _io.to(`user_${uRoom}`).emit('admin_broadcast', payload);
      });

      // Also broadcast to target role rooms
      if (normalizedTarget === 'customer' || normalizedTarget === 'customers' || normalizedTarget === 'user') {
        _io.to('customers_room').emit('admin_broadcast', payload);
        _io.to('customers_room').emit('receive_notification', payload);
      } else if (normalizedTarget === 'rider' || normalizedTarget === 'riders') {
        _io.to('riders_room').emit('admin_broadcast', payload);
        _io.to('riders_room').emit('receive_notification', payload);
      } else if (normalizedTarget === 'supplier' || normalizedTarget === 'store' || normalizedTarget === 'restaurant') {
        _io.to('suppliers_room').emit('admin_broadcast', payload);
        _io.to('online_suppliers').emit('admin_broadcast', payload);
        _io.to('suppliers_room').emit('receive_notification', payload);
      }

      // Global broadcast (client-side filters if needed)
      _io.emit('admin_broadcast', payload);
      _io.emit('new_notification', payload);
    }

    // Send FCM Push Notifications if tokens exist
    const targetFCMTokens = targetUsers.map(u => u.pushToken).filter(Boolean);
    if (targetFCMTokens.length > 0) {
      try {
        await sendMulticastNotification(targetFCMTokens, title || 'Admin Notification', message.trim(), {
          type: 'ADMIN',
          image: imageUrl || '',
        });
      } catch (fcmErr) {
        console.error('[sendAdminNotification] FCM Error:', fcmErr.message);
      }
    }

    res.json({
      success: true,
      message: `Notification sent to ${targetUsers.length} user(s) successfully!`,
      adminNotif,
    });
  } catch (error) {
    console.error('Error sending admin notification:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSentNotifications = async (req, res) => {
  try {
    const AdminNotification = require('../models/AdminNotification');
    const Notification = require('../models/Notification');

    let notifications = await AdminNotification.find().sort({ createdAt: -1 });

    // Fallback: If AdminNotification log is empty, check Notification collection for isAdminNotification: true
    if (notifications.length === 0) {
      const userNotifs = await Notification.find({ isAdminNotification: true }).sort({ createdAt: -1 });
      const map = new Map();
      userNotifs.forEach(n => {
        const key = `${n.title}_${n.text}`;
        if (!map.has(key)) {
          map.set(key, {
            _id: n._id,
            title: n.title || 'Admin Notification',
            text: n.text,
            target: 'all_users',
            sentTo: 1,
            image: n.image,
            createdAt: n.createdAt,
          });
        } else {
          map.get(key).sentTo += 1;
        }
      });
      notifications = Array.from(map.values());
    }

    res.json({ success: true, notifications, data: notifications });
  } catch (error) {
    console.error('Error fetching sent notifications:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteAdminNotification = async (req, res) => {
  try {
    const { id, title, text, createdAt } = req.body;
    const AdminNotification = require('../models/AdminNotification');
    const Notification = require('../models/Notification');

    if (id) {
      const notif = await AdminNotification.findById(id);
      if (notif) {
        await AdminNotification.findByIdAndDelete(id);
        await Notification.deleteMany({ text: notif.text, isAdminNotification: true });
      } else {
        await AdminNotification.deleteMany({ text });
        await Notification.deleteMany({ text, isAdminNotification: true });
      }
    } else if (text) {
      await AdminNotification.deleteMany({ text });
      await Notification.deleteMany({ text, isAdminNotification: true });
    } else {
      return res.status(400).json({ success: false, message: 'Notification ID or text required for deletion.' });
    }

    if (_io) {
      _io.emit('admin_notification_deleted', { id, title, text, createdAt });
    }

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get approval requests segregated by tabs
exports.getApprovalRequests = async (req, res) => {
  try {
    const { role, tab, search } = req.query;
    let query = {
      role: { $in: ['rider', 'delivery_partner', 'provider', 'supplier', 'seller_partner', 'restaurant'] }
    };

    if (role) {
      if (role === 'rider') {
        query.role = { $in: ['rider', 'delivery_partner', 'provider'] };
      } else if (role === 'supplier') {
        query.role = { $in: ['supplier', 'seller_partner', 'restaurant'] };
      }
    }

    if (tab === 'new_rider') {
      query.role = { $in: ['rider', 'delivery_partner', 'provider'] };
      query.approvalStatus = { $in: ['PENDING_VERIFICATION', 'PENDING_TERMS', 'PENDING'] };
    } else if (tab === 'new_supplier') {
      query.role = { $in: ['supplier', 'seller_partner', 'restaurant'] };
      query.approvalStatus = { $in: ['PENDING_VERIFICATION', 'PENDING_TERMS', 'PENDING'] };
    } else if (tab === 'pending') {
      query.approvalStatus = { $in: ['PENDING_VERIFICATION', 'PENDING_DOCUMENTS', 'PENDING_TERMS', 'PENDING'] };
    } else if (tab === 'approved') {
      query.approvalStatus = 'APPROVED';
    } else if (tab === 'rejected') {
      query.approvalStatus = 'REJECTED';
    } else if (tab === 'more_docs') {
      query.approvalStatus = 'ADDITIONAL_DOCS_REQUESTED';
    }

    if (search) {
      const s = search.trim();
      query.$or = [
        { name: { $regex: s, $options: 'i' } },
        { phoneNumber: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
        { restaurantName: { $regex: s, $options: 'i' } },
      ];
    }

    const requests = await User.find(query).sort({ createdAt: -1 }).select('-password').lean();

    const counts = {
      new_rider: await User.countDocuments({ role: { $in: ['rider', 'delivery_partner', 'provider'] }, approvalStatus: { $in: ['PENDING_VERIFICATION', 'PENDING_TERMS', 'PENDING'] } }),
      new_supplier: await User.countDocuments({ role: { $in: ['supplier', 'seller_partner', 'restaurant'] }, approvalStatus: { $in: ['PENDING_VERIFICATION', 'PENDING_TERMS', 'PENDING'] } }),
      pending: await User.countDocuments({ role: { $in: ['rider', 'delivery_partner', 'provider', 'supplier', 'seller_partner', 'restaurant'] }, approvalStatus: { $in: ['PENDING_VERIFICATION', 'PENDING_DOCUMENTS', 'PENDING_TERMS', 'PENDING'] } }),
      approved: await User.countDocuments({ role: { $in: ['rider', 'delivery_partner', 'provider', 'supplier', 'seller_partner', 'restaurant'] }, approvalStatus: 'APPROVED' }),
      rejected: await User.countDocuments({ role: { $in: ['rider', 'delivery_partner', 'provider', 'supplier', 'seller_partner', 'restaurant'] }, approvalStatus: 'REJECTED' }),
      more_docs: await User.countDocuments({ role: { $in: ['rider', 'delivery_partner', 'provider', 'supplier', 'seller_partner', 'restaurant'] }, approvalStatus: 'ADDITIONAL_DOCS_REQUESTED' }),
    };

    return res.status(200).json({
      success: true,
      counts,
      requests,
    });
  } catch (error) {
    console.error('Error in getApprovalRequests:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Update request status (Approve, Reject, Request Docs)
exports.updateApprovalRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason, note } = req.body; // action: 'APPROVE', 'REJECT', 'REQUEST_DOCS'
    
    let updateFields = {};
    if (action === 'APPROVE') {
      updateFields.approvalStatus = 'APPROVED';
      updateFields.verificationStatus = 'verified';
    } else if (action === 'REJECT') {
      updateFields.approvalStatus = 'REJECTED';
      updateFields.rejectionReason = reason || 'नियमों या दस्तावेजों में त्रुटि के कारण आवेदन अस्वीकृत किया गया।';
    } else if (action === 'REQUEST_DOCS') {
      updateFields.approvalStatus = 'ADDITIONAL_DOCS_REQUESTED';
      updateFields.additionalDocsNote = note || reason || 'कृपया सत्यापन के लिए स्पष्ट एवं अतिरिक्त दस्तावेज़ अपलोड करें।';
    }

    const updatedUser = await User.findByIdAndUpdate(id, updateFields, { new: true }).select('-password');
    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'उपयोगकर्ता नहीं मिला।' });
    }

    // Realtime socket emit
    try {
      const io = req.app.get('io') || global.io || _io;
      if (io) {
        io.to(`user_${id}`).emit('approval_status_updated', {
          userId: id,
          approvalStatus: updatedUser.approvalStatus,
          rejectionReason: updatedUser.rejectionReason,
          additionalDocsNote: updatedUser.additionalDocsNote,
        });
        io.emit('seller_approval_updated', {
          sellerId: String(id),
          approvalStatus: updatedUser.approvalStatus,
          user: updatedUser,
        });
        io.to('admin_tracking').emit('approval_status_changed', {
          userId: id,
          approvalStatus: updatedUser.approvalStatus,
        });
      }
    } catch (sErr) {}

    return res.status(200).json({
      success: true,
      message: `आवेदन सफलतापूर्वक अपडेट किया गया: ${updatedUser.approvalStatus}`,
      user: updatedUser,
    });
  } catch (error) {
    console.error('Error in updateApprovalRequestStatus:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.setIO = setIO;
exports.getIO = getIO;

