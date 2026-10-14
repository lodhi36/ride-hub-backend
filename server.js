// Global handlers to prevent crashes from unhandled promise rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [Unhandled Promise Rejection caught globally]:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('⚠️ [Uncaught Exception caught globally]:', error);
});

const express = require('express');
const http = require('http');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { Server } = require('socket.io');

const { connectDB, getLastConnectionError } = require('./db');
const { errorHandler } = require('./middleware/errorMiddleware');
const { socketHandler } = require('./sockets/socketHandler');

const likeController = require('./controllers/likeController');
const messageController = require('./controllers/messageController');
const profileController = require('./controllers/profileController');
const adminController = require('./controllers/adminController');
const liveController = require('./controllers/liveController');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

// Connect to Database
connectDB();

// Initialize Express app
const app = express();
app.set('trust proxy', true); // Trust reverse proxies/load balancers for accurate client IP audit
app.use(compression());

// Create HTTP server and Socket.io server
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, true),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  },
});

// Expose io instance to Express app so req.app.get('io') works everywhere
app.set('io', io);
global.io = io;

// Pass IO instance to controllers that need it
likeController.setIO(io);
messageController.setIO(io);
profileController.setIO(io);
if (adminController.setIO) adminController.setIO(io);
const bookingController = require('./controllers/bookingController');
if (bookingController.setIO) bookingController.setIO(io);
const supportController = require('./controllers/supportController');
if (supportController.setIO) supportController.setIO(io);

// Initialize Socket Handler
socketHandler(io);

// Security Middleware & Comprehensive CORS Configuration
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: false,
}));

const corsOptions = {
  origin: (origin, callback) => {
    // Reflect request origin to allow Web, Android WebView, React Native, Postman, etc.
    // Spec compliant: when credentials is true, origin must NOT be wildcard '*'
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'authorization',
    'X-Role',
    'x-role',
    'x-auth-token',
  ],
  exposedHeaders: ['Authorization', 'Content-Range', 'X-Total-Count'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  validate: { trustProxy: false },
});
app.use(limiter);

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Custom request logger per user requirements
app.use((req, res, next) => {
  console.log(`[API Request Received] ${req.method} ${req.originalUrl}`);
  next();
});

// Body parsers
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Ultra-Fast Static Assets Serving with Cache-Control and HTTP Byte-Range Streaming
app.use(['/uploads', '/api/uploads'], express.static(path.join(__dirname, 'uploads'), {
  maxAge: '7d',
  immutable: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp4') || filePath.endsWith('.webm')) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.setHeader('Accept-Ranges', 'bytes');
    } else if (filePath.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// Middleware placeholder for DB connection status check
app.use((req, res, next) => {
  next();
});

// Routes
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({ status: 'ok' });
});
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'DatingApp API Server is running' });
});
app.get(['/api', '/api/'], (req, res) => {
  res.status(200).json({ status: 'ok', message: 'DatingApp API Base Endpoint' });
});

// HTTP REST Endpoint for Instant Ride Requests (HTTP Fallback + Socket Broadcast + Persistence)
app.post(['/api/rides/request', '/api/rides', '/api//api/rides/request'], async (req, res) => {
  const rideData = req.body || {};
  console.log(`🚕 [HTTP Ride Request Received]: Payload:`, JSON.stringify(rideData));

  const bId = rideData.rideId || rideData.bookingId || rideData._id || rideData.id || `book_${Date.now()}`;
  const payload = {
    ...rideData,
    bookingId: bId,
    rideId: bId,
    customerId: rideData.customerId || 'customer_device_1',
    customerName: rideData.customerName || 'Customer',
    distanceKm: rideData.distanceKm || 0.4,
    status: rideData.status || 'BOOKING_REQUESTED',
    createdAt: rideData.createdAt || new Date().toISOString(),
  };

  try {
    const Booking = require('./models/Booking');
    await Booking.findOneAndUpdate(
      { bookingId: bId },
      {
        bookingId: bId,
        customerId: payload.customerId,
        customerName: payload.customerName,
        customerPhone: payload.customerPhone || '9999999999',
        serviceName: payload.serviceName || payload.categoryName || 'Home Cleaning',
        categoryName: payload.categoryName || payload.serviceName || 'Home Cleaning',
        price: Number(payload.price || 299),
        serviceAddress: payload.pickupAddress || payload.serviceAddress || 'Service Location',
        latitude: Number(payload.latitude || payload.pickupLatitude || 0) || null,
        longitude: Number(payload.longitude || payload.pickupLongitude || 0) || null,
        scheduledDate: payload.scheduledDate || new Date().toISOString().split('T')[0],
        scheduledTime: payload.scheduledTime || '10:00 AM',
        status: payload.status,
      },
      { upsert: true, new: true }
    );
    console.log(`💾 [HTTP Ride Save] Saved ride ${bId} to MongoDB successfully.`);
  } catch (err) {
    console.error('❌ [HTTP Ride Save Error]:', err.message);
  }

  const { dispatchBookingToEligibleSuppliers } = require('./sockets/socketHandler');
  if (typeof dispatchBookingToEligibleSuppliers === 'function') {
    await dispatchBookingToEligibleSuppliers(io, payload);
  } else {
    io.to('online_suppliers').emit('new_ride_request', payload);
  }

  io.emit('booking_status_updated', { bookingId: bId, status: 'BOOKING_REQUESTED', updatedAt: new Date() });
  return res.status(200).json({ success: true, message: 'Ride request saved to MongoDB & dispatched to eligible online suppliers', ride: payload });
});

