const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const Booking = require('../models/Booking');
const { resolveSupplierIdentity, getSupplierSocketRooms } = require('../utils/idUtils');

// ── Rider Search Service ───────────────────────────────────────────────────
const riderSearchService = require('../services/riderSearchService');

// Map of userId -> socketIds
const userSockets = new Map();
// Set of userIds currently in an active call / ringing
const activeCallUsers = new Set();
// Map of broadcasterId -> { priorityQueue: [], normalQueue: [] }
const liveQueues = new Map();
// Map of broadcasterId -> setTimeout ID
const activeSpeakerTimeoutMap = new Map();

// In-Memory state for Ride Request Testing Flow
const onlineRiders = new Map(); // riderId -> { riderId, socketId, location, locationUpdatedAt, isOnline, isAvailable }
const pendingRides = new Map(); // rideId -> rideData

// Helper function to calculate distance between 2 GPS coordinates in Kilometers (Haversine formula)
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371; // Earth radius in KM
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

let _ioInstance = null;

const scheduleSupplierOrderDispatch = (payload, delayMs = 20000) => {
  if (!payload) return;
  const bId = payload.bookingId || payload.rideId;
  const cId = payload.customerId ? String(payload.customerId) : '';

  if (!global.activeSupplierDispatchTimers) {
    global.activeSupplierDispatchTimers = new Map();
  }

  if (bId && global.activeSupplierDispatchTimers.has(bId)) {
    clearTimeout(global.activeSupplierDispatchTimers.get(bId));
    global.activeSupplierDispatchTimers.delete(bId);
  }

  console.log(`⏳ [20-SECOND SUPPLIER DELAY] Scheduling order #${bId} for supplier dispatch in ${delayMs / 1000}s`);

  const timer = setTimeout(async () => {
    try {
      if (bId) global.activeSupplierDispatchTimers.delete(bId);

      // Check DB to ensure order was not cancelled during the 20-second window
      if (bId) {
        const fresh = await Booking.findOne({ bookingId: bId }).lean();
        if (fresh) {
          const st = (fresh.status || '').toUpperCase();
          if (st.includes('CANCEL') || st === 'TIMEOUT' || st === 'NO_RESPONSE' || st === 'RESTAURANT_DECLINED') {
            console.log(`⏱️ [20S DELAY ABORTED] Order #${bId} was cancelled (${st}) during 20s window. Aborting supplier dispatch.`);
            return;
          }
        }
      }

      if (!_ioInstance) {
        console.log(`⚠️ [20S DELAY] _ioInstance is null, cannot dispatch order #${bId}`);
        return;
      }

      console.log(`📢 [20S DELAY EXPIRED - DISPATCHING] Order #${bId} is now being dispatched to supplier partner rooms!`);
      await dispatchBookingToEligibleSuppliers(_ioInstance, payload);
    } catch (e) {
      console.error(`[20S DELAY ERROR] Failed dispatch for #${bId}:`, e.message);
    }
  }, delayMs);

  if (bId) {
    global.activeSupplierDispatchTimers.set(bId, timer);
  }
};

const dispatchBookingToEligibleSuppliers = async (io, payload) => {
  if (!payload) return { eligibleCount: 0 };
  const bId = payload.bookingId || payload.rideId;
  const cId = payload.customerId ? String(payload.customerId) : 'cust_unknown';
  const targetSupplierId = payload.restaurantId || payload.supplierId || payload.partnerId || payload.providerId;

  console.log(`\n==================================================`);
  console.log(`[SUPPLIER_MATCHING]`);
  console.log(`bookingId: ${bId}`);
  console.log(`customerId: ${cId}`);
  console.log(`targetSupplierId: ${targetSupplierId || 'ANY'}`);
  console.log(`==================================================`);

  let eligibleCount = 0;
  const pickupLat = Number(payload.pickupLatitude || payload.latitude || 0) || null;
  const pickupLon = Number(payload.pickupLongitude || payload.longitude || 0) || null;

  // Emit directly to target supplier's dedicated rooms if targetSupplierId is known
  if (targetSupplierId) {
    const sIdStr = resolveSupplierIdentity(targetSupplierId);
    const rooms = getSupplierSocketRooms(sIdStr);
    for (const rm of rooms) {
      // STRICT ROLE ISOLATION: NEVER emit supplier order request to customer rooms!
      if (cId && (rm === cId || rm === `user_${cId}` || rm === `customer_${cId}`)) {
        console.log(`🛡️ [DISPATCH GUARD] Skipping customer room ${rm} for order #${bId}`);
        continue;
      }
      io.to(rm).emit('new_food_order', payload);
      io.to(rm).emit('new_order', payload);
      io.to(rm).emit('new_booking_request', payload);
      io.to(rm).emit('new_ride_request', payload);
      io.to(rm).emit('ride_request', payload);
      io.to(rm).emit('service_request', payload);
      io.to(rm).emit('BOOKING_REQUEST', payload);
      io.to(rm).emit('FOOD_ORDER', payload);
    }
    eligibleCount++;
    console.log(`📢 [SUPPLIER DIRECT DISPATCH] Order ${bId} sent exclusively to supplier rooms for ${sIdStr}`);
  } else {
    // Fallback broadcast only to online suppliers
    io.to('online_suppliers').emit('new_food_order', payload);
    io.to('online_suppliers').emit('new_ride_request', payload);
    io.to('online_suppliers').emit('ride_request', payload);
    io.to('online_suppliers').emit('service_request', payload);
  }

  io.to('admin_tracking').emit('new_ride_request', payload);
  console.log(`📢 [MATCHING RESULT] Order dispatched to Supplier role rooms.\n`);

  return { eligibleCount };
};

const getLiveQueueFromDB = async (broadcasterId) => {
  const LiveRequest = require('../models/LiveRequest');
  const requests = await LiveRequest.find({
    broadcasterId,
    status: 'pending_acceptance'
  });

  const priorityQueue = [];
  const normalQueue = [];

  for (const req of requests) {
    const item = {
      viewerId: req.viewerId.toString(),
      viewerName: req.viewerName,
      viewerAvatar: req.viewerAvatar,
      plan: req.plan,
      isPriority: req.isPriority,
      liveRequestId: req._id.toString(),
      paymentTime: req.paymentTime || req.createdAt,
      createdAt: req.createdAt,
    };
    if (req.isPriority) {
      priorityQueue.push(item);
    } else {
      normalQueue.push(item);
    }
  }

  // Sort priority queue by paymentTime ascending (first successful payment gets higher priority)
  priorityQueue.sort((a, b) => new Date(a.paymentTime) - new Date(b.paymentTime));
  // Sort normal queue by createdAt ascending
  normalQueue.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return { priorityQueue, normalQueue };
};