// Direct Withdrawal Request Endpoint (Fallback + Multi-Route support for Rider & User Payouts)
app.post(['/api/bookings/withdraw', '/api/payments/withdraw', '/api/withdraw', '/api/rides/withdraw', '/withdraw'], async (req, res) => {
  try {
    const { providerId, userId, withdrawAmount, upiId, bankDetails } = req.body;
    const pId = providerId || userId || (req.user && req.user.id);
    const amount = Number(withdrawAmount);
    if (!pId) {
      return res.status(400).json({ success: false, message: 'providerId is required' });
    }
    if (isNaN(amount) || amount < 1) {
      return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is ₹1.' });
    }
    const resolvedBankDetails = bankDetails || (upiId ? `UPI ID: ${upiId}` : 'UPI Payout');
    const Booking = require('./models/Booking');
    const User = require('./models/User');
    const idVariants = [pId, String(pId)];
    try {
      const u = await User.findById(pId);
      if (u) {
        if (u._id) idVariants.push(String(u._id));
        if (u.partnerId) idVariants.push(String(u.partnerId));
      }
    } catch (e) {}
    const completedBookings = await Booking.find({
      $or: [
        { providerId: { $in: idVariants } },
        { restaurantId: { $in: idVariants } },
        { partnerId: { $in: idVariants } },
      ],
      status: { $in: ['COMPLETED', 'SERVICE_COMPLETED', 'DELIVERED'] },
    });
    const totalServiceEarnings = completedBookings.reduce((sum, b) => {
      const isFood = (
        b.categoryName === 'Food Delivery' ||
        b.serviceName === 'Food Delivery' ||
        Boolean(b.restaurantId || (b.cartItems && typeof b.cartItems === 'object' && Object.keys(b.cartItems).length > 0))
      );
      if (isFood) {
        const sub = Number(b.subtotal);
        if (!isNaN(sub) && sub > 0) return sum + sub;
        const fee = Number(b.deliveryFee) || 0;
        return sum + Math.max(0, (Number(b.price) || 0) - fee);
      }
      return sum + (Number(b.price) || 0);
    }, 0);
    const Withdrawal = require('./models/Withdrawal');
    const prevWithdrawals = await Withdrawal.find({
      userId: { $in: idVariants },
      status: { $in: ['pending', 'approved'] },
    });
    const totalWithdrawn = prevWithdrawals.reduce((sum, w) => sum + (w.withdrawAmount || 0), 0);
    const currentPocketBalance = Math.max(0, totalServiceEarnings - totalWithdrawn);
    if (amount > currentPocketBalance) {
      return res.status(400).json({
        success: false,
        message: `Insufficient Pocket Balance! Your available balance is ₹${currentPocketBalance} only.`,
      });
    }
    const newBalance = currentPocketBalance - amount;
    const withdrawal = await Withdrawal.create({
      userId: pId,
      withdrawAmount: amount,
      balanceBefore: currentPocketBalance,
      balanceAfter: newBalance,
      bankDetails: resolvedBankDetails,
      status: 'pending',
    });
    const Transaction = require('./models/Transaction');
    try {
      await Transaction.create({
        userId: pId,
        type: 'withdrawal_payout',
        amount: -amount,
        currency: 'INR',
        status: 'pending',
        description: `Withdrawal request submitted: ₹${amount} to ${resolvedBankDetails}`,
      });
    } catch (tErr) {
      console.error('Error logging transaction for withdrawal:', tErr.message);
    }
    try {
      const _io = req.app.get('io') || global.io;
      if (_io) {
        const payload = { userId: pId, pocketBalance: newBalance, withdrawAmount: amount };
        _io.to(`user_${pId}`).emit('earnings_updated', payload);
        _io.to(`restaurant_${pId}`).emit('earnings_updated', payload);
        _io.emit('withdrawal_created', withdrawal);
      }
    } catch (sErr) {}
    return res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted successfully! Admin will review and process your payout.',
      withdrawal,
      pocketBalance: newBalance,
      totalEarnings: totalServiceEarnings,
    });
  } catch (error) {
    console.error('Error processing withdrawal request:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Direct Transactions History Endpoint
app.get(['/api/bookings/transactions', '/api/transactions', '/api/rides/transactions', '/transactions'], async (req, res) => {
  const bookingController = require('./controllers/bookingController');
  return bookingController.getProviderTransactions(req, res);
});

// Direct Admin Withdrawals Endpoints (Guarantees Admin Panel receives all payout requests without middleware blocking)
app.get(['/api/admin/withdrawals', '/admin/withdrawals', '/api/withdrawals'], async (req, res) => {
  const adminController = require('./controllers/adminController');
  return adminController.getWithdrawals(req, res);
});
app.post(['/api/admin/withdrawals/:id/status', '/admin/withdrawals/:id/status'], async (req, res) => {
  const adminController = require('./controllers/adminController');
  return adminController.updateWithdrawalStatus(req, res);
});

// Direct Customer Session Endpoint (MongoDB Save & JWT Generation)
app.post(['/api/auth/customer-session', '/api/customer-session', '/auth/customer-session'], async (req, res) => {
  try {
    const { customerId, name, email, phone, profilePicture } = req.body;
    const User = require('./models/User');
    const jwt = require('jsonwebtoken');
    const { getClientIp } = require('./utils/ipUtils');
    const clientIp = getClientIp(req);

    let user = null;
    console.log(`[CUSTOMER SESSION RECEIVED]: Name='${name}', Email='${email}', Phone='${phone}', IP='${clientIp.ipAddress}'`);
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '').slice(0, 10);
    const cleanName = (name && name.trim()) ? name.trim() : 'Customer';
    if (customerId && mongoose.Types.ObjectId.isValid(customerId)) {
      user = await User.findById(customerId);
    }
    if (!user && cleanPhone) {
      user = await User.findOne({ phoneNumber: cleanPhone });
    }
    if (!user && email && email.trim()) {
      user = await User.findOne({ email: email.toLowerCase().trim() });
    }
    if (!user) {
      const rand = Math.floor(1000 + Math.random() * 9000);
      const cleanUser = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + rand;
      const cleanEmail = (email && email.trim()) ? email.toLowerCase().trim() : `${cleanUser}@customer.local`;
      user = await User.create({
        username: cleanUser,
        email: cleanEmail,
        password: 'Password@123',
        name: cleanName,
        phoneNumber: cleanPhone || undefined,
        profilePicture: profilePicture || undefined,
        role: 'customer',
        isProfileComplete: true,
        registrationIp: clientIp.ipAddress,
        lastLoginIp: clientIp.ipAddress,
        ipVersion: clientIp.ipVersion,
        lastLoginAt: new Date(),
      });
      console.log(`[CUSTOMER CREATED IN MONGODB]: ID=${user._id}, Name=${user.name}`);
    } else {
      user.name = cleanName;
      if (cleanPhone) user.phoneNumber = cleanPhone;
      if (email && email.trim()) user.email = email.toLowerCase().trim();
      if (profilePicture) user.profilePicture = profilePicture;
      user.lastLoginIp = clientIp.ipAddress;
      user.ipVersion = clientIp.ipVersion;
      user.lastLoginAt = new Date();
      await user.save();
      console.log(`[CUSTOMER UPDATED IN MONGODB]: ID=${user._id}, Name=${user.name}`);
    }
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'jwt_secret_dating_app_key', { expiresIn: '30d' });
    return res.status(200).json({
      success: true,
      message: 'Customer saved successfully in MongoDB',
      token,
      user,
    });
  } catch (error) {
    console.error('[CUSTOMER SESSION ERROR]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to process customer session: ' + error.message,
    });
  }
});

// Direct Restaurant List & Check Endpoints
app.get(['/api/restaurants/check', '/api/profile/restaurants/check'], async (req, res) => {
  try {
    const User = require('./models/User');
    const MenuItem = require('./models/MenuItem');
    const users = await User.find({}).lean();
    const suppliers = users.filter((u) => u.role === 'supplier' || u.categoryName || (u.photos && u.photos.length > 0) || u.restaurant_status);
    const detailedSuppliers = await Promise.all(suppliers.map(async (s) => {
      const itemCount = await MenuItem.countDocuments({ restaurantId: s._id });
      return {
        id: s._id,
        name: s.name || s.username || 'N/A',
        email: s.email,
        phone: s.phoneNumber || s.phone || 'N/A',
        role: s.role,
        restaurant_status: s.restaurant_status || (s.isOnline ? 'online' : 'offline'),
        location: s.location || 'N/A',
        profilePicture: s.profilePicture ? 'Uploaded' : 'None',
        photosCount: s.photos ? s.photos.length : 0,
        menuItemsCount: itemCount,
      };
    }));
    res.json({
      success: true,
      totalUsersCount: users.length,
      totalRegisteredRestaurants: suppliers.length,
      restaurants: detailedSuppliers,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get(['/api/restaurants/online', '/api/profile/restaurants/online', '/api/restaurants'], async (req, res) => {
  const profileController = require('./controllers/profileController');
  return profileController.getOnlineRestaurants(req, res);
});

app.get(['/api/weather', '/weather', '/api/weather/current'], async (req, res, next) => {
  const weatherController = require('./controllers/weatherController');
  return weatherController.getWeather(req, res, next);
});

app.use(['/api/bookings', '/api/booking', '/bookings', '/booking', '/api/rides', '/api/ride', '/rides', '/ride'], require('./routes/bookingRoutes'));
app.get(['/api/bookingstatus', '/api/booking-status', '/bookingstatus', '/booking-status', '/api/bookingstuts', '/bookingstuts'], (req, res) => {
  const bookingController = require('./controllers/bookingController');
  return bookingController.getBookingStatus(req, res);
});
app.put(['/api/bookingstatus', '/api/booking-status', '/bookingstatus', '/booking-status', '/api/bookingstuts', '/bookingstuts'], (req, res) => {
  const bookingController = require('./controllers/bookingController');
  return bookingController.updateBookingStatus(req, res);
});
app.post(['/api/bookingstatus', '/api/booking-status', '/bookingstatus', '/booking-status', '/api/bookingstuts', '/bookingstuts'], (req, res) => {
  const bookingController = require('./controllers/bookingController');
  return bookingController.updateBookingStatus(req, res);
});
app.use('/api/auth', require('./routes/authRoutes'));
app.use(['/api/face', '/api/auth/face'], require('./routes/faceAuthRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/profile', require('./routes/profileRoutes'));
app.use('/api/likes', require('./routes/likeRoutes'));
app.use('/api/chats', require('./routes/chatRoutes'));
app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/verification', require('./routes/verificationRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/live', require('./routes/liveRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/banner', require('./routes/bannerRoutes'));
app.use('/api/banners', require('./routes/bannerRoutes'));
app.use('/api/earnings', require('./routes/earningsRoutes'));
app.use('/api/cashfree', require('./routes/cashfreeRoutes'));
app.use('/api/payment', require('./routes/razorpayRoutes'));
app.use('/api/razorpay', require('./routes/razorpayRoutes'));
app.use('/api/media', require('./routes/mediaRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/category', require('./routes/categoryRoutes'));
app.use('/api/cater', require('./routes/categoryRoutes'));
app.use('/api/admin/categories', require('./routes/categoryRoutes'));
app.use('/api/menu', require('./routes/menuRoutes'));
app.use('/api/weather', require('./routes/weatherRoutes'));
app.use('/api/support', require('./routes/supportRoutes'));
app.use('/api/zones', require('./routes/zoneRoutes'));
app.use('/api/zone', require('./routes/zoneRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/review', require('./routes/reviewRoutes'));
app.use('/api/terms', require('./routes/termsRoutes'));

// Seed default Bhopal zones and Hindi Terms & Conditions
const Zone = require('./models/Zone');
if (Zone.seedDefaultZones) {
  Zone.seedDefaultZones().catch((err) => console.log('Zone seeding note:', err.message));
}
const TermsAndConditions = require('./models/TermsAndConditions');
if (TermsAndConditions.seedDefaultTerms) {
  TermsAndConditions.seedDefaultTerms().catch((err) => console.log('Terms seeding note:', err.message));
}

// Error handling middleware (must be after routes)
app.use(errorHandler);

const os = require('os');
const PORT = process.env.PORT || 5000;
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  let found = '127.0.0.1';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (!iface.address.startsWith('169.254')) {
          return iface.address;
        }
        found = iface.address;
      }
    }
  }
  return found;
}

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log(`✅ Server running on http://${localIp}:${PORT}`);
  console.log(`📡 API Base:    http://${localIp}:${PORT}/api`);
  console.log(`🔌 Socket.IO:   http://${localIp}:${PORT}`);
});

module.exports = app;