const socketHandler = (io) => {
  _ioInstance = io;
  // Initialize riderSearchService with shared io + onlineRiders map
  riderSearchService.init(io, onlineRiders);

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // ── RIDER ONLINE ────────────────────────────────────────────────────────
    socket.on('rider_online', async (data) => {
      try {
        const riderId = (data && (data.riderId || data.userId)) || socket.userId;
        if (!riderId) return;
        const riderIdStr = riderId.toString();

        let lat  = (data && data.location && data.location.latitude) || (data && data.latitude) || null;
        let lon  = (data && data.location && data.location.longitude) || (data && data.longitude) || null;
        if (lat) lat = Number(lat);
        if (lon) lon = Number(lon);

        const dbUpdate = { rider_status: 'online', isOnline: true, isAvailable: true, lastSeen: new Date() };

        // Fallback to DB location if missing
        if ((!lat || !lon) && mongoose.Types.ObjectId.isValid(riderIdStr)) {
          const u = await User.findById(riderIdStr).select('latitude longitude');
          if (u && u.latitude && u.longitude) {
            lat = Number(u.latitude);
            lon = Number(u.longitude);
          }
        }

        // Update in-memory map with real GPS if provided
        const existing = onlineRiders.get(riderIdStr) || {};
        onlineRiders.set(riderIdStr, {
          ...existing,
          riderId: riderIdStr,
          socketId: socket.id,
          name: (data && data.name) || existing.name || 'Rider',
          vehicleType: (data && data.vehicleType) || existing.vehicleType || 'Bike',
          location: lat && lon ? { latitude: lat, longitude: lon } : (existing.location || null),
          locationUpdatedAt: lat && lon ? new Date() : (existing.locationUpdatedAt || null),
          isOnline: true,
          isAvailable: true,
        });

        socket.join('riders_room');
        socket.join(`rider_${riderIdStr}`);

        // Persist to DB
        if (lat && lon) { dbUpdate.latitude = lat; dbUpdate.longitude = lon; }
        if (mongoose.Types.ObjectId.isValid(riderIdStr)) {
          User.findByIdAndUpdate(riderIdStr, dbUpdate).catch(e => console.error('[rider_online] DB error:', e.message));
        }

        const onlinePayload = {
          riderId: riderIdStr,
          name: (data && data.name) || existing.name || 'Rider',
          vehicleType: (data && data.vehicleType) || existing.vehicleType || 'Bike',
          location: lat && lon ? { latitude: lat, longitude: lon } : (existing.location || null),
          latitude: lat || (existing.location && existing.location.latitude) || null,
          longitude: lon || (existing.location && existing.location.longitude) || null,
          status: 'online',
          isOnline: true,
          isAvailable: true,
        };

        io.to('admin_tracking').emit('rider_online_admin', onlinePayload);
        io.to('admin_tracking').emit('rider_online', onlinePayload);
        io.to('support_admin_room').emit('rider_online', onlinePayload);
        io.emit('rider_online_status', { riderId: riderIdStr, isOnline: true });

        console.log(`[RIDER_ONLINE] Rider ${riderIdStr} online. GPS: ${lat},${lon}`);

        // Retry any SEARCHING_FOR_RIDER orders
        riderSearchService.retrySearchingOrders(riderIdStr);
      } catch (err) {
        console.error('[rider_online] Error:', err.message);
      }
    });

    // ── RIDER OFFLINE ───────────────────────────────────────────────────────
    socket.on('rider_offline', async (data) => {
      try {
        const riderId = (data && (data.riderId || data.userId)) || socket.userId;
        if (!riderId) return;
        const riderIdStr = riderId.toString();

        onlineRiders.delete(riderIdStr);
        socket.leave('riders_room');

        if (mongoose.Types.ObjectId.isValid(riderIdStr)) {
          User.findByIdAndUpdate(riderIdStr, { rider_status: 'offline', isOnline: false, isAvailable: false, lastSeen: new Date() })
            .catch(e => console.error('[rider_offline] DB error:', e.message));
        }

        io.to('admin_tracking').emit('rider_offline_admin', { riderId: riderIdStr });
        io.to('admin_tracking').emit('rider_offline', { riderId: riderIdStr });
        io.to('support_admin_room').emit('rider_offline', { riderId: riderIdStr });
        io.emit('rider_online_status', { riderId: riderIdStr, isOnline: false });

        console.log(`[RIDER_OFFLINE] Rider ${riderIdStr} went offline.`);
      } catch (err) {
        console.error('[rider_offline] Error:', err.message);
      }
    });

        // ── RIDER GPS LOCATION UPDATE ────────────────────────────────────────────
    socket.on('rider_location_update', async (data) => {
      try {
        if (!data) return;
        const riderId = (data.riderId || data.userId || socket.userId);
        if (!riderId) return;
        const riderIdStr = riderId.toString();

        const lat = data.location ? Number(data.location.latitude) : Number(data.latitude);
        const lon = data.location ? Number(data.location.longitude) : Number(data.longitude);

        if (!lat || !lon || isNaN(lat) || isNaN(lon)) return;

        // Update in-memory map
        const existing = onlineRiders.get(riderIdStr) || { riderId: riderIdStr, socketId: socket.id, isOnline: true, isAvailable: true };
        existing.location = { latitude: lat, longitude: lon };
        existing.locationUpdatedAt = new Date();
        existing.socketId = socket.id;
        onlineRiders.set(riderIdStr, existing);

        // Async DB update for User model
        if (mongoose.Types.ObjectId.isValid(riderIdStr)) {
          User.findByIdAndUpdate(riderIdStr, {
            latitude: lat,
            longitude: lon,
            businessLatitude: lat,
            businessLongitude: lon,
            locationCoords: { latitude: lat, longitude: lon },
            lastSeen: new Date()
          }).catch(e => console.error('[rider_location_update] DB error:', e.message));
        }

        const bId = data.bookingId || data.rideId || data.orderId;

        // Live Real-Time GPS Broadcast payload
        const locationPayload = {
          riderId: riderIdStr,
          providerId: riderIdStr,
          bookingId: bId || undefined,
          rideId: bId || undefined,
          name: existing.name || data.name || 'Rider',
          latitude: lat,
          longitude: lon,
          driverLat: lat,
          driverLon: lon,
          location: { latitude: lat, longitude: lon },
          heading: data.heading || 0,
          speed: data.speed || 0,
          timestamp: Date.now(),
        };

        // If active booking ID is provided, emit to booking specific rooms
        if (bId) {
          const bIdStr = bId.toString();
          io.to(`booking_${bIdStr}`).emit('rider_location_update', locationPayload);
          io.to(`booking_${bIdStr}`).emit('rider_location_updated', locationPayload);
          io.to(`ride_${bIdStr}`).emit('rider_location_update', locationPayload);
          io.to(`order_${bIdStr}`).emit('rider_location_update', locationPayload);
          io.to(`order_${bIdStr}`).emit('rider_location_updated', locationPayload);
          io.emit(`provider_location_${bIdStr}`, locationPayload);

          // Update active booking in DB with fresh driver coordinates
          Booking.findOneAndUpdate(
            {
              $or: [
                { bookingId: bIdStr },
                { _id: mongoose.Types.ObjectId.isValid(bIdStr) ? bIdStr : null }
              ]
            },
            {
              $set: {
                driverLat: lat,
                driverLon: lon,
                riderLatitude: lat,
                riderLongitude: lon,
                riderLocation: { latitude: lat, longitude: lon },
                'acceptedBy.latitude': lat,
                'acceptedBy.longitude': lon,
                'acceptedBy.location': { latitude: lat, longitude: lon },
                'rider.latitude': lat,
                'rider.longitude': lon,
                'rider.location': { latitude: lat, longitude: lon }
              }
            }
          ).catch(() => {});
        }

        io.to('admin_tracking').emit('rider_location_update_admin', locationPayload);
        io.to('admin_tracking').emit('rider_location_update', locationPayload);
        io.to('support_admin_room').emit('rider_location_update', locationPayload);
        io.to('support_admin_room').emit('rider_location_updated', locationPayload);

        // If this rider was SEARCHING_FOR_RIDER orders, now they have a fresh location
        // Retry any matching search
        riderSearchService.retrySearchingOrders(riderIdStr);

      } catch (err) {
        console.error('[rider_location_update] Error:', err.message);
      }
    });

    // ── RIDER ACCEPT DELIVERY REQUEST ────────────────────────────────────────
    socket.on('rider_accept_request', async (data) => {
      try {
        const bookingId = data && (data.bookingId || data.orderId);
        const riderId   = data && (data.riderId || data.userId) || socket.userId;
        if (!bookingId || !riderId) return;

        console.log(`[RIDER_ACCEPT] Rider ${riderId} accepted booking ${bookingId}`);
        const result = await riderSearchService.riderAcceptDelivery(bookingId, riderId.toString());

        if (result.success) {
          socket.emit('rider_accept_success', { bookingId, message: result.message });
        } else {
          socket.emit('rider_accept_failed', { bookingId, message: result.message, alreadyTaken: result.alreadyTaken });
        }
      } catch (err) {
        console.error('[rider_accept_request] Error:', err.message);
        socket.emit('rider_accept_failed', { message: err.message });
      }
    });

    // ── RIDER REJECT DELIVERY REQUEST ────────────────────────────────────────
    socket.on('rider_reject_request', async (data) => {
      try {
        const bookingId = data && (data.bookingId || data.orderId);
        const riderId   = data && (data.riderId || data.userId) || socket.userId;
        if (!bookingId || !riderId) return;

        console.log(`[RIDER_REJECT] Rider ${riderId} rejected booking ${bookingId}`);
        const result = await riderSearchService.riderRejectDelivery(bookingId, riderId.toString());
        socket.emit('rider_reject_success', { bookingId, message: result.message });
      } catch (err) {
        console.error('[rider_reject_request] Error:', err.message);
      }
    });

    // Register user when they connect
    socket.on('register_user', async (userId) => {
      const uIdStr = (typeof userId === 'object' ? (userId._id || userId.id || userId) : userId)?.toString();
      if (!uIdStr) return;
      
      socket.userId = uIdStr;
      userSockets.set(uIdStr, socket.id);
      console.log(`[Register User] Mapped user ${uIdStr} to socket ${socket.id}`);
      
      // Join self-room for direct personal messages and status
      socket.join(uIdStr);
      socket.join(`user_${uIdStr}`);
      
      // Update online status in database, respecting explicit offline choice, and deliver pending offline messages
      try {
        if (mongoose.Types.ObjectId.isValid(uIdStr)) {
          const existingUser = await User.findById(uIdStr).lean();
          const userRole = (existingUser?.role || '').toLowerCase();
          if (userRole === 'rider' || userRole === 'delivery_partner' || userRole === 'provider') {
            socket.join('riders_room');
            socket.join(`rider_${uIdStr}`);
          } else if (userRole === 'supplier' || userRole === 'seller_partner' || userRole === 'restaurant' || userRole === 'store') {
            socket.join('online_suppliers');
            socket.join('suppliers_room');
            socket.join(`restaurant_${uIdStr}`);
            socket.join(`supplier_${uIdStr}`);
            socket.join(`supplier:${uIdStr}`);
          } else {
            // Strictly Customer
            socket.join('customers_room');
            socket.join(`customer_${uIdStr}`);
          }

          if (existingUser?.partnerId && (userRole === 'supplier' || userRole === 'seller_partner' || userRole === 'restaurant' || userRole === 'store')) {
            socket.join(existingUser.partnerId);
            socket.join(`supplier_${existingUser.partnerId}`);
            socket.join(`restaurant_${existingUser.partnerId}`);
          }
          // Respect actual user status in MongoDB - NEVER automatically force offline users to become online!
          const isUserOnline = Boolean(
            existingUser && (
              existingUser.isOnline === true ||
              existingUser.restaurant_status === 'online' ||
              existingUser.rider_status === 'online'
            )
          );

          if (isUserOnline) {
            // Keep onlineRiders map fresh with active socket ID
            onlineRiders.set(uIdStr, {
              riderId: uIdStr,
              name: existingUser?.name || existingUser?.restaurantName || 'Rider',
              socketId: socket.id,
              location: (existingUser?.latitude && existingUser?.longitude)
                ? { latitude: Number(existingUser.latitude), longitude: Number(existingUser.longitude) }
                : null,
              isOnline: true,
              isAvailable: existingUser.isAvailable !== false,
            });
            socket.join('riders_room');
            socket.join(`rider_${uIdStr}`);
            console.log(`[Register User] User ${uIdStr} is ONLINE in DB. Mapped with active socket ${socket.id}`);
            io.emit('user_status_change', { userId: uIdStr, isOnline: true });
          } else {
            onlineRiders.delete(uIdStr);
            console.log(`[Register User] User ${uIdStr} is OFFLINE in DB. Preserving OFFLINE status.`);
            io.emit('user_status_change', { userId: uIdStr, isOnline: false });
          }

          // If supplier or seller_partner, join deterministic supplier rooms
          if (existingUser && ['supplier', 'seller_partner'].includes(existingUser.role)) {
            socket.join(`supplier:${uIdStr}`);
            socket.join(`supplier_${uIdStr}`);
            socket.join(`restaurant_${uIdStr}`);
            socket.join(`user_${uIdStr}`);
            socket.join(uIdStr);
            socket.join('online_suppliers');
            socket.join('suppliers_room');
            console.log(`[Register User] Supplier ${uIdStr} joined supplier:${uIdStr} and associated rooms`);
          }

          // Retrieve and deliver all pending messages for this user
          const pendingMessages = await Message.find({ receiver: uIdStr, status: 'sent' });
          if (pendingMessages.length > 0) {
            await Message.updateMany({ receiver: uIdStr, status: 'sent' }, { status: 'delivered' });
            pendingMessages.forEach((msg) => {
              io.to(`user_${msg.sender}`).emit('message_status_update', {
                messageId: msg._id,
                chatId: msg.chatId,
                status: 'delivered'
              });
            });
          }
        }
      } catch (err) {
        console.error('Error registering socket user:', err);
      }
    });

    // Unregister user socket, deactivate live location, and leave all role-specific rooms (on logout / role switch)
    const handleUserLogout = async (userId) => {
      try {
        const uIdStr = (typeof userId === 'object' ? (userId._id || userId.id || userId) : userId)?.toString() || socket.userId;
        if (!uIdStr) return;

        socket.leave(uIdStr);
        socket.leave(`user_${uIdStr}`);
        socket.leave(`restaurant_${uIdStr}`);
        socket.leave(`supplier_${uIdStr}`);
        socket.leave(`supplier:${uIdStr}`);
        socket.leave(`rider_${uIdStr}`);
        socket.leave('online_suppliers');
        socket.leave('suppliers_room');
        socket.leave('riders_room');
        socket.leave('customers_room');
        userSockets.delete(uIdStr);
        onlineRiders.delete(uIdStr);

        // Instantly notify Admin Live Map to remove marker in real time
        const deactPayload = { userId: uIdStr, riderId: uIdStr, isLive: false, isOnline: false };
        io.to('admin_tracking').emit('user_location_deactivated', deactPayload);
        io.to('admin_tracking').emit('rider_offline_admin', { riderId: uIdStr });
        io.to('admin_tracking').emit('rider_offline', { riderId: uIdStr });
        io.emit('user_status_change', { userId: uIdStr, isOnline: false, isAvailable: false });

        // Non-blocking DB status & location deactivation without deleting profile/history
        if (mongoose.Types.ObjectId.isValid(uIdStr)) {
          User.findByIdAndUpdate(uIdStr, {
            isOnline: false,
            isAvailable: false,
            'locationTracking.isLive': false,
            lastSeen: new Date(),
          }).catch(e => console.error('[User Logout DB Update Error]:', e.message));
        }

        console.log(`🔌 [USER LOGOUT / LOCATION DEACTIVATED] User ${uIdStr} logged out. Live marker cleared from Admin Map.`);
      } catch (err) {
        console.error('Error in handleUserLogout:', err.message);
      }
    };

    socket.on('unregister_user', handleUserLogout);
    socket.on('user_logout', handleUserLogout);
    socket.on('deactivate_live_location', handleUserLogout);

    // Join restaurant notification rooms explicitly (called by restaurant/supplier partner frontend)
    socket.on('join_restaurant_room', (data = {}) => {
      try {
        const rawTargetId = (typeof data === 'object' ? (data.supplierId || data.restaurantId || data.userId || data.id) : data)?.toString();
        const partnerId = (typeof data === 'object' ? data.partnerId : null)?.toString();

        socket.join('online_suppliers');
        socket.join('suppliers_room');

        if (rawTargetId) {
          const sId = resolveSupplierIdentity(rawTargetId);
          socket.join(sId);
          socket.join(`supplier:${sId}`);
          socket.join(`supplier_${sId}`);
          socket.join(`restaurant_${sId}`);
          socket.join(`user_${sId}`);
          console.log(`[JOIN RESTAURANT/SUPPLIER ROOM] Socket ${socket.id} joined supplier:${sId}, supplier_${sId}, restaurant_${sId}`);
        }
        if (partnerId) {
          socket.join(partnerId);
          socket.join(`supplier:${partnerId}`);
          socket.join(`supplier_${partnerId}`);
          socket.join(`restaurant_${partnerId}`);
          socket.join(`user_${partnerId}`);
          console.log(`[JOIN RESTAURANT/SUPPLIER ROOM] Socket ${socket.id} joined partner rooms for ${partnerId}`);
        }
      } catch (err) {
        console.error('[join_restaurant_room] Error:', err.message);
      }
    });

    socket.on('join_supplier_room', (data = {}) => {
      try {
        const rawTargetId = (typeof data === 'object' ? (data.supplierId || data.restaurantId || data.userId || data.id) : data)?.toString();
        if (rawTargetId) {
          const sId = resolveSupplierIdentity(rawTargetId);
          socket.join(sId);
          socket.join(`supplier:${sId}`);
          socket.join(`supplier_${sId}`);
          socket.join(`restaurant_${sId}`);
          socket.join(`user_${sId}`);
          socket.join('online_suppliers');
          socket.join('suppliers_room');
          console.log(`[JOIN SUPPLIER ROOM] Socket ${socket.id} joined supplier:${sId}`);
        }
      } catch (err) {
        console.error('[join_supplier_room] Error:', err.message);
      }
    });

    // Super-Fast Instant Socket Toggle Handler (0ms Broadcast + Async DB Persist)
    socket.on('toggle_online_status', async ({ userId, isOnline, isAvailable, role }) => {
      const targetUserId = userId || socket.userId;
      if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) return;

      const onlineState = Boolean(isOnline);
      const availState = isAvailable !== undefined ? Boolean(isAvailable) : onlineState;

      // ⚡ 1. INSTANT WEBSOCKET BROADCAST (0ms Latency across all clients!)
      io.emit('user_status_change', { userId: targetUserId, isOnline: onlineState, isAvailable: availState, role });
      io.to('admin_tracking').emit('rider_status_admin', { riderId: targetUserId, isOnline: onlineState, isAvailable: availState });
      socket.emit('status_update_success', { userId: targetUserId, isOnline: onlineState, isAvailable: availState });

      // ⚡ 2. Instant In-Memory Matching Map Update
      if (onlineState) {
        // Preserve any existing real GPS location — DO NOT overwrite with hardcoded fallback
        const existingEntry = onlineRiders.get(targetUserId.toString()) || {};
        onlineRiders.set(targetUserId.toString(), {
          ...existingEntry,
          riderId: targetUserId.toString(),
          socketId: socket.id,
          // Only set fallback if no real location exists yet
          location: existingEntry.location || null,
          locationUpdatedAt: existingEntry.locationUpdatedAt || null,
          isOnline: true,
          isAvailable: availState,
        });
        socket.join('riders_room');
        socket.join('online_suppliers');
        socket.join(`rider_${targetUserId}`);
      } else {
        onlineRiders.delete(targetUserId.toString());
        socket.leave('riders_room');
        socket.leave('online_suppliers');
        socket.leave(`rider_${targetUserId}`);
      }

      // ⚡ 3. Non-Blocking Async MongoDB Persistence distinguishing Rider vs Restaurant
      try {
        const u = await User.findById(targetUserId).select('role');
        const userRole = role || (u ? u.role : '');
        const isRider = userRole === 'delivery_partner' || userRole === 'rider' || userRole === 'provider';

        const updateFields = {
          isOnline: onlineState,
          isAvailable: availState,
          lastSeen: new Date()
        };

        if (isRider) {
          updateFields.rider_status = onlineState ? 'online' : 'offline';
          console.log(`[RIDER STATUS TOGGLE] Rider ${targetUserId} set rider_status='${updateFields.rider_status}', isOnline=${onlineState}`);
          // If rider going ONLINE, retry any SEARCHING_FOR_RIDER bookings
          if (onlineState) {
            riderSearchService.retrySearchingOrders(targetUserId.toString());
          }
        } else {
          updateFields.restaurant_status = onlineState ? 'online' : 'offline';
          console.log(`[RESTAURANT STATUS TOGGLE] Restaurant/Supplier ${targetUserId} set restaurant_status='${updateFields.restaurant_status}', isOnline=${onlineState}`);
          
          try {
            const profileController = require('../controllers/profileController');
            if (profileController && profileController.invalidateRestaurantsCache) {
              profileController.invalidateRestaurantsCache();
            }
          } catch (e) {}

          // ⚡ Instant broadcast to Customer Home Screen
          io.emit('RESTAURANT_UPDATED', {
            restaurantId: targetUserId,
            userId: targetUserId,
            isOnline: onlineState,
            restaurant_status: updateFields.restaurant_status,
          });
        }

        await User.findByIdAndUpdate(targetUserId, updateFields);
      } catch (err) {
        console.error('Error updating DB status in toggle_online_status:', err);
      }
    });

    // Instant Restaurant Name Broadcast via Socket (0ms latency across all clients + Async DB update)
    socket.on('update_restaurant_name', async (data) => {
      if (data && data.name) {
        let rId = String(data.restaurantId || data.userId || data.id || '');
        const newName = String(data.name).trim();
        if (!newName) return;

        if (!rId || !mongoose.Types.ObjectId.isValid(rId)) {
          const supp = await User.findOne({ role: 'supplier' }).lean();
          if (supp) rId = String(supp._id);
        }

        console.log(`📢 [SOCKET HANDLER] 'update_restaurant_name' received for ${rId} -> '${newName}'`);
        const payload = {
          restaurantId: rId,
          id: rId,
          userId: rId,
          name: newName,
          restaurantName: newName,
          ...data,
        };
        io.emit('RESTAURANT_NAME_UPDATED', payload);
        io.emit('restaurant_name_updated', payload);
        io.emit('RESTAURANT_UPDATED', payload);

        // Non-blocking async DB update
        if (rId && mongoose.Types.ObjectId.isValid(rId)) {
          User.findByIdAndUpdate(rId, {
            name: newName,
            restaurantName: newName,
            isCustomName: true,
          }).catch((err) => console.error('Error persisting restaurant name:', err));
        }
      }
    });

    // Permanent Restaurant / Supplier / Rider Location Update via Socket
    const handleLocationUpdate = async (data) => {
      try {
        if (!data) return;
        let targetId = String(data.restaurantId || data.riderId || data.userId || data.id || socket.userId || '');
        if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
          const supp = await User.findOne({ role: 'supplier' }).lean();
          if (supp) targetId = String(supp._id);
        }
        if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) return;

        const locObj = data.location || data.coords || data;
        const lat = Number(data.latitude || (locObj && locObj.latitude) || 0);
        const lon = Number(data.longitude || (locObj && locObj.longitude) || 0);

        let rawAddr = data.fullAddress || data.address || '';
        if (!rawAddr && typeof data.location === 'string') {
          rawAddr = data.location;
        } else if (!rawAddr && locObj && typeof locObj.address === 'string') {
          rawAddr = locObj.address;
        } else if (!rawAddr && locObj && typeof locObj.fullAddress === 'string') {
          rawAddr = locObj.fullAddress;
        } else if (!rawAddr && locObj && typeof locObj.location === 'string') {
          rawAddr = locObj.location;
        }
        let addr = String(rawAddr || '').trim();
        if (addr === '[object Object]') {
          addr = '';
        }

        const updateDoc = {};
        if (lat !== 0 && !isNaN(lat)) {
          updateDoc.latitude = lat;
        }
        if (lon !== 0 && !isNaN(lon)) {
          updateDoc.longitude = lon;
        }
        if (lat !== 0 && lon !== 0 && !isNaN(lat) && !isNaN(lon)) {
          updateDoc.locationCoords = { latitude: lat, longitude: lon };
        }
        if (addr) {
          updateDoc.address = addr;
          updateDoc.location = addr;
          updateDoc.fullAddress = addr;
        }

        if (Object.keys(updateDoc).length > 0) {
          await User.findByIdAndUpdate(targetId, updateDoc);
          console.log(`📍 [PERMANENT LOCATION SAVED] User ${targetId} location updated: Lat=${lat}, Lon=${lon}, Addr='${addr}'`);

          // Update onlineRiders in-memory map
          const existing = onlineRiders.get(targetId) || {};
          onlineRiders.set(targetId, {
            ...existing,
            riderId: targetId,
            location: {
              latitude: lat || existing.location?.latitude,
              longitude: lon || existing.location?.longitude,
              address: addr || existing.location?.address,
            },
            locationUpdatedAt: new Date(),
          });

          const broadcastPayload = {
            restaurantId: targetId,
            riderId: targetId,
            userId: targetId,
            latitude: lat,
            longitude: lon,
            location: addr,
            address: addr,
            fullAddress: addr,
          };
          io.emit('RESTAURANT_LOCATION_UPDATED', broadcastPayload);
          io.emit('restaurant_location_updated', broadcastPayload);
          io.emit('RESTAURANT_UPDATED', broadcastPayload);
          io.to('admin_tracking').emit('rider_location_admin', broadcastPayload);
        }
      } catch (err) {
        console.error('Error handling location update socket event:', err.message);
      }
    };

    socket.on('update_restaurant_location', handleLocationUpdate);
    socket.on('restaurant_location_update', handleLocationUpdate);
    socket.on('rider_location_update', handleLocationUpdate);
    socket.on('update_location', handleLocationUpdate);

    // Admin Live Supplier Tracking Channel Room Join
    socket.on('join_admin_tracking', async () => {
      try {
        socket.join('admin_tracking');
        console.log(`[Admin Tracking] Socket ${socket.id} joined admin_tracking room`);

        // 1. Collect online riders from in-memory Map
        const inMemRiders = Array.from(onlineRiders.values());
        const riderIdsSet = new Set(inMemRiders.map(r => String(r.riderId)));

        // 2. Fallback: Fetch riders from DB if not already in memory
        try {
          const dbRiders = await User.find({
            role: { $in: ['rider', 'delivery_partner', 'provider'] }
          }).select('name phoneNumber role location latitude longitude isOnline isAvailable').lean();

          for (const r of dbRiders) {
            const rId = String(r._id);
            if (!riderIdsSet.has(rId)) {
              const lat = Number(r.location?.latitude || r.latitude);
              const lon = Number(r.location?.longitude || r.longitude);
              if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
                inMemRiders.push({
                  riderId: rId,
                  name: r.name || 'Rider',
                  phone: r.phoneNumber || '',
                  role: r.role,
                  isOnline: r.isOnline !== false,
                  isAvailable: r.isAvailable !== false,
                  location: { latitude: lat, longitude: lon },
                  latitude: lat,
                  longitude: lon
                });
                riderIdsSet.add(rId);
              }
            }
          }
        } catch (dbRiderErr) {
          console.error('[Admin Tracking] Error fetching db riders:', dbRiderErr.message);
        }

        // 3. Collect active bookings from in-memory Map + MongoDB
        const inMemRides = Array.from(pendingRides.values());
        const rideIdsSet = new Set(inMemRides.map(b => String(b.rideId || b.bookingId)));

        try {
          const dbBookings = await Booking.find({
            status: { $in: ['BOOKING_REQUESTED', 'SEARCHING_RIDER', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'TRANSFER_REQUESTED', 'TRANSFER_ACCEPTED_PENDING_HANDOVER'] }
          }).sort({ createdAt: -1 }).limit(50).lean();

          for (const b of dbBookings) {
            const bId = String(b.bookingId || b._id);
            if (!rideIdsSet.has(bId)) {
              inMemRides.push({
                rideId: bId,
                bookingId: bId,
                customerId: b.customerId,
                customerName: b.customerName || 'Customer',
                customerPhone: b.customerPhone || '',
                pickupLatitude: Number(b.pickupLatitude || b.latitude || 0),
                pickupLongitude: Number(b.pickupLongitude || b.longitude || 0),
                deliveryLatitude: Number(b.deliveryLatitude || b.customerLatitude || 0),
                deliveryLongitude: Number(b.deliveryLongitude || b.customerLongitude || 0),
                pickupAddress: b.pickupAddress || b.serviceAddress || '',
                deliveryAddress: b.customerAddress || b.destinationAddress || '',
                status: b.status,
                deliveryStatus: b.deliveryStatus,
                transferStatus: b.transferStatus,
                transferReason: b.transferReason,
                categoryName: b.categoryName || 'Delivery',
                serviceName: b.serviceName || 'Order',
                providerId: b.riderId,
                acceptedBy: b.riderId ? { riderId: b.riderId, riderName: b.riderName } : null
              });
              rideIdsSet.add(bId);
            }
          }
        } catch (dbBookingsErr) {
          console.error('[Admin Tracking] Error fetching db bookings:', dbBookingsErr.message);
        }

        // Send combined initial data to admin immediately
        socket.emit('initial_admin_data', {
          onlineRiders: inMemRiders,
          pendingRides: inMemRides
        });
      } catch (err) {
        console.error('Error in join_admin_tracking:', err);
      }
    });

    // Enter a chat room
    socket.on('join_chat', (chatId) => {
      if (!chatId) return;
      socket.join(`chat_${chatId}`);
      console.log(`Socket ${socket.id} joined chat room: chat_${chatId}`);
    });

    // Leave a chat room
    socket.on('leave_chat', (chatId) => {
      if (!chatId) return;
      socket.leave(`chat_${chatId}`);
      console.log(`Socket ${socket.id} left chat room: chat_${chatId}`);
    });

    // Typing indicators
    socket.on('typing', ({ chatId, receiverId, username }) => {
      if (chatId) {
        socket.to(`chat_${chatId}`).emit('typing', { chatId, username });
      } else if (receiverId) {
        socket.to(`user_${receiverId}`).emit('typing', { chatId, username });
      }
    });

    socket.on('stop_typing', ({ chatId, receiverId }) => {
      if (chatId) {
        socket.to(`chat_${chatId}`).emit('stop_typing', { chatId });
      } else if (receiverId) {
        socket.to(`user_${receiverId}`).emit('stop_typing', { chatId });
      }
    });

    // Message delivered status
    socket.on('message_delivered', async ({ messageId, chatId, senderId }) => {
      try {
        const msg = await Message.findByIdAndUpdate(messageId, { status: 'delivered' }, { new: true });
        if (msg) {
          socket.to(`chat_${chatId}`).emit('message_status_update', { messageId, chatId, status: 'delivered' });
          io.to(`user_${senderId}`).emit('message_status_update', { messageId, chatId, status: 'delivered' });
        }
      } catch (error) {
        console.error('Error marking message delivered:', error);
      }
    });

    // Message seen status
    socket.on('message_seen', async ({ chatId, userId }) => {
      try {
        // Mark all unread messages in this chat from the other user as seen
        await Message.updateMany(
          { chatId, receiver: userId, status: { $ne: 'seen' } },
          { status: 'seen' }
        );

        // Reset unread count for this user
        const chat = await Chat.findById(chatId);
        if (chat) {
          chat.unreadCounts.set(userId.toString(), 0);
          await chat.save();
        }

        socket.to(`chat_${chatId}`).emit('messages_marked_seen', { chatId, viewerId: userId });
      } catch (error) {
        console.error('Error marking messages seen:', error);
      }
    });

    socket.on('webrtc_offer', ({ targetUserId, offer, senderId }) => {
      console.log(`[WebRTC] Offer from ${senderId} to ${targetUserId}`);
      const targetSocketId = userSockets.get(targetUserId.toString());
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc_offer', { offer, senderId });
      } else {
        console.log(`[WebRTC] Target user ${targetUserId} not connected.`);
      }
    });

    socket.on('webrtc_answer', ({ targetUserId, answer, senderId }) => {
      console.log(`[WebRTC] Answer from ${senderId} to ${targetUserId}`);
      const targetSocketId = userSockets.get(targetUserId.toString());
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc_answer', { answer, senderId });
      } else {
        console.log(`[WebRTC] Target user ${targetUserId} not connected.`);
      }
    });

    socket.on('webrtc_ice_candidate', ({ targetUserId, candidate, senderId }) => {
      console.log(`[WebRTC] ICE Candidate from ${senderId} to ${targetUserId}`);
      const targetSocketId = userSockets.get(targetUserId.toString());
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc_ice_candidate', { candidate, senderId });
      }
    });

    // ── 1-on-1 Call Signaling Events ────────────────────────────
    socket.on('call_user', async ({ userToCall, signalData, from, callerName, callerPicture, callerInfo, callType }) => {
      console.log(`[WebRTC] call_user from ${from} (${callerName}) to ${userToCall}`);
      if (!userToCall) return;

      // Prevent calling oneself
      if (from && from.toString() === userToCall.toString()) {
        console.log('[WebRTC] User tried to call self, ignoring.');
        return;
      }

      // Check if target user is ALREADY in another call
      if (activeCallUsers.has(userToCall.toString())) {
        console.log(`[WebRTC] Target user ${userToCall} is busy in another call.`);
        socket.emit('call_rejected', { reason: 'busy', message: 'User is busy on another call' });
        return;
      }

      if (from) activeCallUsers.add(from.toString());

      const targetSocketId = userSockets.get(userToCall.toString());
      if (targetSocketId) {
        // User is online — emit instant socket event. No delayed FCM push needed!
        console.log(`[WebRTC] Target user ${userToCall} is ONLINE. Emitting instant incoming_call via socket.`);
        io.to(targetSocketId).emit('incoming_call', {
          offer: signalData,
          from,
          callerName: callerName || 'User',
          callerPicture: callerPicture || null,
          callerInfo: callerInfo || { _id: from, name: callerName, profilePicture: callerPicture },
          callType: callType || 'video',
        });
      } else {
        // User is offline / app closed — send FCM Push Notification so phone rings/notifies
        console.log(`[WebRTC] Target user ${userToCall} is OFFLINE. Sending FCM push notification.`);
        try {
          const { sendPushNotification } = require('../services/firebase');
          const targetUser = await User.findById(userToCall);
          const senderUser = from ? await User.findById(from) : null;

          if (targetUser && targetUser.pushToken && targetUser.notificationsEnabled) {
            if (senderUser && senderUser.pushToken === targetUser.pushToken) {
              console.log('[WebRTC] Sender and Target share the same Push Token. Skipping FCM Push.');
            } else {
              const isVideo = callType === 'video';
              let pushTitle = `Incoming ${isVideo ? 'Video' : 'Voice'} Call`;
              let pushBody = `${callerName || 'Someone'} is calling you...`;
              await sendPushNotification(targetUser.pushToken, pushTitle, pushBody, {
                type: 'INCOMING_CALL',
                callerId: from ? from.toString() : '',
                callerName: callerName || 'User',
                callType: callType || 'video',
              });
              console.log(`[WebRTC] Incoming call FCM push notification sent to offline target user ${userToCall}`);
            }
          }
        } catch (err) {
          console.error('[WebRTC] Error sending call push notification:', err.message);
        }
      }
    });

    socket.on('answer_call', ({ to, signal }) => {
      console.log(`[WebRTC] answer_call to ${to}`);
      if (socket.userId) activeCallUsers.add(socket.userId.toString());
      if (to) activeCallUsers.add(to.toString());

      if (!to) return;
      const targetSocketId = userSockets.get(to.toString());
      if (targetSocketId) {
        io.to(targetSocketId).emit('call_accepted', { signal });
      }
    });

    socket.on('ice_candidate', ({ to, candidate }) => {
      if (!to) return;
      const targetSocketId = userSockets.get(to.toString());
      if (targetSocketId) {
        io.to(targetSocketId).emit('ice_candidate', { candidate });
      }
    });

    socket.on('end_call', ({ to }) => {
      if (socket.userId) activeCallUsers.delete(socket.userId.toString());
      if (to) activeCallUsers.delete(to.toString());
      if (!to) return;
      const targetSocketId = userSockets.get(to.toString());
      if (targetSocketId) {
        io.to(targetSocketId).emit('call_ended');
      }
    });

    socket.on('reject_call', ({ to }) => {
      if (socket.userId) activeCallUsers.delete(socket.userId.toString());
      if (to) activeCallUsers.delete(to.toString());
      if (!to) return;
      const targetSocketId = userSockets.get(to.toString());
      if (targetSocketId) {
        io.to(targetSocketId).emit('call_rejected');
      }
    });

    socket.on('log_call', async (data) => {
      console.log('[WebRTC] log_call socket event received:', data);
      if (!data) return;
      const { saveCallLogHelper } = require('../controllers/messageController');
      await saveCallLogHelper(data);
    });

    // Live Streaming Events
    socket.on('start_live', async ({ userId, userDetails }) => {
      const uIdStr = (typeof userId === 'object' ? (userId._id || userId.id || userId) : userId)?.toString();
      if (uIdStr) {
        socket.userId = uIdStr;
        socket.join(`live_${uIdStr}`);
        userSockets.set(uIdStr, socket.id);
        console.log(`[Start Live] Mapped broadcaster ${uIdStr} to socket ${socket.id}`);

        // Rebuild/load active queue from the DB
        try {
          const { priorityQueue, normalQueue } = await getLiveQueueFromDB(uIdStr);
          liveQueues.set(uIdStr, { priorityQueue, normalQueue });
          console.log(`[Start Live] Loaded queue from DB for broadcaster ${uIdStr}: ${priorityQueue.length} priority, ${normalQueue.length} normal`);
          
          socket.emit('queue_updated', { priorityQueue, normalQueue });
        } catch (err) {
          console.error('[Start Live] Error loading queue from DB:', err);
        }

        // Also check if there is an active speaker session we need to restore
        try {
          const LiveRequest = require('../models/LiveRequest');
          const activeReq = await LiveRequest.findOne({
            broadcasterId: uIdStr,
            status: 'accepted'
          }).sort({ updatedAt: -1 });

          if (activeReq) {
            const timeLeftSec = Math.round(((activeReq.updatedAt.getTime() + (activeReq.plan?.durationMinutes || 1) * 60 * 1000) - Date.now()) / 1000);
            if (timeLeftSec > 0) {
              console.log(`[Start Live] Restoring active speaker ${activeReq.viewerId} for broadcaster ${uIdStr} with ${timeLeftSec}s remaining`);
              
              // Emit status to the broadcaster
              socket.emit('active_speaker_status', {
                speakerId: activeReq.viewerId.toString(),
                speakerName: activeReq.viewerName,
                durationSeconds: timeLeftSec
              });

              // Re-set timeout
              if (activeSpeakerTimeoutMap.has(uIdStr)) {
                clearTimeout(activeSpeakerTimeoutMap.get(uIdStr));
              }

              const timeoutId = setTimeout(async () => {
                console.log(`[Restored Timer Expired] Ending speak session automatically for speaker ${activeReq.viewerId} in room ${uIdStr}`);
                io.to(`live_${uIdStr}`).emit('speaker_removed', { speakerId: activeReq.viewerId.toString() });

                activeReq.status = 'completed';
                await activeReq.save();

                activeSpeakerTimeoutMap.delete(uIdStr);
              }, timeLeftSec * 1000);

              activeSpeakerTimeoutMap.set(uIdStr, timeoutId);
            } else {
              // The session has expired while the host was away/offline
              activeReq.status = 'completed';
              await activeReq.save();
            }
          }
        } catch (err) {
          console.error('[Start Live] Error restoring active speaker:', err);
        }
      }
    });

    socket.on('join_live', async ({ broadcasterId, viewerDetails }) => {
      const bIdStr = (typeof broadcasterId === 'object' ? (broadcasterId._id || broadcasterId.id || broadcasterId) : broadcasterId)?.toString();
      if (bIdStr) {
        socket.join(`live_${bIdStr}`);
        if (socket.userId) {
          const sIdStr = (typeof socket.userId === 'object' ? (socket.userId._id || socket.userId.id || socket.userId) : socket.userId)?.toString();
          userSockets.set(sIdStr, socket.id);
        }
        let vIdStr = null;
        if (viewerDetails && viewerDetails.id) {
          vIdStr = (typeof viewerDetails.id === 'object' ? (viewerDetails.id._id || viewerDetails.id.id || viewerDetails.id) : viewerDetails.id)?.toString();
          userSockets.set(vIdStr, socket.id);
          console.log(`[Join Live] Mapped viewer ${vIdStr} to socket ${socket.id}`);
        }

        const room = io.sockets.adapter.rooms.get(`live_${bIdStr}`);
        const count = room ? room.size - 1 : 0; // Exclude broadcaster
        io.to(`live_${bIdStr}`).emit('viewer_joined', { viewersCount: count > 0 ? count : 0 });

        // Trigger instant WebRTC SDP offer creation on broadcaster
        if (vIdStr) {
          const broadcasterSocketId = userSockets.get(bIdStr);
          console.log(`[Join Live] Broadcasting viewer_joined_webrtc to room live_${bIdStr} & broadcasterSocket ${broadcasterSocketId} for viewer ${vIdStr}`);
          if (broadcasterSocketId) {
            io.to(broadcasterSocketId).emit('viewer_joined_webrtc', { viewerId: vIdStr });
          }
          io.to(`live_${bIdStr}`).emit('viewer_joined_webrtc', { viewerId: vIdStr });
        }

        // Notify this joining viewer if they already have an active/pending request
        if (vIdStr) {
          try {
            const LiveRequest = require('../models/LiveRequest');
            const reqRecord = await LiveRequest.findOne({
              broadcasterId: bIdStr,
              viewerId: vIdStr,
              status: { $in: ['pending_payment', 'pending_acceptance', 'accepted'] }
            }).sort({ updatedAt: -1 });

            if (reqRecord) {
              if (reqRecord.status === 'pending_acceptance') {
                socket.emit('user_queue_status', {
                  status: reqRecord.isPriority ? 'Priority Queue Active' : 'Normal Queue Active',
                  isPriority: reqRecord.isPriority,
                  liveRequestId: reqRecord._id.toString(),
                  plan: reqRecord.plan
                });
              } else if (reqRecord.status === 'accepted') {
                const timeLeftSec = Math.round(((reqRecord.updatedAt.getTime() + (reqRecord.plan?.durationMinutes || 1) * 60 * 1000) - Date.now()) / 1000);
                if (timeLeftSec > 0) {
                  socket.emit('speak_request_accepted', { broadcasterId: bIdStr, durationSeconds: timeLeftSec });
                }
              }
            }
          } catch (err) {
            console.error('[Join Live] Error checking user queue status:', err);
          }
        }
      }
    });

    socket.on('request_webrtc_stream', ({ broadcasterId, viewerId }) => {
      const bIdStr = (typeof broadcasterId === 'object' ? (broadcasterId._id || broadcasterId.id || broadcasterId) : broadcasterId)?.toString();
      const vIdStr = (typeof viewerId === 'object' ? (viewerId._id || viewerId.id || viewerId) : viewerId)?.toString();
      console.log(`[Instant WebRTC Request] Viewer ${vIdStr} -> Broadcaster ${bIdStr}`);
      if (!bIdStr || !vIdStr) return;
      const broadcasterSocketId = userSockets.get(bIdStr);
      if (broadcasterSocketId) {
        io.to(broadcasterSocketId).emit('viewer_joined_webrtc', { viewerId: vIdStr });
      }
      io.to(`live_${bIdStr}`).emit('viewer_joined_webrtc', { viewerId: vIdStr });
    });

    socket.on('leave_live', ({ broadcasterId }) => {
      const bIdStr = (typeof broadcasterId === 'object' ? (broadcasterId._id || broadcasterId.id || broadcasterId) : broadcasterId)?.toString();
      if (bIdStr) {
        socket.leave(`live_${bIdStr}`);
        const room = io.sockets.adapter.rooms.get(`live_${bIdStr}`);
        const count = room ? room.size - 1 : 0;
        io.to(`live_${bIdStr}`).emit('viewer_left', { viewersCount: count > 0 ? count : 0 });
      }
    });

    socket.on('end_live', async ({ userId }) => {
      const uIdStr = (typeof userId === 'object' ? (userId._id || userId.id || userId) : userId)?.toString();
      if (uIdStr) {
        console.log(`[End Live] Host ${uIdStr} ended live. Emitting stream_ended to room live_${uIdStr}`);
        io.to(`live_${uIdStr}`).emit('stream_ended', { broadcasterId: uIdStr, message: 'Host has ended the live stream' });
        
        // Clear active speaker timeout and queues
        if (activeSpeakerTimeoutMap.has(uIdStr)) {
          clearTimeout(activeSpeakerTimeoutMap.get(uIdStr));
          activeSpeakerTimeoutMap.delete(uIdStr);
        }
        liveQueues.delete(uIdStr);

        // Update LiveStream DB status to ended
        const LiveStream = require('../models/LiveStream');
        try {
          await LiveStream.updateMany({ hostId: uIdStr, status: 'live' }, { status: 'ended', endedAt: new Date() });
          console.log(`[End Live] Updated DB LiveStream status to ended for host ${uIdStr}`);
        } catch (err) {
          console.error('[End Live] Error updating LiveStream status:', err);
        }

        socket.leave(`live_${uIdStr}`);
      }
    });

    // ── Voice Live Queue & Speaking Request Handlers ──
    socket.on('voice_speak_request', async ({ broadcasterId, viewerId, viewerName, viewerAvatar, plan, isPriority }) => {
      const bIdStr = (typeof broadcasterId === 'object' ? (broadcasterId._id || broadcasterId.id || broadcasterId) : broadcasterId)?.toString();
      const vIdStr = (typeof viewerId === 'object' ? (viewerId._id || viewerId.id || viewerId) : viewerId)?.toString();
      if (!bIdStr || !vIdStr) return;

      if (!liveQueues.has(bIdStr)) {
        try {
          const { priorityQueue, normalQueue } = await getLiveQueueFromDB(bIdStr);
          liveQueues.set(bIdStr, { priorityQueue, normalQueue });
        } catch (e) {
          liveQueues.set(bIdStr, { priorityQueue: [], normalQueue: [] });
        }
      }
      const queueObj = liveQueues.get(bIdStr);

      if (!isPriority) {
        const LiveRequest = require('../models/LiveRequest');
        try {
          const existingRequest = await LiveRequest.findOne({
            broadcasterId: bIdStr,
            viewerId: vIdStr,
            status: { $in: ['pending_payment', 'pending_acceptance'] }
          });

          if (existingRequest && existingRequest.status === 'pending_acceptance') {
            return; // Already in queue
          }

          // Create a new normal speak request
          const liveRequest = await LiveRequest.create({
            broadcasterId: bIdStr,
            viewerId: vIdStr,
            viewerName: viewerName || 'User',
            viewerAvatar: viewerAvatar || '',
            isPriority: false,
            plan: { price: 0, durationMinutes: 1 }, // Free is 1 minute
            status: 'pending_acceptance',
          });

          const requestItem = {
            viewerId: vIdStr,
            viewerName: liveRequest.viewerName,
            viewerAvatar: liveRequest.viewerAvatar,
            plan: liveRequest.plan,
            isPriority: false,
            liveRequestId: liveRequest._id.toString(),
            createdAt: liveRequest.createdAt,
          };

          // Filter duplicates and push to normal queue
          queueObj.normalQueue = queueObj.normalQueue.filter(i => i.viewerId !== vIdStr);
          queueObj.normalQueue.push(requestItem);

          // Notify Host of updated queues
          const hostSocketId = userSockets.get(bIdStr);
          if (hostSocketId) {
            io.to(hostSocketId).emit('queue_updated', {
              priorityQueue: queueObj.priorityQueue,
              normalQueue: queueObj.normalQueue,
            });
          }
        } catch (err) {
          console.error('[Socket] Error creating normal speak request:', err);
        }
      }
    });

    socket.on('accept_speak_request', async ({ broadcasterId, viewerId, plan, liveRequestId }) => {
      const bIdStr = (typeof broadcasterId === 'object' ? (broadcasterId._id || broadcasterId.id || broadcasterId) : broadcasterId)?.toString();
      const vIdStr = (typeof viewerId === 'object' ? (viewerId._id || viewerId.id || viewerId) : viewerId)?.toString();
      if (!bIdStr || !vIdStr) return;

      const LiveRequest = require('../models/LiveRequest');
      const User = require('../models/User');
      const Transaction = require('../models/Transaction');

      let durationMinutes = 1;
      let isPriority = false;
      let price = 0;

      try {
        let requestRecord = null;
        if (liveRequestId) {
          requestRecord = await LiveRequest.findById(liveRequestId);
        } else {
          requestRecord = await LiveRequest.findOne({
            broadcasterId: bIdStr,
            viewerId: vIdStr,
            status: 'pending_acceptance'
          }).sort({ createdAt: -1 });
        }

        if (requestRecord && requestRecord.status === 'pending_acceptance') {
          requestRecord.status = 'accepted';
          await requestRecord.save();

          durationMinutes = requestRecord.plan?.durationMinutes || 1;
          isPriority = requestRecord.isPriority;
          price = requestRecord.plan?.price || 0;

          // Credit paid amount to host My Earnings in real time if it's a paid request!
          if (isPriority && price > 0) {
            const host = await User.findById(bIdStr);
            if (host) {
              host.totalEarnings = (host.totalEarnings || 0) + price;
              host.availableBalance = (host.availableBalance || 0) + price;
              if (!host.earningsBreakdown) {
                host.earningsBreakdown = { voiceCalls: 0, videoCalls: 0, liveTokens: 0, lockedMedia: 0 };
              }
              host.earningsBreakdown.voiceCalls = (host.earningsBreakdown.voiceCalls || 0) + price;
              await host.save();

              // Log transaction for the host
              await Transaction.create({
                userId: bIdStr,
                type: 'voice_call',
                amount: price,
                currency: 'INR',
                description: `Earned ₹${price} from Voice Live Speaker Session (Paid Priority Request)`,
                relatedUserId: vIdStr,
                relatedLiveRequestId: requestRecord._id,
                status: 'completed',
              });

              // Emit real-time earnings update to host UI
              const hostSocketId = userSockets.get(bIdStr);
              if (hostSocketId) {
                io.to(hostSocketId).emit('earnings_updated', {
                  addedEarnings: price,
                  walletBalance: host.availableBalance,
                });
              }
            }
          }
        }
      } catch (err) {
        console.error('[Socket] Error accepting speak request:', err);
      }

      const durationSeconds = durationMinutes * 60;

      // Remove from queues in-memory
      if (liveQueues.has(bIdStr)) {
        const q = liveQueues.get(bIdStr);
        q.priorityQueue = q.priorityQueue.filter(i => i.viewerId !== vIdStr);
        q.normalQueue = q.normalQueue.filter(i => i.viewerId !== vIdStr);
        const hostSocketId = userSockets.get(bIdStr);
        if (hostSocketId) {
          io.to(hostSocketId).emit('queue_updated', { priorityQueue: q.priorityQueue, normalQueue: q.normalQueue });
        }
      }

      // Enforce server-side speak session duration limit
      if (activeSpeakerTimeoutMap.has(bIdStr)) {
        clearTimeout(activeSpeakerTimeoutMap.get(bIdStr));
        activeSpeakerTimeoutMap.delete(bIdStr);
      }

      const timeoutId = setTimeout(async () => {
        console.log(`[Timer Expired] Ending speak session automatically for speaker ${vIdStr} in room ${bIdStr}`);
        io.to(`live_${bIdStr}`).emit('speaker_removed', { speakerId: vIdStr });

        try {
          const activeReq = await LiveRequest.findOne({
            broadcasterId: bIdStr,
            viewerId: vIdStr,
            status: 'accepted'
          }).sort({ updatedAt: -1 });

          if (activeReq) {
            activeReq.status = 'completed';
            await activeReq.save();
          }
        } catch (e) {
          console.error('[Socket Timeout] Error completing LiveRequest:', e);
        }

        activeSpeakerTimeoutMap.delete(bIdStr);
      }, durationSeconds * 1000);

      activeSpeakerTimeoutMap.set(bIdStr, timeoutId);

      // Notify viewer & room that speaker session started
      const viewerSocketId = userSockets.get(vIdStr);
      if (viewerSocketId) {
        io.to(viewerSocketId).emit('speak_request_accepted', { broadcasterId: bIdStr, durationSeconds });
      }
      io.to(`live_${bIdStr}`).emit('speaker_session_started', { speakerId: vIdStr, durationSeconds });
    });

    socket.on('reject_speak_request', async ({ broadcasterId, viewerId, liveRequestId }) => {
      const bIdStr = (typeof broadcasterId === 'object' ? (broadcasterId._id || broadcasterId.id || broadcasterId) : broadcasterId)?.toString();
      const vIdStr = (typeof viewerId === 'object' ? (viewerId._id || viewerId.id || viewerId) : viewerId)?.toString();
      if (!bIdStr || !vIdStr) return;

      const LiveRequest = require('../models/LiveRequest');
      try {
        let requestRecord = null;
        if (liveRequestId) {
          requestRecord = await LiveRequest.findById(liveRequestId);
        } else {
          requestRecord = await LiveRequest.findOne({
            broadcasterId: bIdStr,
            viewerId: vIdStr,
            status: 'pending_acceptance'
          }).sort({ createdAt: -1 });
        }

        if (requestRecord && requestRecord.status === 'pending_acceptance') {
          requestRecord.status = 'rejected';
          await requestRecord.save();
        }
      } catch (err) {
        console.error('[Socket] Error rejecting speak request:', err);
      }

      // Remove from queues in-memory
      if (liveQueues.has(bIdStr)) {
        const q = liveQueues.get(bIdStr);
        q.priorityQueue = q.priorityQueue.filter(i => i.viewerId !== vIdStr);
        q.normalQueue = q.normalQueue.filter(i => i.viewerId !== vIdStr);
        const hostSocketId = userSockets.get(bIdStr);
        if (hostSocketId) {
          io.to(hostSocketId).emit('queue_updated', { priorityQueue: q.priorityQueue, normalQueue: q.normalQueue });
        }
      }

      const viewerSocketId = userSockets.get(vIdStr);
      if (viewerSocketId) {
        io.to(viewerSocketId).emit('speak_request_rejected', { broadcasterId: bIdStr });
      }
    });

    socket.on('remove_speaker', async ({ broadcasterId, speakerId }) => {
      const bIdStr = (typeof broadcasterId === 'object' ? (broadcasterId._id || broadcasterId.id || broadcasterId) : broadcasterId)?.toString();
      const sIdStr = (typeof speakerId === 'object' ? (speakerId._id || speakerId.id || speakerId) : speakerId)?.toString();
      if (!bIdStr || !sIdStr) return;

      // Clear the timeout if it exists
      if (activeSpeakerTimeoutMap.has(bIdStr)) {
        clearTimeout(activeSpeakerTimeoutMap.get(bIdStr));
        activeSpeakerTimeoutMap.delete(bIdStr);
      }

      const LiveRequest = require('../models/LiveRequest');
      try {
        const activeReq = await LiveRequest.findOne({
          broadcasterId: bIdStr,
          viewerId: sIdStr,
          status: 'accepted'
        }).sort({ updatedAt: -1 });

        if (activeReq) {
          activeReq.status = 'completed';
          await activeReq.save();
        }
      } catch (e) {
        console.error('[Socket Remove] Error completing LiveRequest:', e);
      }

      io.to(`live_${bIdStr}`).emit('speaker_removed', { speakerId: sIdStr });
    });

    socket.on('mute_speaker', ({ broadcasterId, speakerId, isMuted }) => {
      const bIdStr = (typeof broadcasterId === 'object' ? (broadcasterId._id || broadcasterId.id || broadcasterId) : broadcasterId)?.toString();
      const sIdStr = (typeof speakerId === 'object' ? (speakerId._id || speakerId.id || speakerId) : speakerId)?.toString();
      io.to(`live_${bIdStr}`).emit('speaker_muted_status', { speakerId: sIdStr, isMuted });
    });

    socket.on('send_live_token', async ({ broadcasterId, senderId, senderName, tokenAmount, giftName, giftEmoji }) => {
      const bIdStr = (typeof broadcasterId === 'object' ? (broadcasterId._id || broadcasterId.id || broadcasterId) : broadcasterId)?.toString();
      const sIdStr = (typeof senderId === 'object' ? (senderId._id || senderId.id || senderId) : senderId)?.toString();
      const amount = Number(tokenAmount) || 10;

      const User = require('../models/User');
      const Transaction = require('../models/Transaction');

      try {
        const sender = await User.findById(sIdStr);
        if (sender && sender.walletBalance >= amount) {
          sender.walletBalance -= amount;
          await sender.save();

          const host = await User.findById(bIdStr);
          if (host) {
            host.totalEarnings = (host.totalEarnings || 0) + amount;
            host.availableBalance = (host.availableBalance || 0) + amount;
            if (!host.earningsBreakdown) {
              host.earningsBreakdown = { voiceCalls: 0, videoCalls: 0, liveTokens: 0, lockedMedia: 0 };
            }
            host.earningsBreakdown.liveTokens = (host.earningsBreakdown.liveTokens || 0) + amount;
            await host.save();
          }

          await Transaction.create({
            userId: bIdStr,
            type: 'live_token',
            amount: amount,
            currency: 'INR',
            description: `${senderName || 'Someone'} sent ${giftEmoji || '🎁'} ${giftName || 'Token Gift'} (${amount} tokens)`,
            relatedUserId: sIdStr,
          });

          io.to(`live_${bIdStr}`).emit('live_token_received', {
            senderId: sIdStr,
            senderName: senderName || 'User',
            amount,
            giftName: giftName || 'Token Gift',
            giftEmoji: giftEmoji || '🎁',
          });
        }
      } catch (e) { console.error('Error handling live token send:', e); }
    });

    // ── Live Stream WebRTC Signaling Relay ──
    socket.on('webrtc_offer', ({ targetUserId, offer, senderId }) => {
      const tIdStr = (typeof targetUserId === 'object' ? (targetUserId._id || targetUserId.id || targetUserId) : targetUserId)?.toString();
      const sIdStr = (typeof senderId === 'object' ? (senderId._id || senderId.id || senderId) : senderId)?.toString();
      console.log(`[Live WebRTC] Offer from ${sIdStr} to target ${tIdStr}`);
      if (!tIdStr) return;
      const targetSocketId = userSockets.get(tIdStr);
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc_offer', { offer, senderId: sIdStr });
      } else {
        console.warn(`[Live WebRTC] Target socket not found for targetUserId: ${tIdStr}`);
      }
    });

    socket.on('webrtc_answer', ({ targetUserId, answer, senderId }) => {
      const tIdStr = (typeof targetUserId === 'object' ? (targetUserId._id || targetUserId.id || targetUserId) : targetUserId)?.toString();
      const sIdStr = (typeof senderId === 'object' ? (senderId._id || senderId.id || senderId) : senderId)?.toString();
      console.log(`[Live WebRTC] Answer from ${sIdStr} to target ${tIdStr}`);
      if (!tIdStr) return;
      const targetSocketId = userSockets.get(tIdStr);
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc_answer', { answer, senderId: sIdStr });
      }
    });

    socket.on('webrtc_ice_candidate', ({ targetUserId, candidate, senderId }) => {
      const tIdStr = (typeof targetUserId === 'object' ? (targetUserId._id || targetUserId.id || targetUserId) : targetUserId)?.toString();
      const sIdStr = (typeof senderId === 'object' ? (senderId._id || senderId.id || senderId) : senderId)?.toString();
      if (!tIdStr) return;
      const targetSocketId = userSockets.get(tIdStr);
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc_ice_candidate', { candidate, senderId: sIdStr });
      }
    });

    socket.on('live_chat_message', ({ broadcasterId, message }) => {
      if (broadcasterId) {
        // Emit to everyone ELSE in the room (prevent sender duplicates)
        socket.broadcast.to(`live_${broadcasterId}`).emit('live_chat_message', message);
      }
    });

    socket.on('live_heart', ({ broadcasterId }) => {
      if (broadcasterId) {
        // Broadcast to everyone ELSE in the room (viewer already updates locally)
        socket.broadcast.to(`live_${broadcasterId}`).emit('live_heart');
      }
    });

    // Live Stream Gift Event
    socket.on('send_live_gift', async ({ broadcasterId, senderId, senderName, giftId, giftName, giftEmoji, giftPrice }) => {
      try {
        if (!broadcasterId) return;
        if (senderId && giftPrice > 0) {
          const sender = await User.findById(senderId);
          if (sender && sender.walletBalance >= giftPrice) {
            sender.walletBalance -= giftPrice;
            await sender.save();

            const broadcaster = await User.findById(broadcasterId);
            if (broadcaster) {
              broadcaster.walletBalance = (broadcaster.walletBalance || 0) + giftPrice;
              await broadcaster.save();

              const broadcasterSocketId = userSockets.get(broadcasterId.toString());
              if (broadcasterSocketId) {
                io.to(broadcasterSocketId).emit('earnings_updated', { walletBalance: broadcaster.walletBalance });
              }
            }

            const senderSocketId = userSockets.get(senderId.toString());
            if (senderSocketId) {
              io.to(senderSocketId).emit('wallet_updated', { walletBalance: sender.walletBalance });
            }
          }
        }

        const giftPayload = {
          senderName: senderName || 'User',
          giftId,
          giftName,
          giftEmoji,
          giftPrice,
          timestamp: Date.now()
        };

        // Broadcast to everyone in the live room (broadcaster + all viewers)
        io.to(`live_${broadcasterId}`).emit('live_gift_received', giftPayload);
      } catch (err) {
        console.error('Error handling live gift:', err);
      }
    });

    // Live Voice Co-Host Request Events
    socket.on('live_voice_request', ({ broadcasterId, viewerId, viewerName, viewerAvatar }) => {
      const resolveId = (id) => {
        if (!id) return '';
        if (typeof id === 'object') return (id._id || id.id || id).toString();
        return id.toString();
      };
      const bId = resolveId(broadcasterId);
      const vId = resolveId(viewerId);
      console.log(`[Live Voice Request] From viewer ${vId} (${viewerName}) to broadcaster ${bId}`);
      if (!bId) return;

      const reqPayload = {
        viewerId: vId,
        viewerName: viewerName || 'Viewer',
        viewerAvatar,
        isVoice: true
      };

      const broadcasterSocketId = userSockets.get(bId);
      if (broadcasterSocketId) {
        io.to(broadcasterSocketId).emit('live_voice_request_received', reqPayload);
        io.to(broadcasterSocketId).emit('live_video_request_received', reqPayload);
      }
      io.to(`live_${bId}`).emit('live_voice_request_received', reqPayload);
      io.to(`live_${bId}`).emit('live_video_request_received', reqPayload);
    });

    socket.on('live_voice_request_accepted', ({ viewerId, broadcasterId, viewerName }) => {
      const resolveId = (id) => {
        if (!id) return '';
        if (typeof id === 'object') return (id._id || id.id || id).toString();
        return id.toString();
      };
      const bId = resolveId(broadcasterId);
      const vId = resolveId(viewerId);
      if (!vId) return;
      console.log(`[Live Voice] Broadcaster ${bId} accepted voice request from viewer ${vId}`);
      const viewerSocketId = userSockets.get(vId);
      if (viewerSocketId) {
        io.to(viewerSocketId).emit('live_voice_request_accepted', { broadcasterId: bId });
      }
      io.to(`live_${bId}`).emit('cohost_status_change', { cohostId: vId, isCoHosting: true, cohostName: viewerName || 'Co-Host', isVoiceOnly: true });
      io.to(`live_${bId}`).emit('cohost_started', { cohostId: vId, cohostName: viewerName || 'Co-Host', broadcasterId: bId, isVoiceOnly: true });
    });

    socket.on('live_voice_request_rejected', ({ viewerId, broadcasterId }) => {
      const resolveId = (id) => {
        if (!id) return '';
        if (typeof id === 'object') return (id._id || id.id || id).toString();
        return id.toString();
      };
      const bId = resolveId(broadcasterId);
      const vId = resolveId(viewerId);
      if (!vId) return;
      const viewerSocketId = userSockets.get(vId);
      if (viewerSocketId) {
        io.to(viewerSocketId).emit('live_voice_request_rejected', { broadcasterId: bId, message: 'Streamer rejected voice request' });
      }
    });

    // Live Video Co-Host Request Events
    socket.on('live_video_request', ({ broadcasterId, viewerId, viewerName, viewerAvatar }) => {
      if (!broadcasterId) return;
      const broadcasterSocketId = userSockets.get(broadcasterId.toString());
      if (broadcasterSocketId) {
        io.to(broadcasterSocketId).emit('live_video_request_received', {
          viewerId,
          viewerName: viewerName || 'Viewer',
          viewerAvatar
        });
      }
    });

    socket.on('live_video_request_accepted', ({ viewerId, broadcasterId, viewerName }) => {
      if (!viewerId) return;
      console.log(`[Live CoHost] Broadcaster ${broadcasterId} accepted cohost request from viewer ${viewerId}`);
      const viewerSocketId = userSockets.get(viewerId.toString());
      if (viewerSocketId) {
        io.to(viewerSocketId).emit('live_video_request_accepted', { broadcasterId });
      }
      io.to(`live_${broadcasterId}`).emit('cohost_status_change', { cohostId: viewerId, isCoHosting: true, cohostName: viewerName || 'Co-Host' });
      io.to(`live_${broadcasterId}`).emit('cohost_started', { cohostId: viewerId, cohostName: viewerName || 'Co-Host', broadcasterId });
    });

    socket.on('live_video_request_rejected', ({ viewerId, broadcasterId }) => {
      if (!viewerId) return;
      const viewerSocketId = userSockets.get(viewerId.toString());
      if (viewerSocketId) {
        io.to(viewerSocketId).emit('live_video_request_rejected', { broadcasterId, message: 'Streamer rejected video request' });
      }
    });

    socket.on('stop_cohost', ({ broadcasterId, viewerId }) => {
      io.to(`live_${broadcasterId}`).emit('cohost_status_change', { cohostId: viewerId, isCoHosting: false });
    });

    socket.on('rider_online', async (data) => {
      const riderId = data?.riderId || socket.userId || 'rider_1';
      const riderInfo = {
        riderId,
        socketId: socket.id,
        name: data?.name || 'Supplier Partner',
        phone: data?.phone || '+91 9876543210',
        location: (data?.latitude && data?.longitude)
          ? {
              latitude: Number(data.latitude),
              longitude: Number(data.longitude),
              address: data?.address || data?.location?.address || 'Current Location',
              timestamp: Date.now()
            }
          : (data?.location?.latitude && data?.location?.longitude)
          ? {
              latitude: Number(data.location.latitude),
              longitude: Number(data.location.longitude),
              address: data?.location?.address || 'Current Location',
              timestamp: Date.now()
            }
          : null,
        categories: data?.categories || [],
        isOnline: true,
        isAvailable: true,
        onlineAt: new Date(),
      };
      onlineRiders.set(riderId, riderInfo);
      socket.join('riders_room');
      socket.join('online_suppliers');
      socket.join(`rider_${riderId}`);

      console.log(`[RIDER_STATUS]\nriderId: ${riderId}\nisOnline: true\nisAvailable: true\nsocketId: ${socket.id}`);

      try {
        if (mongoose.Types.ObjectId.isValid(riderId)) {
          await User.findByIdAndUpdate(riderId, { isOnline: true, isAvailable: true, rider_status: 'online' });
        }
      } catch (err) {
        console.error('Error updating rider online status in DB:', err);
      }

      socket.emit('rider_status_updated', { isOnline: true, isAvailable: true });
      io.to('admin_tracking').emit('rider_online_admin', riderInfo);
    });

    socket.on('rider_offline', async (data) => {
      const riderId = data?.riderId || socket.userId || 'rider_1';
      onlineRiders.delete(riderId);
      socket.leave('riders_room');
      socket.leave('online_suppliers');

      console.log(`[RIDER_STATUS]\nriderId: ${riderId}\nisOnline: false\nisAvailable: false`);

      try {
        if (mongoose.Types.ObjectId.isValid(riderId)) {
          await User.findByIdAndUpdate(riderId, { isOnline: false, isAvailable: false, rider_status: 'offline' });
        }
      } catch (err) {
        console.error('Error updating rider offline status in DB:', err);
      }

      socket.emit('rider_status_updated', { isOnline: false, isAvailable: false });
      io.to('admin_tracking').emit('rider_offline_admin', { riderId, isOnline: false, isAvailable: false });
    });

    // Dedicated Booking Room Join / Leave
    socket.on('join_booking_room', ({ bookingId }) => {
      if (bookingId) {
        socket.join(`booking_${bookingId}`);
        console.log(`📡 [SOCKET] Socket ${socket.id} joined room: booking_${bookingId}`);
      }
    });
    socket.on('leave_booking_room', ({ bookingId }) => {
      if (bookingId) {
        socket.leave(`booking_${bookingId}`);
        console.log(`📡 [SOCKET] Socket ${socket.id} left room: booking_${bookingId}`);
      }
    });

    // Private Live Rider GPS Location Update Relay
    socket.on('rider_location_update', (data) => {
      const { riderId, location, customerId, rideId, bookingId, heading, speed } = data || {};
      const rId = riderId || socket.userId || 'rider_1';
      const targetId = bookingId || rideId || data?.id;
      
      const lat = Number(location?.latitude || location?.lat || data?.latitude || 0);
      const lon = Number(location?.longitude || location?.lng || data?.longitude || 0);
      if (!lat || !lon || lat === 0 || lon === 0) return;
      
      const existing = onlineRiders.get(rId);
      if (existing) {
        existing.location = {
          latitude: lat,
          longitude: lon,
          address: location?.address || existing.location?.address || 'Current Location',
          timestamp: Date.now()
        };
        onlineRiders.set(rId, existing);
      } else {
        onlineRiders.set(rId, {
          riderId: rId,
          socketId: socket.id,
          name: data?.name || 'Supplier Partner',
          phone: data?.phone || '+91 9876543210',
          location: { latitude: lat, longitude: lon, address: location?.address || 'Current Location', timestamp: Date.now() },
          categories: [],
          isOnline: true,
          onlineAt: new Date()
        });
      }

      // Persist real device location to MongoDB User model
      if (mongoose.Types.ObjectId.isValid(rId)) {
        User.findByIdAndUpdate(rId, {
          latitude: lat,
          longitude: lon,
          ...(location?.address ? { location: location.address, address: location.address } : {})
        }).catch((err) => console.log('[DB GPS SYNC NOTICE]', err.message));
      }

      // If active booking, update in pendingRides and emit to customer
      if (targetId) {
        if (pendingRides.has(targetId)) {
          const ride = pendingRides.get(targetId);
          if (!ride.acceptedBy) ride.acceptedBy = {};
          ride.acceptedBy.riderLocation = { latitude: lat, longitude: lon };
          ride.driverLat = lat;
          ride.driverLon = lon;
          pendingRides.set(targetId, ride);

          if (ride.customerId) {
            io.to(`user_${ride.customerId}`).emit('rider_location_updated', {
              bookingId: targetId,
              rideId: targetId,
              riderId: rId,
              latitude: lat,
              longitude: lon,
              heading: heading || 0,
              speed: speed || 0,
              location: { latitude: lat, longitude: lon },
              timestamp: Date.now(),
            });
          }
        }

        // Broadcast to dedicated booking room
        io.to(`booking_${targetId}`).emit('rider_location_updated', {
          bookingId: targetId,
          rideId: targetId,
          riderId: rId,
          latitude: lat,
          longitude: lon,
          heading: heading || 0,
          speed: speed || 0,
          location: { latitude: lat, longitude: lon },
          timestamp: Date.now(),
        });

        // Dual compatibility for legacy listener
        io.emit(`provider_location_${targetId}`, {
          providerId: rId,
          latitude: lat,
          longitude: lon,
          speed: speed || 0,
          timestamp: Date.now(),
          bookingId: targetId,
          rideId: targetId,
        });
      }

      if (customerId) {
        io.to(`user_${customerId}`).emit('rider_location_updated', {
          bookingId: targetId,
          rideId: targetId,
          riderId: rId,
          latitude: lat,
          longitude: lon,
          heading: heading || 0,
          speed: speed || 0,
          location: { latitude: lat, longitude: lon },
          timestamp: Date.now(),
        });
      }

      io.to('admin_tracking').emit('rider_location_update_admin', {
        riderId: rId,
        latitude: lat,
        longitude: lon,
        timestamp: Date.now(),
        rideId: targetId,
      });
    });

    // Handle fetching nearby riders for the customer app map
    socket.on('get_nearby_riders', (data) => {
      const { latitude, longitude, radiusKm = 10 } = data;
      if (!latitude || !longitude) return;

      let nearbyRiders = [];
      onlineRiders.forEach((riderInfo) => {
        if (!riderInfo.isOnline) return;

        const riderLat = Number(riderInfo.location?.latitude || 0);
        const riderLon = Number(riderInfo.location?.longitude || 0);
        if (!riderLat || !riderLon) return;

        const distKm = getDistanceFromLatLonInKm(latitude, longitude, riderLat, riderLon);
        if (distKm <= radiusKm) {
          nearbyRiders.push({
            riderId: riderInfo.riderId,
            latitude: riderLat,
            longitude: riderLon,
            distanceKm: Number(distKm.toFixed(2))
          });
        }
      });

      socket.emit('nearby_riders_update', nearbyRiders);
    });

    // New Food Order Socket Listener (Direct Restaurant Dispatch + DB Save)
    socket.on('new_food_order', async (foodData) => {
      if (!foodData) return;
      const bId = foodData.bookingId || foodData.rideId || `food_${Date.now()}`;
      console.log(`🍔 [SOCKET new_food_order Received]: ${bId}`);
      foodData.bookingId = bId;
      foodData.rideId = bId;

      const User = require('../models/User');
      const Booking = require('../models/Booking');

      // Check if customer already has an active running order
      if (foodData.customerId) {
        try {
          const activeFoodStatuses = [
            'PENDING_RESTAURANT',
            'RESTAURANT_ACCEPTED',
            'PREPARING',
            'FOOD_READY',
            'OUT_FOR_DELIVERY',
            'ACCEPTED',
            'STARTED',
            'PICKED_UP',
            'ON_THE_WAY',
          ];
          const existing = await Booking.findOne({
            customerId: foodData.customerId,
            bookingId: { $ne: bId },
            status: { $in: activeFoodStatuses },
          }).lean();

          if (existing) {
            const createdMs = new Date(existing.createdAt).getTime();
            if (existing.status === 'PENDING_RESTAURANT' && (Date.now() - createdMs > 65000)) {
              console.log(`⏱️ [SOCKET EXPIRED PENDING ORDER] Order ${existing.bookingId} timed out after 65s. Auto-marking as TIMEOUT.`);
              await Booking.updateOne(
                { _id: existing._id },
                { status: 'TIMEOUT', cancellationReason: 'Auto-timed out after 60s without restaurant response' }
              );
              pendingRides.delete(existing.bookingId);
            } else {
              console.log(`⚠️ [BLOCKED new_food_order socket] Customer ${foodData.customerId} already has active order ${existing.bookingId}`);
              socket.emit('active_order_exists', {
                message: `You already have an active food order (#${existing.bookingId}) in progress.`,
                activeBooking: existing,
              });
              return;
            }
          }
        } catch (checkErr) {}
      }

      let targetRestoId = (foodData.restaurantId || foodData.providerId || foodData.partnerId)?.toString();
      let restoName = foodData.restaurantName || '';

      // If restaurantId is missing, resolve to registered online supplier
      if (!targetRestoId) {
        try {
          const supp = (await User.findOne({ role: 'supplier', isOnline: true }).lean()) || (await User.findOne({ role: 'supplier' }).lean());
          if (supp) {
            targetRestoId = supp._id.toString();
            restoName = restoName || supp.name || supp.restaurantName || 'Restaurant Partner';
            console.log(`🍔 [new_food_order] Fallback resolved targetRestoId: ${targetRestoId} (${restoName})`);
          }
        } catch (e) {}
      }

      foodData.restaurantId = targetRestoId;
      foodData.partnerId = targetRestoId;
      foodData.providerId = targetRestoId;
      foodData.restaurantName = restoName;
      foodData.status = foodData.status || 'PENDING_RESTAURANT';

      pendingRides.set(bId, {
        ...foodData,
        status: foodData.status,
        requestedAt: new Date(),
      });
      io.to('admin_tracking').emit('ride_update_admin', pendingRides.get(bId));

      // Immediate acknowledgement to customer
      if (foodData.customerId) {
        io.to(`customer_${foodData.customerId}`).emit('restaurant_ringing', foodData);
        io.to(`user_${foodData.customerId}`).emit('restaurant_ringing', foodData);
      }
      io.to(`booking_${bId}`).emit('restaurant_ringing', foodData);
      io.to(`order_${bId}`).emit('restaurant_ringing', foodData);

      // Schedule 20-second delayed dispatch to Supplier Partner
      scheduleSupplierOrderDispatch(foodData, 20000);

      // 3. Asynchronously persist/upsert in MongoDB Booking in background without blocking
      Booking.findOneAndUpdate(
        { bookingId: bId },
        {
          bookingId: bId,
          customerId: foodData.customerId || 'customer_device_1',
          customerName: foodData.customerName || 'Customer',
          customerPhone: foodData.customerPhone || '9999999999',
          serviceName: 'Food Delivery',
          categoryName: 'Food Delivery',
          price: Number(foodData.price || 0),
          serviceAddress: foodData.serviceAddress || foodData.destinationAddress || 'Customer Address',
          pickupAddress: foodData.pickupAddress || 'Restaurant Address',
          destinationAddress: foodData.destinationAddress || foodData.serviceAddress || 'Customer Address',
          latitude: Number(foodData.latitude || 0) || null,
          longitude: Number(foodData.longitude || 0) || null,
          pickupLatitude: Number(foodData.pickupLatitude || foodData.latitude || 0) || null,
          pickupLongitude: Number(foodData.pickupLongitude || foodData.longitude || 0) || null,
          destinationLatitude: Number(foodData.destinationLatitude || foodData.latitude || 0) || null,
          destinationLongitude: Number(foodData.destinationLongitude || foodData.longitude || 0) || null,
          distanceKm: Number(foodData.distanceKm || 0),
          deliveryFee: Number(foodData.deliveryFee || 0),
          subtotal: Number(foodData.subtotal || 0),
          cartItems: foodData.cartItems || {},
          paymentMethod: foodData.paymentMethod || 'cash',
          paymentStatus: foodData.paymentStatus || 'PENDING',
          restaurantId: targetRestoId,
          partnerId: targetRestoId,
          providerId: targetRestoId,
          restaurantName: restoName,
          status: foodData.status,
        },
        { upsert: true, new: true }
      ).then(() => {
        console.log(`💾 [Socket new_food_order Async DB Save] Saved ${bId}`);
      }).catch((err) => {
        console.error('❌ Error saving new_food_order to MongoDB:', err.message);
      });
    });


    // Real-Time Ringing Acknowledgement from Restaurant Screen
    socket.on('restaurant_ringing', async (data) => {
      const bId = data?.bookingId || data?.rideId;
      if (!bId) return;
      console.log(`🔔 [RESTAURANT RINGING ACK RECEIVED]: bookingId: ${bId}`);

      let ride = pendingRides.get(bId);
      if (ride) {
        ride.status = 'RINGING';
      }

      Booking.findOneAndUpdate(
        { bookingId: bId, status: { $in: ['PENDING_RESTAURANT', 'PENDING'] } },
        { status: 'RINGING' }
      ).catch(() => {});

      const payload = {
        bookingId: bId,
        rideId: bId,
        status: 'RINGING',
        restaurantId: data.restaurantId,
        restaurantName: data.restaurantName,
        timestamp: Date.now(),
      };

      const cId = ride?.customerId || data.customerId;
      if (cId) {
        io.to(`user_${cId}`).emit('restaurant_ringing', payload);
        io.to(`user_${cId}`).emit('order_status_updated', payload);
      }
      io.emit('restaurant_ringing', payload);
      io.emit('order_status_updated', payload);
    });

    // Handle food order ringing timeout
    socket.on('food_order_timeout', async (data) => {
      const bId = data?.bookingId || data?.rideId;
      if (!bId) return;
      console.log(`⏰ [FOOD ORDER TIMEOUT] Order ${bId} timed out`);
      try {
        await Booking.findOneAndUpdate(
          { bookingId: bId },
          { status: 'TIMEOUT', cancellationReason: 'No restaurant accepted your order within the timer limit' }
        );
      } catch (e) {}
      const payload = {
        bookingId: bId,
        rideId: bId,
        status: 'TIMEOUT',
        message: 'No restaurant accepted your order. Please try again.'
      };
      if (data?.restaurantId) io.to(`user_${data.restaurantId}`).emit('order_timed_out', payload);
      if (data?.customerId) io.to(`user_${data.customerId}`).emit('order_timed_out', payload);
      io.emit('order_status_updated', payload);
      io.emit('order_timed_out', payload);
    });

    socket.on('ride_request', async (rideData) => {
      if (!rideData || !rideData.rideId) return;
      const categoryName = rideData.categoryName || rideData.category || null;
      const isFood = (categoryName === 'Food Delivery' || rideData.serviceName === 'Food Delivery' || Boolean(rideData.restaurantId));

      // Resolve customerName and customerPhoto from User DB to ensure Single Source of Truth
      const User = require('../models/User');
      let resolvedCustomerName = rideData.customerName || 'Customer';
      let resolvedCustomerPhoto = rideData.customerPhoto || null;
      let resolvedCustomerPhone = rideData.customerPhone || '';

      if (rideData.customerId && typeof rideData.customerId === 'string' && rideData.customerId.match(/^[0-9a-fA-F]{24}$/)) {
        try {
          const userObj = await User.findById(rideData.customerId).lean();
          if (userObj) {
            resolvedCustomerName = userObj.name || userObj.username || resolvedCustomerName;
            resolvedCustomerPhoto = userObj.profilePicture || userObj.avatar || resolvedCustomerPhoto;
            resolvedCustomerPhone = userObj.phoneNumber || userObj.phone || resolvedCustomerPhone;
          }
        } catch (e) {
          console.error('[Socket] Failed to resolve customer name from DB:', e.message);
        }
      }

      let targetRestoId = (rideData.restaurantId || rideData.providerId || rideData.partnerId)?.toString();
      let restoName = rideData.restaurantName || '';

      // If food order and targetRestoId is missing, resolve to active registered supplier
      if (isFood && !targetRestoId) {
        try {
          const supp = (await User.findOne({ role: 'supplier', isOnline: true }).lean()) || (await User.findOne({ role: 'supplier' }).lean());
          if (supp) {
            targetRestoId = supp._id.toString();
            restoName = restoName || supp.name || supp.restaurantName || 'Restaurant Partner';
          }
        } catch (e) {}
      }

      rideData.customerName = resolvedCustomerName;
      rideData.customerPhoto = resolvedCustomerPhoto;
      rideData.customerPhone = resolvedCustomerPhone;
      if (isFood) {
        rideData.restaurantId = targetRestoId;
        rideData.partnerId = targetRestoId;
        rideData.providerId = targetRestoId;
        rideData.restaurantName = restoName;
        rideData.status = rideData.status || 'PENDING_RESTAURANT';
      }

      const customerLat = Number(rideData.pickupLatitude || rideData.pickupLat || rideData.latitude || 0) || null;
      const customerLng = Number(rideData.pickupLongitude || rideData.pickupLng || rideData.longitude || 0) || null;

      console.log(`⚡ [INSTANT ZERO-LATENCY DISPATCH] Ride ID: ${rideData.rideId} | Customer: ${resolvedCustomerName} | Category: ${categoryName}`);

      try {
        await Booking.findOneAndUpdate(
          { bookingId: rideData.rideId },
          {
            bookingId: rideData.rideId,
            customerId: rideData.customerId || 'customer_device_1',
            customerName: resolvedCustomerName,
            customerPhoto: resolvedCustomerPhoto,
            customerPhone: resolvedCustomerPhone || '9999999999',
            serviceName: categoryName || rideData.serviceName || (isFood ? 'Food Delivery' : 'Home Cleaning'),
            categoryName: categoryName || rideData.serviceName || (isFood ? 'Food Delivery' : 'Home Cleaning'),
            price: Number(rideData.price || 299),
            serviceAddress: rideData.pickupAddress || 'Service Location',
            latitude: customerLat,
            longitude: customerLng,
            scheduledDate: rideData.scheduledDate || new Date().toISOString().split('T')[0],
            scheduledTime: rideData.scheduledTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            restaurantId: isFood ? targetRestoId : undefined,
            partnerId: isFood ? targetRestoId : undefined,
            providerId: isFood ? targetRestoId : undefined,
            restaurantName: isFood ? restoName : undefined,
            cartItems: isFood ? (rideData.cartItems || {}) : undefined,
            deliveryFee: Number(rideData.deliveryFee || 0),
            subtotal: Number(rideData.subtotal || 0),
            status: isFood ? (rideData.status || 'PENDING_RESTAURANT') : 'BOOKING_REQUESTED',
          },
          { upsert: true, new: true }
        );
        console.log(`💾 [Socket DB Save] Saved Ride/Booking ${rideData.rideId} with customer "${resolvedCustomerName}" to MongoDB successfully.`);
      } catch (dbErr) {
        console.error('❌ [Socket DB Save Error]:', dbErr.message);
      }

      pendingRides.set(rideData.rideId, {
        ...rideData,
        status: isFood ? (rideData.status || 'PENDING_RESTAURANT') : 'PENDING',
        requestedAt: new Date(),
        declinedByRiders: rideData.declinedByRiders || [],
      });
      io.to('admin_tracking').emit('ride_update_admin', pendingRides.get(rideData.rideId));

      const pickupLat = Number(rideData.pickupLatitude || rideData.latitude || 0) || null;
      const pickupLon = Number(rideData.pickupLongitude || rideData.longitude || 0) || null;

      const payload = {
        ...rideData,
        pickupLatitude: pickupLat,
        pickupLongitude: pickupLon,
        status: isFood ? (rideData.status || 'PENDING_RESTAURANT') : 'PENDING',
      };

      // If food order with target restaurant, schedule dispatch to supplier after 20-second delay
      if (isFood && targetRestoId) {
        console.log(`⏳ [RIDE REQUEST FOOD DISPATCH] Scheduling supplier dispatch for order #${rideData.rideId} in 20 seconds.`);
        scheduleSupplierOrderDispatch(payload, 20000);
        socket.emit('ride_request_sent', { rideId: rideData.rideId, status: payload.status, eligibleRiders: 1 });
        return;
      }

      const { eligibleCount } = await dispatchBookingToEligibleSuppliers(io, payload);
      if (eligibleCount > 0) {
        socket.emit('ride_request_sent', { rideId: rideData.rideId, status: payload.status, eligibleRiders: eligibleCount });
      } else {
        socket.emit('no_provider_available', {
          rideId: rideData.rideId,
          message: 'No eligible service provider available.',
        });
        io.to(`user_${rideData.customerId}`).emit('service_rejected', {
          rideId: rideData.rideId,
          message: 'No eligible service provider available.',
        });
      }
    });

    socket.on('get_pending_rides', () => {
      const activePending = Array.from(pendingRides.values()).filter(r => r.status === 'PENDING');
      socket.emit('pending_rides_list', activePending);
    });

    const handleRideAccepted = async (data) => {
      const bId = data?.rideId || data?.bookingId || data?._id;
      const actualRiderId = data?.riderId || data?.providerId || data?.acceptedBy?.riderId || socket.userId;

      console.log(`[BOOKING_ACCEPTED_ATTEMPT] bookingId: ${bId}, supplierId: ${actualRiderId}`);

      if (!bId) {
        socket.emit('ride_accept_failed', { message: 'Booking ID is required.' });
        return;
      }

      if (!actualRiderId) {
        socket.emit('ride_accept_failed', { message: 'Supplier must be authenticated.' });
        return;
      }

      try {
        const User = require('../models/User');
        const Booking = require('../models/Booking');

        // 1. Verify Supplier Account
        const provider = await User.findById(actualRiderId);
        if (!provider) {
          socket.emit('ride_accept_failed', { message: 'Supplier account not found.' });
          return;
        }

        if (provider.isSuspended) {
          socket.emit('ride_accept_failed', { message: 'Supplier account is suspended.' });
          return;
        }

        // 2. Verify Booking State from DB (Source of Truth)
        const booking = await Booking.findOne({
          $or: [{ bookingId: bId }, { _id: mongoose.Types.ObjectId.isValid(bId) ? bId : null }]
        });

        if (!booking) {
          socket.emit('ride_accept_failed', { message: 'Booking request does not exist.' });
          return;
        }

        const validRequestedStatuses = ['BOOKING_REQUESTED', 'PENDING', 'SEARCHING', 'PROVIDER_ASSIGNED', 'PROVIDER_ACCEPTED'];
        if (!validRequestedStatuses.includes(booking.status)) {
          socket.emit('ride_accept_failed', { message: 'Booking has already been completed or is inactive.' });
          return;
        }

        if (booking.providerId && booking.providerId !== actualRiderId) {
          socket.emit('ride_accept_failed', { message: 'Booking is already assigned to another provider.' });
          return;
        }

        // 3. Resolve Rider Details
        const resolvedRiderName = provider.name || provider.username || 'Service Partner';
        const resolvedRiderPhone = provider.phoneNumber || provider.phone || '';
        const resolvedRiderPhoto = provider.profilePicture || provider.avatar || null;

        // Atomic update with double-assignment protection
        const atomicBookingFilter = {
          $and: [
            {
              $or: [{ bookingId: bId }, { _id: mongoose.Types.ObjectId.isValid(bId) ? bId : null }]
            },
            {
              $or: [
                { providerId: { $exists: false } },
                { providerId: null },
                { providerId: '' },
                { providerId: actualRiderId }
              ]
            },
            {
              status: { $in: validRequestedStatuses }
            }
          ]
        };

        const updatedBooking = await Booking.findOneAndUpdate(
          atomicBookingFilter,
          {
            $set: {
              status: 'PROVIDER_ACCEPTED',
              providerId: actualRiderId,
              providerName: resolvedRiderName,
              providerPhone: resolvedRiderPhone,
              providerPhoto: resolvedRiderPhoto,
              acceptedAt: new Date(),
            }
          },
          { new: true }
        );

        if (!updatedBooking) {
          socket.emit('ride_accept_failed', { alreadyTaken: true, message: 'This booking has already been accepted by another provider.' });
          return;
        }

        // 4. Update memory state
        let ride = pendingRides.get(bId) || {};
        ride.bookingId = bId;
        ride.rideId = bId;
        ride.status = 'ACCEPTED';
        ride.acceptedBy = {
          riderId: actualRiderId,
          riderName: resolvedRiderName,
          riderPhone: resolvedRiderPhone,
          riderPhoto: resolvedRiderPhoto,
          riderLocation: data?.riderLocation || null,
        };
        ride.providerId = actualRiderId;
        ride.providerName = resolvedRiderName;
        ride.providerPhone = resolvedRiderPhone;
        ride.providerPhoto = resolvedRiderPhoto;
        pendingRides.set(bId, ride);

        console.log(`[BOOKING_ACCEPTED]
bookingId: ${bId}
supplierId: ${actualRiderId}
customerId: ${booking.customerId}`);

        // Notify client success
        socket.emit('ride_accept_success', ride);

        // Notify customer and all clients of status update
        io.emit('booking_status_updated', { bookingId: bId, providerId: actualRiderId, status: 'PROVIDER_ACCEPTED', updatedAt: new Date() });
        io.emit(`ride_accepted_${bId}`, ride);
        
        if (booking.customerId) {
          io.to(`user_${booking.customerId}`).emit('service_accepted', ride);
          io.to(`user_${booking.customerId}`).emit('ride_accepted', ride);
        }

        // Notify all riders that this ride is no longer available
        io.to('riders_room').emit('ride_taken', { rideId: bId });
        io.to('admin_tracking').emit('ride_update_admin', ride);

      } catch (err) {
        console.error('Error processing ride acceptance validation:', err);
        socket.emit('ride_accept_failed', { message: 'Internal server error during acceptance.' });
      }
    };

    socket.on('ride_accepted', handleRideAccepted);
    socket.on('accept_ride', handleRideAccepted);

    socket.on('reject_ride', (data) => {
      const { rideId, riderId } = data || {};
      console.log(`❌ [Service Declined] Ride ${rideId} declined by Provider ${riderId}`);
      if (rideId && pendingRides.has(rideId)) {
        const ride = pendingRides.get(rideId);
        if (!ride.declinedByRiders) ride.declinedByRiders = [];
        if (!ride.declinedByRiders.includes(riderId)) {
          ride.declinedByRiders.push(riderId);
        }
        pendingRides.set(rideId, ride);
        io.to('admin_tracking').emit('ride_update_admin', ride);

        // Search for NEXT eligible provider within 4 KM
        const pickupLat = Number(ride.pickupLatitude || 0);
        const pickupLon = Number(ride.pickupLongitude || 0);
        const MATCHING_RADIUS_KM = 40000.0; // TEMPORARILY 40,000 KM FOR TESTING

        let nextEligibleRiders = [];
        onlineRiders.forEach((riderInfo) => {
          if (!riderInfo.isOnline) return;
          if (ride.declinedByRiders.includes(riderInfo.riderId)) return;

          const riderLat = Number(riderInfo.location?.latitude || 0);
          const riderLon = Number(riderInfo.location?.longitude || 0);
          if (!riderLat || !riderLon) return;

          const distKm = getDistanceFromLatLonInKm(pickupLat, pickupLon, riderLat, riderLon);

          if (distKm <= MATCHING_RADIUS_KM) {
            nextEligibleRiders.push({ ...riderInfo, distanceKm: Number(distKm.toFixed(1)) });
          }
        });

        if (nextEligibleRiders.length > 0) {
          console.log(`🔄 [FALLBACK DISPATCH] Re-dispatching Ride ${rideId} to next eligible provider ${nextEligibleRiders[0].riderId}`);
          const payloadNext = { ...ride, distanceKm: nextEligibleRiders[0].distanceKm };
          io.to(nextEligibleRiders[0].socketId).emit('new_ride_request', payloadNext);
          io.to(nextEligibleRiders[0].socketId).emit('ride_request', payloadNext);
        } else {
          console.log(`⚠️ [ALL PROVIDERS DECLINED] All providers within 4 KM declined Ride ${rideId}`);
          ride.status = 'REJECTED';
          pendingRides.set(rideId, ride);
          io.to('admin_tracking').emit('ride_update_admin', ride);
          io.to(`user_${ride.customerId}`).emit('service_rejected', {
            rideId,
            riderId,
            message: 'No service provider available within 4 KM.',
          });
          io.emit('ride_rejected', { rideId, riderId, message: 'No service provider available within 4 KM.' });
          io.to('admin_tracking').emit('ride_rejected', { rideId, riderId, message: 'No service provider available within 4 KM.' });
        }
      }
    });

    socket.on('ride_rejected', (data) => {
      const { rideId, riderId } = data || {};
      console.log(`❌ [Service Declined] Ride ${rideId} declined by Provider ${riderId}`);
      if (rideId && pendingRides.has(rideId)) {
        const ride = pendingRides.get(rideId);
        if (!ride.declinedByRiders) ride.declinedByRiders = [];
        if (!ride.declinedByRiders.includes(riderId)) {
          ride.declinedByRiders.push(riderId);
        }
        pendingRides.set(rideId, ride);
        io.to('admin_tracking').emit('ride_update_admin', ride);

        // Search for NEXT eligible provider within 4 KM
        const pickupLat = Number(ride.pickupLatitude || 0);
        const pickupLon = Number(ride.pickupLongitude || 0);
        const MATCHING_RADIUS_KM = 40000.0; // TEMPORARILY 40,000 KM FOR TESTING

        let nextEligibleRiders = [];
        onlineRiders.forEach((riderInfo) => {
          if (!riderInfo.isOnline) return;
          if (ride.declinedByRiders.includes(riderInfo.riderId)) return;

          const riderLat = Number(riderInfo.location?.latitude || 0);
          const riderLon = Number(riderInfo.location?.longitude || 0);
          if (!riderLat || !riderLon) return;

          const distKm = getDistanceFromLatLonInKm(pickupLat, pickupLon, riderLat, riderLon);

          if (distKm <= MATCHING_RADIUS_KM) {
            nextEligibleRiders.push({ ...riderInfo, distanceKm: Number(distKm.toFixed(1)) });
          }
        });

        if (nextEligibleRiders.length > 0) {
          console.log(`🔄 [FALLBACK DISPATCH] Re-dispatching Ride ${rideId} to next eligible provider ${nextEligibleRiders[0].riderId}`);
          const payloadNext = { ...ride, distanceKm: nextEligibleRiders[0].distanceKm };
          io.to(nextEligibleRiders[0].socketId).emit('new_ride_request', payloadNext);
          io.to(nextEligibleRiders[0].socketId).emit('ride_request', payloadNext);
        } else {
          console.log(`⚠️ [ALL PROVIDERS DECLINED] All providers within 4 KM declined Ride ${rideId}`);
          ride.status = 'REJECTED';
          pendingRides.set(rideId, ride);
          io.to('admin_tracking').emit('ride_update_admin', ride);
          io.to(`user_${ride.customerId}`).emit('service_rejected', {
            rideId,
            riderId,
            message: 'No service provider available within 4 KM.',
          });
          io.emit('ride_rejected', { rideId, riderId, message: 'No service provider available within 4 KM.' });
          io.to('admin_tracking').emit('ride_rejected', { rideId, riderId, message: 'No service provider available within 4 KM.' });
        }
      }
    });

    const handleRiderReachedRestaurant = async (data) => {
      const { bookingId, rideId, customerId, riderId } = data || {};
      const targetId = bookingId || rideId;
      console.log(`📍 [Rider Reached Restaurant]: Service ${targetId}`);

      try {
        let booking = await Booking.findOne({ bookingId: targetId });
        if (!booking && mongoose.Types.ObjectId.isValid(targetId)) {
          booking = await Booking.findById(targetId);
        }

        if (booking) {
          booking.riderStatus = 'REACHED_RESTAURANT';
          booking.riderReachedAt = new Date();
          booking.deliveryStatus = 'RIDER_AT_RESTAURANT';
          // CRITICAL: Order status MUST REMAIN PREPARING (or current status), NOT OVERWRITTEN!
          await booking.save();

          console.log(`ORDER #${targetId} | ACTOR: RIDER | EVENT: REACHED_RESTAURANT | RIDER_STATUS: REACHED_RESTAURANT | ORDER_STATUS: ${booking.status}`);

          if (pendingRides.has(targetId)) {
            const b = pendingRides.get(targetId);
            b.riderStatus = 'REACHED_RESTAURANT';
            b.deliveryStatus = 'RIDER_AT_RESTAURANT';
            // Do NOT overwrite b.status
            pendingRides.set(targetId, b);
          }

          const reachedPayload = {
            bookingId: targetId,
            rideId: targetId,
            riderId: booking.providerId || riderId || socket.userId,
            riderName: booking.providerName,
            riderPhone: booking.providerPhone,
            riderPhoto: booking.providerPhoto,
            riderStatus: 'REACHED_RESTAURANT',
            status: booking.status, // PREPARING
            orderStatus: booking.status,
            reachedAt: booking.riderReachedAt,
          };

          if (booking.restaurantId) {
            const rIdStr = booking.restaurantId.toString();
            io.to(`user_${rIdStr}`).emit('rider_reached_restaurant', reachedPayload);
            io.to(`restaurant_${rIdStr}`).emit('rider_reached_restaurant', reachedPayload);
            io.to(`supplier_${rIdStr}`).emit('rider_reached_restaurant', reachedPayload);
            io.to(`supplier:${rIdStr}`).emit('rider_reached_restaurant', reachedPayload);
            io.to(rIdStr).emit('rider_reached_restaurant', reachedPayload);
          }
          io.to('suppliers_room').emit('rider_reached_restaurant', reachedPayload);
          io.to('online_suppliers').emit('rider_reached_restaurant', reachedPayload);
          io.to('admin_tracking').emit('rider_reached_restaurant', reachedPayload);
          io.to(`booking_${targetId}`).emit('rider_reached_restaurant', reachedPayload);
          io.to(`order_${targetId}`).emit('rider_reached_restaurant', reachedPayload);
          if (booking.customerId || customerId) {
            const custId = (booking.customerId || customerId).toString();
            io.to(`user_${custId}`).emit('rider_reached_restaurant', reachedPayload);
            io.to(custId).emit('rider_reached_restaurant', reachedPayload);
            io.to(`user_${custId}`).emit('booking_status_updated', {
              bookingId: targetId,
              status: booking.status,
              riderStatus: 'REACHED_RESTAURANT',
              deliveryStatus: 'RIDER_AT_RESTAURANT',
              updatedAt: new Date()
            });
          }
          io.to(`booking_${targetId}`).emit('booking_status_updated', {
            bookingId: targetId,
            status: booking.status,
            riderStatus: 'REACHED_RESTAURANT',
            deliveryStatus: 'RIDER_AT_RESTAURANT',
            updatedAt: new Date()
          });

          // Dynamic Category-Aware Notification for Customer (Requirement 12)
          try {
            const notifService = require('../services/notificationService');
            const rawCat = (booking.categoryName || booking.businessCategoryName || booking.serviceName || booking.supplierCategory || '').toLowerCase();
            let catType = 'store';
            let storeTitle = 'Store';
            if (rawCat.includes('food') || rawCat.includes('restaurant') || booking.restaurantId) {
              catType = 'restaurant';
              storeTitle = 'Restaurant';
            } else if (rawCat.includes('fashion') || rawCat.includes('cloth') || rawCat.includes('saree') || rawCat.includes('wear')) {
              catType = 'fashion store';
              storeTitle = 'Fashion Store';
            } else if (rawCat.includes('groc') || rawCat.includes('kirana') || rawCat.includes('ration')) {
              catType = 'grocery store';
              storeTitle = 'Grocery Store';
            } else if (rawCat.includes('veg') || rawCat.includes('fruit') || rawCat.includes('sabzi')) {
              catType = 'vegetable store';
              storeTitle = 'Vegetable Store';
            } else if (rawCat.includes('elect') || rawCat.includes('gadget') || rawCat.includes('mobile')) {
              catType = 'electronics store';
              storeTitle = 'Electronics Store';
            } else if (rawCat.includes('toy') || rawCat.includes('game') || rawCat.includes('doll')) {
              catType = 'toy store';
              storeTitle = 'Toy Store';
            } else if (rawCat.includes('pharm') || rawCat.includes('medic') || rawCat.includes('chemist')) {
              catType = 'pharmacy';
              storeTitle = 'Pharmacy';
            }
            const storeName = booking.restaurantName || booking.supplierBusinessName || booking.partnerName;
            const reachedTarget = storeName ? storeName : `the ${catType}`;
            if (booking.customerId) {
              notifService.updateOrSendOrderNotification(
                booking.customerId,
                booking.providerId || null,
                booking.bookingId,
                'REACHED_RESTAURANT',
                `Rider has reached ${reachedTarget}.`,
                `Rider at ${storeTitle}`,
                io,
                { bookingId: booking.bookingId, status: booking.status, riderStatus: 'REACHED_RESTAURANT' }
              ).catch(() => {});
            }
          } catch (_) {}
        }
      } catch (err) {
        console.error('[Socket] Error in rider_reached_restaurant:', err);
      }
    };

    socket.on('rider_reached_restaurant', handleRiderReachedRestaurant);

    socket.on('provider_arrived', async (data) => {
      const { bookingId, rideId, customerId } = data || {};
      const targetId = bookingId || rideId;
      console.log(`📍 [Provider Arrived]: Service ${targetId}`);

      try {
        let booking = await Booking.findOne({ bookingId: targetId });
        if (!booking && mongoose.Types.ObjectId.isValid(targetId)) {
          booking = await Booking.findById(targetId);
        }

        const isFoodOrder = booking && (
          booking.serviceName === 'Food Delivery' ||
          booking.categoryName === 'Food Delivery' ||
          Boolean(booking.restaurantId) ||
          (booking.cartItems && typeof booking.cartItems === 'object' && Object.keys(booking.cartItems).length > 0)
        );

        if (isFoodOrder) {
          // For food delivery orders, provider arriving means RIDER REACHED RESTAURANT.
          // STRICT SEPARATION: MUST NOT OVERWRITE booking.status = 'PROVIDER_ARRIVED'!
          return handleRiderReachedRestaurant(data);
        }

        // Non-food service provider arrival (cab, electrician, salon, etc.)
        let updatedRide = null;
        if (targetId && pendingRides.has(targetId)) {
          const b = pendingRides.get(targetId);
          b.status = 'PROVIDER_ARRIVED';
          pendingRides.set(targetId, b);
          updatedRide = b;
        }

        if (booking) {
          booking.status = 'PROVIDER_ARRIVED';
          booking.deliveryStatus = 'RIDER_ASSIGNED';
          await booking.save();
        } else {
          await Booking.findOneAndUpdate({ bookingId: targetId }, { status: 'PROVIDER_ARRIVED' });
        }

        console.log(`[BOOKING_SOCKET] UPDATE\nbookingId: ${targetId}\nstatus: PROVIDER_ARRIVED`);

        io.emit('booking_status_updated', { bookingId: targetId, status: 'PROVIDER_ARRIVED', updatedAt: new Date() });
        io.emit('provider_arrived', { bookingId: targetId, rideId: targetId });
        io.emit(`provider_arrived_${targetId}`, { bookingId: targetId });
        if (customerId) {
          io.to(`user_${customerId}`).emit('provider_arrived', { bookingId: targetId });
        }
        if (updatedRide) {
          io.to('admin_tracking').emit('ride_update_admin', updatedRide);
        }
      } catch (err) {
        console.error('[Socket] Error updating booking to arrived in DB:', err);
      }
    });

    socket.on('provider_location_update', (data) => {
      const { providerId, latitude, longitude, speed, accuracy, timestamp, bookingId, rideId } = data || {};
      const targetId = bookingId || rideId;
      const rId = providerId || socket.userId || 'rider_1';
      
      console.log(`[TRACKING] locationUpdate received`);
      console.log(`[TRACKING] providerId: ${rId}`);
      console.log(`[TRACKING] bookingId: ${targetId}`);
      
      if (!latitude || !longitude || !targetId || latitude === 0 || longitude === 0) {
        console.warn(`[TRACKING] Invalid location data received from provider ${rId}. Dropping.`);
        return;
      }

      const existing = onlineRiders.get(rId);
      if (existing) {
        existing.location = {
          latitude: Number(latitude),
          longitude: Number(longitude),
          timestamp: timestamp || Date.now()
        };
        onlineRiders.set(rId, existing);
      }

      if (pendingRides.has(targetId)) {
        const ride = pendingRides.get(targetId);
        if (!ride.acceptedBy) ride.acceptedBy = {};
        ride.acceptedBy.riderLocation = { latitude: Number(latitude), longitude: Number(longitude) };
        ride.driverLat = Number(latitude);
        ride.driverLon = Number(longitude);
        pendingRides.set(targetId, ride);
      }

      console.log(`[TRACKING] broadcasting to booking room: booking_${targetId}`);

      // Emit to booking room for real-time live map markers
      io.to(`booking_${targetId}`).emit('rider_location_updated', {
        bookingId: targetId,
        rideId: targetId,
        riderId: rId,
        providerId: rId,
        latitude: Number(latitude),
        longitude: Number(longitude),
        heading: data?.heading || 0,
        speed: speed || 0,
        location: { latitude: Number(latitude), longitude: Number(longitude) },
        timestamp: timestamp || Date.now(),
      });

      // Also broadcast directly to customer room if known
      if (pendingRides.has(targetId)) {
        const currentRide = pendingRides.get(targetId);
        if (currentRide?.customerId) {
          io.to(`user_${currentRide.customerId}`).emit('rider_location_updated', {
            bookingId: targetId,
            rideId: targetId,
            riderId: rId,
            providerId: rId,
            latitude: Number(latitude),
            longitude: Number(longitude),
            heading: data?.heading || 0,
            speed: speed || 0,
            location: { latitude: Number(latitude), longitude: Number(longitude) },
            timestamp: timestamp || Date.now(),
          });
        }
      }

      // Legacy listener compatibility
      io.emit(`provider_location_${targetId}`, {
        providerId: rId,
        latitude: Number(latitude),
        longitude: Number(longitude),
        speed: speed || 0,
        accuracy: accuracy || 5,
        timestamp: timestamp || Date.now(),
        bookingId: targetId,
        rideId: targetId,
      });

      io.to('admin_tracking').emit('rider_location_update_admin', {
        riderId: rId,
        latitude: Number(latitude),
        longitude: Number(longitude),
        timestamp: timestamp || Date.now(),
        rideId: targetId,
      });
    });

    socket.on('get_provider_location', async (data) => {
      const { bookingId, rideId, providerId } = data || {};
      const targetId = bookingId || rideId;
      console.log(`[TRACKING] get_provider_location requested for bookingId: ${targetId}, providerId: ${providerId}`);
      
      let riderLoc = null;
      let resolvedProviderId = providerId;
      if (providerId && onlineRiders.has(providerId)) {
        riderLoc = onlineRiders.get(providerId)?.location;
      }
      if (!riderLoc && targetId && pendingRides.has(targetId)) {
        const ride = pendingRides.get(targetId);
        resolvedProviderId = resolvedProviderId || ride.acceptedBy?.riderId || ride.providerId;
        riderLoc = ride.acceptedBy?.riderLocation || (ride.acceptedBy?.riderId && onlineRiders.get(ride.acceptedBy.riderId)?.location) || (ride.providerId && onlineRiders.get(ride.providerId)?.location);
      }

      // MongoDB fallback if not in active memory
      if (!riderLoc && targetId) {
        try {
          const Booking = require('../models/Booking');
          const bookingDoc = await Booking.findOne({
            $or: [{ bookingId: targetId }, { _id: mongoose.Types.ObjectId.isValid(targetId) ? targetId : null }]
          }).lean();
          if (bookingDoc) {
            resolvedProviderId = resolvedProviderId || bookingDoc.providerId;
            if (bookingDoc.driverLat && bookingDoc.driverLon) {
              riderLoc = { latitude: bookingDoc.driverLat, longitude: bookingDoc.driverLon };
            }
          }
        } catch (e) {}
      }
      
      if (riderLoc && riderLoc.latitude && riderLoc.longitude) {
        console.log(`[TRACKING] responding immediately with known provider location: lat ${riderLoc.latitude}, lon ${riderLoc.longitude}`);
        socket.emit(`provider_location_${targetId}`, {
          providerId: resolvedProviderId || 'rider_provider',
          latitude: Number(riderLoc.latitude),
          longitude: Number(riderLoc.longitude),
          speed: riderLoc.speed || 0,
          accuracy: riderLoc.accuracy || 5,
          timestamp: riderLoc.timestamp || Date.now(),
          bookingId: targetId,
          rideId: targetId,
        });
      }
    });

    socket.on('service_started', async (data) => {
      const { rideId, customerId } = data || {};
      let updatedRide = null;
      if (rideId && pendingRides.has(rideId)) {
        const ride = pendingRides.get(rideId);
        ride.status = 'STARTED';
        ride.riderStatus = 'OUT_FOR_DELIVERY';
        ride.deliveryStatus = 'OUT_FOR_DELIVERY';
        pendingRides.set(rideId, ride);
        updatedRide = ride;
      }
      console.log(`▶️ [Service Started] Service ${rideId}`);

      try {
        const b = await Booking.findOne({ bookingId: rideId });
        if (b) {
          const isFood = (
            b.serviceName === 'Food Delivery' ||
            b.categoryName === 'Food Delivery' ||
            Boolean(b.restaurantId) ||
            (b.cartItems && typeof b.cartItems === 'object' && Object.keys(b.cartItems).length > 0)
          );
          b.status = isFood ? 'OUT_FOR_DELIVERY' : 'SERVICE_STARTED';
          b.startedAt = new Date();
          if (isFood) {
            b.riderStatus = 'OUT_FOR_DELIVERY';
            b.deliveryStatus = 'OUT_FOR_DELIVERY';
            b.pickedUpAt = new Date();
          }
          await b.save();
        } else {
          await Booking.findOneAndUpdate({ bookingId: rideId }, { status: 'SERVICE_STARTED', startedAt: new Date() });
        }
      } catch (err) {
        console.error('[Socket] Error updating booking to started in DB:', err);
      }

      console.log(`[BOOKING_SOCKET] UPDATE\nbookingId: ${rideId}\nstatus: OUT_FOR_DELIVERY / SERVICE_STARTED`);

      io.emit('booking_status_updated', {
        bookingId: rideId,
        status: 'OUT_FOR_DELIVERY',
        riderStatus: 'OUT_FOR_DELIVERY',
        deliveryStatus: 'OUT_FOR_DELIVERY',
        updatedAt: new Date()
      });
      if (customerId) {
        io.to(`user_${customerId}`).emit('service_started', { rideId });
      }
      io.emit(`service_started_${rideId}`, { rideId });
      if (updatedRide) {
        io.to('admin_tracking').emit('ride_update_admin', updatedRide);
      }
    });

    socket.on('service_completed', async (data) => {
      const { rideId, customerId } = data || {};
      let updatedRide = null;
      if (rideId && pendingRides.has(rideId)) {
        const ride = pendingRides.get(rideId);
        ride.status = 'COMPLETED';
        pendingRides.set(rideId, ride);
        updatedRide = ride;
      }
      console.log(`🏁 [Service Completed] Service ${rideId}`);

      try {
        await Booking.findOneAndUpdate({ bookingId: rideId }, { status: 'COMPLETED', completedAt: new Date() });
      } catch (err) {
        console.error('[Socket] Error updating booking to completed in DB:', err);
      }

      console.log(`[BOOKING_SOCKET] UPDATE
bookingId: ${rideId}
status: COMPLETED`);

      io.emit('booking_status_updated', { bookingId: rideId, status: 'COMPLETED', updatedAt: new Date() });
      if (customerId) {
        io.to(`user_${customerId}`).emit('service_completed', { rideId });
      }
      io.emit(`service_completed_${rideId}`, { rideId });
      if (updatedRide) {
        io.to('admin_tracking').emit('ride_update_admin', updatedRide);
      }
    });

    socket.on('ride_rejected', (data) => {
      const { rideId, riderId } = data || {};
      console.log(`❌ [Ride Rejected] Ride ${rideId} rejected by Rider ${riderId}`);
      socket.emit('ride_rejected_ack', { rideId });
    });

    socket.on('ride_cancelled', async (data) => {
      const { rideId, customerId, cancelledBy, cancellationReason } = data || {};
      if (!rideId) return;

      if (global.activeSupplierDispatchTimers && global.activeSupplierDispatchTimers.has(rideId)) {
        clearTimeout(global.activeSupplierDispatchTimers.get(rideId));
        global.activeSupplierDispatchTimers.delete(rideId);
        console.log(`⏱️ [20S DELAY CANCELLED via socket] Cleared supplier dispatch timer for #${rideId}`);
      }

      const isProvider = cancelledBy === 'PROVIDER' || cancelledBy === 'supplier' || cancelledBy === 'rider';
      const statusToSet = 'CANCELLED';
      const actor = isProvider ? 'SUPPLIER' : 'CUSTOMER';

      let assignedRiderId = null;
      let updatedRide = null;
      if (pendingRides.has(rideId)) {
        const ride = pendingRides.get(rideId);
        assignedRiderId = ride.acceptedBy?.riderId || null;
        ride.status = statusToSet;
        pendingRides.set(rideId, ride);
        updatedRide = ride;
      }
      console.log(`🚫 [Booking Cancelled by ${actor}] Ride ${rideId}`);

      try {
        await Booking.findOneAndUpdate({ bookingId: rideId }, { 
          status: statusToSet, 
          cancellationReason: cancellationReason || `Cancelled by ${actor.toLowerCase()}`,
          cancelledBy: actor,
          cancelledAt: new Date()
        });
      } catch (err) {
        console.error('[Socket] Error updating booking to cancelled in DB:', err);
      }

      const payload = {
        bookingId: rideId,
        rideId,
        status: statusToSet,
        cancelledBy: actor,
        cancellationReason: cancellationReason || `Cancelled by ${actor.toLowerCase()}`,
        updatedAt: new Date()
      };

      io.emit('booking_status_updated', payload);
      io.emit('service_cancelled', payload);
      io.emit('ride_cancelled', payload);

      if (customerId) {
        io.to(`user_${customerId}`).emit('booking_status_updated', payload);
        io.to(`user_${customerId}`).emit('service_cancelled', payload);
        io.to(`user_${customerId}`).emit('ride_cancelled', payload);
      }
      if (assignedRiderId) {
        io.to(`user_${assignedRiderId}`).emit('booking_status_updated', payload);
        io.to(`user_${assignedRiderId}`).emit('service_cancelled', payload);
        io.to(`user_${assignedRiderId}`).emit('ride_cancelled', payload);
      }

      if (!isProvider) {
        // Legacy support alerts for other riders
        io.to('riders_room').emit('booking_cancelled_by_customer', { rideId, cancelledBy: actor, reason: cancellationReason });
        io.to('riders_room').emit('ride_cancelled_by_customer', { rideId, cancelledBy: actor, reason: cancellationReason });
        if (assignedRiderId) {
          onlineRiders.forEach((riderInfo) => {
            if (riderInfo.riderId === assignedRiderId) {
              io.to(riderInfo.socketId).emit('booking_cancelled_by_customer', {
                rideId,
                message: 'Customer ne booking cancel kar di.',
                cancelledBy: actor,
                reason: cancellationReason
              });
            }
          });
        }
      }

      console.log(`[BOOKING_SOCKET] UPDATE
bookingId: ${rideId}
status: ${statusToSet}`);

      socket.emit('ride_cancel_success', { rideId });
      if (updatedRide) {
        io.to('admin_tracking').emit('ride_update_admin', updatedRide);
      }
    });

    socket.on('service_cancelled', async (data) => {
      try {
        const { rideId, bookingId, cancelledBy, cancellationReason, reason, providerId, customerId } = data || {};
        const bId = bookingId || rideId;
        if (!bId) return;

        if (global.activeSupplierDispatchTimers && global.activeSupplierDispatchTimers.has(bId)) {
          clearTimeout(global.activeSupplierDispatchTimers.get(bId));
          global.activeSupplierDispatchTimers.delete(bId);
          console.log(`⏱️ [20S DELAY CANCELLED via socket] Cleared supplier dispatch timer for #${bId}`);
        }

        const normalizedCancelledBy = (cancelledBy === 'PROVIDER' || cancelledBy === 'SUPPLIER' || cancelledBy === 'RIDER' || cancelledBy === 'PARTNER')
          ? 'SUPPLIER'
          : 'CUSTOMER';

        if (pendingRides.has(bId)) {
          const r = pendingRides.get(bId);
          r.status = 'CANCELLED';
          pendingRides.set(bId, r);
        }

        const newStatus = 'CANCELLED';
        const finalReason = cancellationReason || reason || `Cancelled by ${normalizedCancelledBy.toLowerCase()}`;

        const updateData = {
          status: newStatus,
          cancelledBy: normalizedCancelledBy,
          cancellationReason: finalReason,
          cancelledAt: new Date()
        };

        if (providerId) {
          updateData.providerId = providerId;
        }

        const updatedBooking = await Booking.findOneAndUpdate(
          { $or: [{ bookingId: bId }, { _id: mongoose.Types.ObjectId.isValid(bId) ? bId : null }] },
          { $set: updateData },
          { new: true }
        );

        console.log(`🚫 [SOCKET CANCEL SUCCESS]: Booking ${bId} cancelled by ${normalizedCancelledBy}. DB Updated.`);

        const payload = {
          bookingId: bId,
          rideId: bId,
          status: newStatus,
          cancelledBy: normalizedCancelledBy,
          cancellationReason: finalReason,
          reason: finalReason,
          providerId: updatedBooking ? updatedBooking.providerId : providerId,
          customerId: updatedBooking ? updatedBooking.customerId : customerId,
          updatedAt: new Date()
        };

        io.emit('booking_status_updated', payload);
        io.emit('service_cancelled', payload);
        io.emit('ride_cancelled', payload);

        // Also emit to specific users
        const finalCustId = updatedBooking ? updatedBooking.customerId : customerId;
        const finalProvId = updatedBooking ? updatedBooking.providerId : providerId;
        if (finalCustId) {
          io.to(`user_${finalCustId}`).emit('booking_status_updated', payload);
          io.to(`user_${finalCustId}`).emit('service_cancelled', payload);
          io.to(`user_${finalCustId}`).emit('ride_cancelled', payload);
        }
        if (finalProvId) {
          io.to(`user_${finalProvId}`).emit('booking_status_updated', payload);
          io.to(`user_${finalProvId}`).emit('service_cancelled', payload);
          io.to(`user_${finalProvId}`).emit('ride_cancelled', payload);
        }
      } catch (err) {
        console.error('❌ [SOCKET CANCEL ERROR]:', err.message);
      }
    });

    // Real-time Restaurant Acceptance & Food Ready Socket Relays
    socket.on('restaurant_accept', async (data) => {
      try {
        const bId = data?.bookingId || data?.rideId;
        const rId = data?.restaurantId || socket.userId;
        if (!bId) return;

        const booking = await Booking.findOne({
          $or: [{ bookingId: bId }, { _id: mongoose.Types.ObjectId.isValid(bId) ? bId : null }]
        });

        if (booking) {
          booking.status = 'PREPARING';
          booking.acceptedAt = new Date();
          if (rId) {
            const canonicalSuppId = resolveSupplierIdentity(rId);
            booking.supplierId = canonicalSuppId;
            booking.partnerId = canonicalSuppId;
            booking.providerId = canonicalSuppId;
            booking.restaurantId = canonicalSuppId;
          }
          await booking.save();

          console.log(`🍳 [SOCKET restaurant_accept] bookingId: ${bId} -> PREPARING`);

          const payload = {
            bookingId: booking.bookingId,
            rideId: booking.bookingId,
            status: 'PREPARING',
            acceptedAt: booking.acceptedAt,
            restaurantName: booking.restaurantName,
            booking: booking.toObject(),
          };

          const acceptedEventPayload = {
            ...payload,
            status: 'ACCEPTED',
            message: 'Restaurant Accepted Your Order',
          };

          if (booking.customerId) {
            io.to(`user_${booking.customerId}`).emit('RESTAURANT_ACCEPTED', acceptedEventPayload);
            io.to(`user_${booking.customerId}`).emit('FOOD_PREPARING', payload);
            io.to(`user_${booking.customerId}`).emit('order_status_updated', payload);
            io.to(`user_${booking.customerId}`).emit('booking_status_updated', payload);
          }
          const suppTarget = booking.supplierId || booking.restaurantId;
          if (suppTarget) {
            const suppRooms = getSupplierSocketRooms(suppTarget);
            for (const rm of suppRooms) {
              io.to(rm).emit('FOOD_PREPARING', payload);
              io.to(rm).emit('RESTAURANT_ACCEPTED', payload);
              io.to(rm).emit('order_status_updated', payload);
              io.to(rm).emit('booking_status_updated', payload);
            }
          }
          io.emit('order_status_updated', payload);
          io.emit('booking_status_updated', payload);
        }
      } catch (err) {
        console.error('Error handling socket restaurant_accept:', err);
      }
    });

    socket.on('food_ready', async (data) => {
      try {
        const bId = data?.bookingId || data?.rideId;
        if (!bId) return;

        const booking = await Booking.findOne({
          $or: [{ bookingId: bId }, { _id: mongoose.Types.ObjectId.isValid(bId) ? bId : null }]
        });

        if (booking) {
          booking.status = 'FOOD_READY';
          booking.foodReadyAt = new Date();
          await booking.save();

          console.log(`🍲 [SOCKET food_ready] bookingId: ${bId} -> FOOD_READY`);

          const payload = {
            bookingId: booking.bookingId,
            rideId: booking.bookingId,
            status: 'FOOD_READY',
            foodReadyAt: booking.foodReadyAt,
            restaurantName: booking.restaurantName,
            booking: booking.toObject(),
          };

          if (booking.customerId) {
            io.to(`user_${booking.customerId}`).emit('FOOD_READY', payload);
            io.to(`user_${booking.customerId}`).emit('order_status_updated', payload);
            io.to(`user_${booking.customerId}`).emit('booking_status_updated', payload);
          }
          const suppTarget = booking.supplierId || booking.restaurantId;
          if (suppTarget) {
            const suppRooms = getSupplierSocketRooms(suppTarget);
            for (const rm of suppRooms) {
              io.to(rm).emit('FOOD_READY', payload);
              io.to(rm).emit('order_status_updated', payload);
              io.to(rm).emit('booking_status_updated', payload);
            }
          }
          if (booking.providerId) {
            io.to(`user_${booking.providerId}`).emit('FOOD_READY', payload);
            io.to(`user_${booking.providerId}`).emit('order_status_updated', payload);
            io.to(`user_${booking.providerId}`).emit('booking_status_updated', payload);
          }
          io.to(`booking_${booking.bookingId}`).emit('FOOD_READY', payload);
          io.to(`booking_${booking.bookingId}`).emit('order_status_updated', payload);
          io.to(`booking_${booking.bookingId}`).emit('booking_status_updated', payload);
          io.emit('FOOD_READY', payload);
          io.emit('food_ready', payload);
          io.emit('order_status_updated', payload);
          io.emit('booking_status_updated', payload);
        }
      } catch (err) {
        console.error('Error handling socket food_ready:', err);
      }
    });

    // Real-time menu item availability, update & delete socket broadcast relays
    socket.on('menu_item_availability_updated', (data) => {
      console.log('📢 [SOCKET RELAY] menu_item_availability_updated:', data);
      io.emit('MENU_ITEM_AVAILABILITY_UPDATED', data);
      io.emit('menu_item_availability_updated', data);
      io.emit('MENU_UPDATED', { ...(data || {}), action: 'availability_update' });
    });

    socket.on('menu_item_updated', (data) => {
      io.emit('MENU_ITEM_UPDATED', data);
      io.emit('menu_item_updated', data);
    });

    socket.on('menu_item_deleted', (data) => {
      io.emit('MENU_ITEM_DELETED', data);
      io.emit('menu_item_deleted', data);
    });

    // Real-time Support Admin and Ticket Chat Socket Handlers
    socket.on('join_support_admin', (data) => {
      socket.join('support_admin_room');
      console.log(`🎫 [SUPPORT SOCKET] Socket ${socket.id} joined support_admin_room (Admin: ${data?.adminName || 'Agent'})`);
    });

    socket.on('join_ticket_room', (ticketId) => {
      if (ticketId) {
        const room1 = `support_ticket_${ticketId}`;
        const room2 = `ticket_${ticketId}`;
        socket.join(room1);
        socket.join(room2);
        console.log(`🎫 [SUPPORT SOCKET] Socket ${socket.id} joined rooms ${room1}, ${room2}`);
      }
    });

    socket.on('leave_ticket_room', (ticketId) => {
      if (ticketId) {
        socket.leave(`support_ticket_${ticketId}`);
        socket.leave(`ticket_${ticketId}`);
        console.log(`🎫 [SUPPORT SOCKET] Socket ${socket.id} left ticket room ${ticketId}`);
      }
    });

    socket.on('send_support_message', async (data) => {
      try {
        console.log('💬 [SUPPORT SOCKET MESSAGE RECEIVED]:', data);
        const { ticketId, senderId, senderRole, senderName, text, attachments, isInternal } = data || {};
        if (!ticketId || !text) return;

        const SupportCase = require('../models/SupportCase');
        const ticket = await SupportCase.findOne({
          $or: [
            { ticketId: ticketId },
            { caseNumber: ticketId },
            ...(mongoose.Types.ObjectId.isValid(ticketId) ? [{ _id: ticketId }] : [])
          ]
        });

        if (ticket) {
          const messageObj = {
            messageId: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            senderId: String(senderId || socket.userId || 'user'),
            senderRole: senderRole || 'user',
            senderName: senderName || 'User',
            text: text.trim(),
            attachments: attachments || [],
            isInternal: Boolean(isInternal),
            createdAt: new Date(),
            isRead: false,
          };

          ticket.messages.push(messageObj);
          if (['agent', 'admin'].includes(messageObj.senderRole) && !ticket.firstResponseAt) {
            ticket.firstResponseAt = new Date();
            if (ticket.status === 'OPEN' || ticket.status === 'new') {
              ticket.status = 'IN_PROGRESS';
            }
          }
          await ticket.save();

          const payload = {
            ticketId: ticket.ticketId,
            caseNumber: ticket.caseNumber,
            message: messageObj,
            ticketStatus: ticket.status,
          };

          io.to(`support_ticket_${ticket.ticketId}`).emit('support_message_received', payload);
          io.to('support_admin_room').emit('support_message_received', payload);
          io.to(`user_${ticket.requesterId}`).emit('support_message_received', payload);
          io.to(`support_user_${ticket.requesterId}`).emit('support_message_received', payload);
          io.emit('support_message_event', payload);
        }
      } catch (err) {
        console.error('Error in send_support_message socket:', err);
      }
    });

    socket.on('cancel_support_ticket', async (data) => {
      try {
        console.log('🛑 [SOCKET CANCEL SUPPORT TICKET RECEIVED]:', data);
        const { ticketId, caseId, reason = 'Cancelled by requester' } = data || {};
        const tId = ticketId || caseId;
        if (!tId) return;

        const SupportCase = require('../models/SupportCase');
        const ticket = await SupportCase.findOne({
          $or: [
            { ticketId: tId },
            { caseNumber: tId },
            ...(mongoose.Types.ObjectId.isValid(tId) ? [{ _id: tId }] : [])
          ]
        });

        if (ticket) {
          ticket.status = 'CANCELLED';
          ticket.closedAt = new Date();
          ticket.resolutionReason = reason;
          await ticket.save();

          const payload = {
            ticketId: ticket.ticketId,
            caseNumber: ticket.caseNumber,
            status: 'CANCELLED',
            reason,
            cancelledAt: ticket.closedAt,
            ticket,
            case: ticket,
          };

          const eventNames = [
            'support_ticket_cancelled',
            'support_case_cancelled',
            'cancel_support_ticket',
            'support_ticket_status_changed',
            'case_cancelled',
          ];

          const rooms = [
            'support_admin_room',
            `support_ticket_${ticket.ticketId}`,
            `user_${ticket.requesterId}`,
            `support_user_${ticket.requesterId}`,
          ];

          if (ticket.riderId) rooms.push(`user_${ticket.riderId}`);
          if (ticket.customerId) rooms.push(`user_${ticket.customerId}`);
          if (ticket.restaurantId) rooms.push(`user_${ticket.restaurantId}`);

          rooms.forEach((room) => {
            eventNames.forEach((ev) => {
              io.to(room).emit(ev, payload);
            });
          });

          eventNames.forEach((ev) => {
            io.emit(ev, payload);
          });
        }
      } catch (err) {
        console.error('Error in cancel_support_ticket socket:', err);
      }
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${socket.id}`);
      if (socket.userId) {
        const userIdStr = socket.userId.toString();
        if (userSockets.get(userIdStr) === socket.id) {
          userSockets.delete(userIdStr);
        }
        activeCallUsers.delete(userIdStr);
        
        // Clear active speaker timeout and queues if broadcaster disconnects
        if (activeSpeakerTimeoutMap.has(userIdStr)) {
          clearTimeout(activeSpeakerTimeoutMap.get(userIdStr));
          activeSpeakerTimeoutMap.delete(userIdStr);
        }
        liveQueues.delete(userIdStr);

        // Do NOT force restaurant/rider offline on disconnect!
        // Restaurant status persists across back navigation and app refreshes
        // until the restaurant explicitly toggles offline themselves.
        try {
          if (mongoose.Types.ObjectId.isValid(socket.userId)) {
            await User.findByIdAndUpdate(socket.userId, { 
              lastSeen: new Date()
            });
          }
        } catch (err) {
          console.error('Error updating lastSeen on disconnect:', err);
        }
      }
    });
  });
};

module.exports = { 
  socketHandler, 
  userSockets, 
  liveQueues, 
  activeSpeakerTimeoutMap, 
  getLiveQueueFromDB,
  dispatchBookingToEligibleSuppliers,
  scheduleSupplierOrderDispatch,
  onlineRiders,
  pendingRides,
};
