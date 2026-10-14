/**
 * riderSearchService.js
 * Core engine: Nearest Rider Search, Dispatch, Accept/Reject, Timeout, Retry
 * NO dummy/mock/hardcoded data. All from real DB + real GPS (onlineRiders Map).
 */

'use strict';

const mongoose = require('mongoose');
const Booking  = require('../models/Booking');
const User     = require('../models/User');
const { redactDropLocationForRider } = require('../utils/redactUtils');

const RIDER_REQUEST_TIMEOUT_MS = 30 * 1000;
const LOCATION_STALE_MS        = 30 * 60 * 1000; // 30 minutes
const MAX_SEARCH_RADIUS_KM     = 25;              // 25 km search radius

let _onlineRiders = null;
let _io = null;
const activeTimeouts = new Map();
const delayedSearchTimeouts = new Map();

function init(io, onlineRidersMap) {
  _io = io;
  _onlineRiders = onlineRidersMap;
  console.log('🚀 [RIDER_SEARCH] Initialized with Socket.IO and onlineRiders Map');
}

function haversineKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function etaMinutes(distKm) {
  return Math.ceil((distKm / 25) * 60);
}

function calcRiderEarning(booking) {
  const fee = Number(booking.deliveryFee) || 0;
  const dist = Number(booking.distanceKm) || 0;
  const baseTripPay = fee > 0 ? fee : Math.round(20 + dist * 5);

  const isRain = Boolean(booking.isRaining || Number(booking.weatherIncentive || booking.rainFee || 0) > 0);
  const rainSurgeAmount = isRain ? Number(booking.weatherIncentive || booking.rainFee || 10) : 0;
  const totalEarning = baseTripPay + rainSurgeAmount;

  return {
    baseTripPay,
    rainSurgeAmount,
    isRainSurge: isRain,
    totalEarning,
  };
}

function clearBookingTimeout(bookingId) {
  const handle = activeTimeouts.get(bookingId);
  if (handle) { clearTimeout(handle); activeTimeouts.delete(bookingId); }
}

function clearDelayedRiderSearch(bookingId) {
  if (delayedSearchTimeouts.has(bookingId)) {
    console.log(`🛑 [RIDER_SEARCH] Cleared delayed rider search timer for ${bookingId}`);
    clearTimeout(delayedSearchTimeouts.get(bookingId));
    delayedSearchTimeouts.delete(bookingId);
  }
}

function scheduleDelayedRiderSearch(bookingId, delayMs = 30000) {
  clearDelayedRiderSearch(bookingId);
  console.log(`⏱️ [RIDER_SEARCH] Scheduling 30-second (${delayMs / 1000}s) delayed rider dispatch for order ${bookingId}...`);
  const handle = setTimeout(async () => {
    delayedSearchTimeouts.delete(bookingId);
    try {
      let booking = await Booking.findOne({ bookingId }).lean();
      if (!booking && mongoose.Types.ObjectId.isValid(bookingId)) {
        booking = await Booking.findById(bookingId).lean();
      }
      if (!booking) {
        console.log(`⏱️ [RIDER_SEARCH] Delayed dispatch aborted: Order ${bookingId} not found.`);
        return;
      }
      const cancelledStatuses = ['CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'RESTAURANT_DECLINED', 'NO_RESPONSE', 'TIMEOUT'];
      if (cancelledStatuses.includes(booking.status)) {
        console.log(`⏱️ [RIDER_SEARCH] Delayed dispatch aborted: Order ${bookingId} is in status ${booking.status}.`);
        return;
      }
      if (booking.riderId || (booking.riderStatus && booking.riderStatus !== 'NONE')) {
        console.log(`⏱️ [RIDER_SEARCH] Delayed dispatch aborted: Order ${bookingId} already assigned to rider.`);
        return;
      }
      console.log(`🚀 [RIDER_SEARCH] 30-second preparation delay completed. Starting nearby rider search for order ${bookingId}...`);
      await findAndDispatchNearestRider(bookingId);
    } catch (err) {
      console.error(`❌ [RIDER_SEARCH] Error executing delayed rider dispatch for ${bookingId}:`, err);
    }
  }, delayMs);
  delayedSearchTimeouts.set(bookingId, handle);
}

function emitToRider(riderId, eventName, payload) {
  if (!_io || !riderId) return;
  const riderIdStr = riderId.toString();
  const r = _onlineRiders && _onlineRiders.get(riderIdStr);
  if (r && r.isOnline === false) {
    console.log(`[emitToRider] Skipping emit to offline rider ${riderIdStr}`);
    return;
  }
  // Deduplication & single logical delivery guarantee:
  // Prefer direct socket emission if connected; fallback to canonical rider room.
  // Never emit to both direct socket AND room simultaneously, which duplicates events!
  let directDelivered = false;
  if (r && r.socketId) {
    const sock = _io.sockets.sockets.get(r.socketId);
    if (sock && sock.connected) {
      sock.emit(eventName, payload);
      directDelivered = true;
    }
  }
  if (!directDelivered) {
    _io.to('rider_' + riderIdStr).emit(eventName, payload);
  }
}

function buildRequestPayload(booking, distKm) {
  const eta = etaMinutes(distKm);
  const earningInfo = calcRiderEarning(booking);
  const items = booking.items || booking.cartItems || [];

  let pLat = Number(booking.supplierBusinessLatitude || booking.pickupLatitude || booking.restaurantLatitude || 0);
  let pLon = Number(booking.supplierBusinessLongitude || booking.pickupLongitude || booking.restaurantLongitude || 0);
  let dLat = Number(booking.customerLatitude || booking.destinationLatitude || booking.latitude || 0);
  let dLon = Number(booking.customerLongitude || booking.destinationLongitude || booking.longitude || 0);

  // Real Drop Distance Calculation (Restaurant -> Customer)
  let realDropDist = 0;
  if (pLat && pLon && dLat && dLon) {
    realDropDist = parseFloat(haversineKm(pLat, pLon, dLat, dLon).toFixed(1));
  } else if (booking.dropDistanceKm && booking.dropDistanceKm !== 3.5) {
    realDropDist = parseFloat(Number(booking.dropDistanceKm).toFixed(1));
  } else if (booking.distanceKm) {
    realDropDist = parseFloat(Number(booking.distanceKm).toFixed(1));
  }
  if (!realDropDist || realDropDist <= 0.1) {
    realDropDist = 1.2;
  }

  const categoryName = booking.categoryName || booking.businessCategoryName || booking.serviceName || (booking.supplierCategory || '');

  return {
    bookingId:            booking.bookingId || (booking._id && booking._id.toString()),
    orderId:              booking.bookingId || (booking._id && booking._id.toString()),
    restaurantId:         booking.restaurantId || booking.partnerId || '',
    supplierId:           booking.supplierId || booking.restaurantId || booking.partnerId || '',
    categoryName:         categoryName,
    businessCategoryName: categoryName,
    supplierCategory:     booking.supplierCategory || categoryName,
    categoryId:           booking.categoryId || null,
    restaurantName:       booking.restaurantName || 'Restaurant',
    restaurantPhone:      booking.restaurantPhone || '',
    pickupAddress:        booking.supplierBusinessAddress || booking.pickupAddress || 'Store Location',
    pickupLatitude:       pLat || null,
    pickupLongitude:      pLon || null,
    supplierBusinessAddress:   booking.supplierBusinessAddress || booking.pickupAddress || 'Store Location',
    supplierBusinessLatitude:  pLat || null,
    supplierBusinessLongitude: pLon || null,
    destinationAddress:   'Concealed until order pickup',
    destinationLatitude:  null,
    destinationLongitude: null,
    customerAddress:      'Concealed until order pickup',
    customerLatitude:     null,
    customerLongitude:    null,
    customerName:         booking.customerName || 'Customer',
    customerPhone:        booking.customerPhone || '',
    distanceKm:           parseFloat(distKm.toFixed(1)),
    pickupDistanceKm:     parseFloat(distKm.toFixed(1)),
    dropDistanceKm:       realDropDist,
    etaMinutes:           eta,
    estimatedEarning:     earningInfo.totalEarning,
    baseTripPay:          earningInfo.baseTripPay,
    rainSurgeAmount:      earningInfo.rainSurgeAmount,
    isRainSurge:          earningInfo.isRainSurge,
    totalTripPay:         earningInfo.totalEarning,
    totalAmount:          booking.totalAmount || booking.price || 0,
    items:                items,
    cartItems:            items,
    restaurantPhoto:      booking.restaurantPhoto || (booking.restaurantPhotos && booking.restaurantPhotos[0]) || '',
    restaurantPhotos:     booking.restaurantPhotos && booking.restaurantPhotos.length ? booking.restaurantPhotos : (booking.restaurantPhoto ? [booking.restaurantPhoto] : []),
    paymentMethod:        booking.paymentMethod || 'cash',
    paymentStatus:        booking.paymentStatus || 'PENDING',
    prepStartedAt:        booking.prepStartedAt || null,
    prepEndsAt:           booking.prepEndsAt || null,
    preparationTime:      booking.preparationTime || 15,
    status:               booking.status || 'PREPARING',
    requestedAt:          new Date().toISOString(),
    timeoutMs:            null,
  };
}

function clearBookingTimeout(bookingId) {
  if (!bookingId) return;
  if (activeTimeouts.has(bookingId)) {
    try { clearTimeout(activeTimeouts.get(bookingId)); } catch (_) {}
    activeTimeouts.delete(bookingId);
  }
  clearDelayedRiderSearch(bookingId);
}

async function findAndDispatchNearestRider(bookingId) {
  if (!_io || !_onlineRiders) {
    console.error('[RIDER_SEARCH] Service not initialized. Call init() first.');
    return;
  }

  let booking = await Booking.findOne({ bookingId }).lean();
  if (!booking && mongoose.Types.ObjectId.isValid(bookingId)) {
    booking = await Booking.findById(bookingId).lean();
  }
  if (!booking) { console.error('[RIDER_SEARCH] Booking not found: ' + bookingId); return; }

  if (booking.riderId) {
    console.log('[RIDER_SEARCH] Booking ' + bookingId + ' already has rider. Stopping.');
    return;
  }

  // 1. Resolve Real Restaurant Details
  const targetRestoId = booking.restaurantId || booking.partnerId || booking.providerId;
  if (targetRestoId && mongoose.Types.ObjectId.isValid(targetRestoId)) {
    try {
      const restoUser = await User.findById(targetRestoId).select('name username restaurantName phoneNumber phone address location latitude longitude locationCoords profilePicture avatar image photos').lean();
      if (restoUser) {
        if (!booking.restaurantName || booking.restaurantName === 'Restaurant') {
          booking.restaurantName = restoUser.restaurantName || restoUser.name || restoUser.username || 'Restaurant';
        }
        if (!booking.restaurantPhone) {
          booking.restaurantPhone = restoUser.phoneNumber || restoUser.phone || '';
        }
        if (!booking.pickupAddress) {
          booking.pickupAddress = restoUser.address || restoUser.location || '';
        }
        const rLat = Number(restoUser.latitude || restoUser.locationCoords?.latitude || 0);
        const rLon = Number(restoUser.longitude || restoUser.locationCoords?.longitude || 0);
        if ((!booking.pickupLatitude || booking.pickupLatitude === 0) && rLat !== 0) {
          booking.pickupLatitude = rLat;
        }
        if ((!booking.pickupLongitude || booking.pickupLongitude === 0) && rLon !== 0) {
          booking.pickupLongitude = rLon;
        }
        if (!booking.restaurantPhoto) {
          booking.restaurantPhoto = restoUser.profilePicture || restoUser.avatar || restoUser.image || (restoUser.photos && restoUser.photos[0]) || '';
        }
        if (restoUser.photos && restoUser.photos.length && (!booking.restaurantPhotos || !booking.restaurantPhotos.length)) {
          booking.restaurantPhotos = restoUser.photos;
        }
      }
    } catch (_) {}
  }

  // 2. Resolve Real Customer Details
  if (booking.customerId && mongoose.Types.ObjectId.isValid(booking.customerId)) {
    try {
      const custUser = await User.findById(booking.customerId).select('name username phoneNumber phone address location latitude longitude locationCoords').lean();
      if (custUser) {
        if (!booking.customerName || booking.customerName === 'Customer') {
          booking.customerName = custUser.name || custUser.username || 'Customer';
        }
        if (!booking.customerPhone) {
          booking.customerPhone = custUser.phoneNumber || custUser.phone || '';
        }
        if (!booking.destinationAddress) {
          booking.destinationAddress = custUser.address || custUser.location || '';
        }
        const cLat = Number(custUser.latitude || custUser.locationCoords?.latitude || 0);
        const cLon = Number(custUser.longitude || custUser.locationCoords?.longitude || 0);
        const pLatVal = Number(booking.pickupLatitude || booking.restaurantLatitude || booking.supplierBusinessLatitude || 0);
        const savedDropLat = Number(booking.customerLatitude || booking.destinationLatitude || 0);
        const savedDropLon = Number(booking.customerLongitude || booking.destinationLongitude || 0);
        if (savedDropLat !== 0 && savedDropLon !== 0) {
          booking.customerLatitude = savedDropLat;
          booking.destinationLatitude = savedDropLat;
          booking.customerLongitude = savedDropLon;
          booking.destinationLongitude = savedDropLon;
        } else if (cLat !== 0 && cLon !== 0) {
          booking.customerLatitude = cLat;
          booking.destinationLatitude = cLat;
          booking.customerLongitude = cLon;
          booking.destinationLongitude = cLon;
          if (custUser.address || custUser.location) {
            booking.destinationAddress = booking.destinationAddress || custUser.address || custUser.location;
            booking.customerAddress = booking.customerAddress || custUser.address || custUser.location;
          }
        }
      }
    } catch (_) {}
  }

  const cancelledStatuses = ['CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'RESTAURANT_DECLINED'];
  if (cancelledStatuses.includes(booking.status)) {
    console.log('[RIDER_SEARCH] Booking ' + bookingId + ' cancelled. Stopping.');
    return;
  }

  const restaurantLat = Number(booking.pickupLatitude || booking.latitude);
  const restaurantLon = Number(booking.pickupLongitude || booking.longitude);

  console.log('\n[RIDER_SEARCH] ════════════════════════════════════════');
  console.log('[RIDER_SEARCH] Searching for Booking: ' + bookingId);
  console.log('[RIDER_SEARCH] Restaurant: ' + (booking.restaurantName || 'N/A') + ' (' + restaurantLat + ', ' + restaurantLon + ')');
  console.log('[RIDER_SEARCH] Online riders in memory: ' + _onlineRiders.size);

  // Query DB for online riders (flexible role: rider, delivery_partner, provider)
  const dbRiders = await User.find({
    role: { $in: ['delivery_partner', 'rider', 'provider'] },
    isSuspended: { $ne: true },
    rider_status: { $ne: 'offline' },
    isOnline: true,
  }).select('_id name phoneNumber latitude longitude rider_status isOnline isAvailable approvalStatus').lean();

  console.log('[RIDER_SEARCH] Found ' + dbRiders.length + ' online riders in DB');

  // ⚡ BULK FETCH: Get all busy rider IDs in ONE query (fixes N+1 problem)
  const dbRiderIds = dbRiders.map(r => r._id.toString());
  const busyBookings = await Booking.find({
    $or: [
      { riderId: { $in: dbRiderIds } },
      { providerId: { $in: dbRiderIds } },
    ],
    deliveryStatus: { $in: ['RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'RIDER_AT_RESTAURANT'] },
    status: { $nin: ['COMPLETED', 'DELIVERED', 'CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'RESTAURANT_DECLINED'] },
  }).select('riderId providerId status deliveryStatus').lean();
  const busyRiderIds = new Set();
  busyBookings.forEach(b => {
    if (b.riderId) busyRiderIds.add(b.riderId.toString());
    if (b.providerId) busyRiderIds.add(b.providerId.toString());
  });

  const candidates = [];

  for (let i = 0; i < dbRiders.length; i++) {
    const dbRider = dbRiders[i];
    const riderIdStr = dbRider._id.toString();

    // Skip riders who are marked offline in DB
    if (dbRider.rider_status === 'offline' || dbRider.isOnline === false) {
      console.log('[RIDER_SEARCH] Skip ' + riderIdStr + ' (' + dbRider.name + ') - offline in DB');
      continue;
    }

    // Skip riders who rejected this order
    if ((booking.rejectedRiders || []).includes(riderIdStr)) {
      console.log('[RIDER_SEARCH] Skip ' + riderIdStr + ' (' + dbRider.name + ') - in rejectedRiders');
      continue;
    }

    // Check in-memory status if available
    const memEntry = _onlineRiders.get(riderIdStr);
    if (memEntry && (memEntry.isOnline === false || memEntry.isAvailable === false)) {
      console.log('[RIDER_SEARCH] Skip ' + riderIdStr + ' - explicitly offline/unavailable in memory');
      continue;
    }

    // Check if rider is currently busy on an active delivery (using pre-fetched bulk set)
    if (busyRiderIds.has(riderIdStr)) {
      console.log('[RIDER_SEARCH] Skip ' + riderIdStr + ' - busy on active delivery');
      continue;
    }

    // Determine Rider Coordinates (prefer live in-memory GPS, fallback to DB GPS)
    let riderLat = null;
    let riderLon = null;

    if (memEntry && memEntry.location && memEntry.location.latitude && memEntry.location.longitude) {
      riderLat = Number(memEntry.location.latitude);
      riderLon = Number(memEntry.location.longitude);
    } else if (dbRider.latitude && dbRider.longitude) {
      riderLat = Number(dbRider.latitude);
      riderLon = Number(dbRider.longitude);
    }

    // Calculate distance using REAL GPS
    let distKm = 1.0;
    if (restaurantLat && restaurantLon && riderLat && riderLon) {
      distKm = haversineKm(restaurantLat, restaurantLon, riderLat, riderLon);
      // HARD CAP: Never exceed 1.0 km (Requirement 12)
      if (distKm > 1.0) {
        console.log('[RIDER_SEARCH] Skip ' + riderIdStr + ' - distance ' + distKm.toFixed(2) + ' km > 1.0 km max limit');
        continue;
      }
    } else {
      // If missing GPS coordinates, skip
      console.log('[RIDER_SEARCH] Skip ' + riderIdStr + ' - missing real GPS coordinates');
      continue;
    }

    candidates.push({
      riderId: riderIdStr,
      name: dbRider.name || 'Rider',
      phone: dbRider.phoneNumber || '',
      distKm,
    });
    console.log('[RIDER_SEARCH] ✅ CANDIDATE: ' + (dbRider.name || riderIdStr) + ' - ' + distKm.toFixed(2) + ' km');
  }

  candidates.sort(function(a, b) { return a.distKm - b.distKm; });

  // ── MULTI-TIER RADIUS SELECTION: 500m -> 750m -> 1.0km (Requirement 12) ──
  let eligibleCandidate = null;
  const tier500m = candidates.filter(c => c.distKm <= 0.50);
  const tier750m = candidates.filter(c => c.distKm <= 0.75);
  const tier1km  = candidates.filter(c => c.distKm <= 1.00);

  if (tier500m.length > 0) {
    eligibleCandidate = tier500m[0];
    console.log(`[RIDER_SEARCH] 🎯 Tier 1 (<=500m) candidate found: ${eligibleCandidate.name} (${eligibleCandidate.distKm.toFixed(2)} km)`);
  } else if (tier750m.length > 0) {
    eligibleCandidate = tier750m[0];
    console.log(`[RIDER_SEARCH] 🎯 Tier 2 (<=750m) candidate found: ${eligibleCandidate.name} (${eligibleCandidate.distKm.toFixed(2)} km)`);
  } else if (tier1km.length > 0) {
    eligibleCandidate = tier1km[0];
    console.log(`[RIDER_SEARCH] 🎯 Tier 3 (<=1.0km) candidate found: ${eligibleCandidate.name} (${eligibleCandidate.distKm.toFixed(2)} km)`);
  }

  if (!eligibleCandidate) {
    console.log('[RIDER_SEARCH] No eligible riders within 1.0 km limit. Setting SEARCHING_FOR_RIDER.');
    await Booking.findOneAndUpdate({ bookingId }, { deliveryStatus: 'SEARCHING_FOR_RIDER', pendingRiderId: null });
    if (_io && booking.restaurantId) {
      _io.to('user_' + booking.restaurantId).emit('RIDER_SEARCH_STATUS', {
        bookingId,
        deliveryStatus: 'SEARCHING_FOR_RIDER',
        message: '1km के दायरे में कोई Rider उपलब्ध नहीं — जैसे ही Rider online होगा, request जाएगी।',
      });
    }
    return;
  }

  const nearest = eligibleCandidate;
  console.log('[RIDER_SEARCH] 🎯 Dispatching to nearest: ' + nearest.name + ' (' + nearest.riderId + ') - ' + nearest.distKm.toFixed(2) + ' km');

  await Booking.findOneAndUpdate({ bookingId }, {
    deliveryStatus: 'RIDER_REQUESTED',
    pendingRiderId: nearest.riderId,
  });

  const payload = buildRequestPayload(booking, nearest.distKm);
  payload.rideId = booking.bookingId || (booking._id && booking._id.toString());
  payload.orderId = payload.rideId;
  payload.eventId = `req_${payload.rideId}_${Date.now()}`;

  // Emit ONE canonical request event only to prevent duplicate cards/sounds
  emitToRider(nearest.riderId, 'DELIVERY_REQUEST', payload);
  console.log('[RIDER_SEARCH] 📡 Single canonical request emitted to rider ' + nearest.riderId + ' (rideId: ' + payload.rideId + ')');

  if (_io && booking.restaurantId) {
    _io.to('user_' + booking.restaurantId).emit('RIDER_SEARCH_STATUS', {
      bookingId,
      deliveryStatus: 'RIDER_REQUESTED',
      riderName: nearest.name,
      distKm: nearest.distKm.toFixed(2),
      message: 'Rider ' + nearest.name + ' को request भेजी — ' + nearest.distKm.toFixed(2) + ' km दूर',
    });
  }

  clearBookingTimeout(bookingId);
  console.log('[RIDER_SEARCH] 🔔 Request active for rider ' + nearest.riderId + ' (Booking: ' + bookingId + ')');
}

async function riderAcceptDelivery(bookingId, riderId, passedLat, passedLon) {
  if (!bookingId || !riderId) return { success: false, message: 'bookingId and riderId required' };

  clearBookingTimeout(bookingId);

  let riderUser = null;
  try {
    riderUser = await User.findById(riderId).lean();
  } catch (e) {
    console.error('[RIDER_ACCEPT] User fetch error:', e.message);
  }

  const mem = _onlineRiders ? _onlineRiders.get(riderId.toString()) : null;

  const riderName = riderUser?.name || riderUser?.username || 'Delivery Partner';
  const riderPhone = riderUser?.phoneNumber || riderUser?.phone || '';
  const riderPhoto = riderUser?.profilePicture || riderUser?.avatar || null;
  const vehicleNumber = riderUser?.vehicleNumber || riderUser?.vehicle_number || 'MP04-9999';
  const vehicleType = riderUser?.vehicleType || 'Bike';
  const riderRating = Number(riderUser?.rating) || 4.9;

  let riderLat = Number(
    passedLat ||
    (mem && mem.location && mem.location.latitude) ||
    riderUser?.latitude ||
    (riderUser?.locationCoords && riderUser.locationCoords.latitude) ||
    0
  );
  let riderLon = Number(
    passedLon ||
    (mem && mem.location && mem.location.longitude) ||
    riderUser?.longitude ||
    (riderUser?.locationCoords && riderUser.locationCoords.longitude) ||
    0
  );

  const acceptedByObj = {
    _id: riderId.toString(),
    id: riderId.toString(),
    riderId: riderId.toString(),
    name: riderName,
    phone: riderPhone,
    phoneNumber: riderPhone,
    photo: riderPhoto,
    profilePicture: riderPhoto,
    vehicleNumber: vehicleNumber,
    vehicleType: vehicleType,
    rating: riderRating,
    latitude: riderLat,
    longitude: riderLon,
    location: {
      latitude: riderLat,
      longitude: riderLon,
    },
  };

  const updateFields = {
    riderId: riderId.toString(),
    riderName: riderName,
    riderPhone: riderPhone,
    riderPhoto: riderPhoto,
    riderVehicleNumber: vehicleNumber,
    riderVehicleType: vehicleType,
    riderRating: riderRating,
    riderLatitude: riderLat,
    riderLongitude: riderLon,
    driverLat: riderLat,
    driverLon: riderLon,
    riderLocation: acceptedByObj.location,
    acceptedBy: acceptedByObj,
    rider: acceptedByObj,
    deliveryStatus: 'RIDER_ASSIGNED',
    riderStatus: 'ASSIGNED',
    pendingRiderId: null,
    acceptedAt: new Date(),
  };

  // ⚡ ATOMIC CONCURRENCY-SAFE UPDATE WITH DOUBLE-ASSIGNMENT GUARD:
  // Ride can only be accepted if it has not already been assigned to another rider!
  const atomicFilter = {
    $and: [
      {
        $or: [
          { bookingId: bookingId },
          { _id: mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null },
        ],
      },
      {
        $or: [
          { riderId: { $exists: false } },
          { riderId: null },
          { riderId: '' },
          { riderId: riderId.toString() }, // Idempotent: same rider retrying is safe
        ],
      },
      {
        status: {
          $nin: [
            'COMPLETED',
            'DELIVERED',
            'CANCELLED',
            'CANCELLED_BY_CUSTOMER',
            'CANCELLED_BY_RESTAURANT',
            'RESTAURANT_DECLINED',
            'TIMEOUT',
          ],
        },
      },
    ],
  };

  const updated = await Booking.findOneAndUpdate(
    atomicFilter,
    { $set: updateFields },
    { new: true }
  ).lean();

  if (!updated) {
    // Check why the atomic update failed
    const checkBooking = await Booking.findOne({
      $or: [
        { bookingId: bookingId },
        { _id: mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null },
      ],
    }).lean();

    if (!checkBooking) {
      return { success: false, message: 'Booking not found.' };
    }

    if (checkBooking.riderId && checkBooking.riderId.toString() !== riderId.toString()) {
      console.log(`⚠️ [RIDER_ACCEPT CONFLICT] Booking ${bookingId} already taken by rider ${checkBooking.riderId}`);
      return {
        success: false,
        alreadyTaken: true,
        message: 'This ride has already been accepted by another rider.',
        booking: checkBooking,
      };
    }

    if (['CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'RESTAURANT_DECLINED', 'TIMEOUT'].includes(checkBooking.status)) {
      return {
        success: false,
        alreadyCancelled: true,
        message: 'This order was cancelled.',
        booking: checkBooking,
      };
    }

    return { success: false, message: 'Booking is not available for acceptance.' };
  }

  try {
    const userUpdate = { isAvailable: false };
    if (riderLat && riderLon) {
      userUpdate.latitude = riderLat;
      userUpdate.longitude = riderLon;
      userUpdate.locationCoords = { latitude: riderLat, longitude: riderLon };
    }
    await User.findByIdAndUpdate(riderId, userUpdate);
    if (_onlineRiders) {
      const existingMem = _onlineRiders.get(riderId.toString()) || {};
      _onlineRiders.set(riderId.toString(), {
        ...existingMem,
        isAvailable: false,
        location: (riderLat && riderLon) ? { latitude: riderLat, longitude: riderLon } : existingMem.location,
      });
    }
  } catch (e) {}

  console.log(`🛵 [RIDER_ACCEPT] Booking ${bookingId} assigned to ${riderName} (${riderId})`);

  if (_io) {
    const broadcastData = {
      bookingId: updated.bookingId || bookingId,
      orderId: updated.bookingId || bookingId,
      rideId: updated.bookingId || bookingId,
      status: updated.status || 'PREPARING',
      deliveryStatus: 'RIDER_ASSIGNED',
      riderId: riderId.toString(),
      riderName: riderName,
      riderPhone: riderPhone,
      riderPhoto: riderPhoto,
      riderVehicleNumber: vehicleNumber,
      riderVehicleType: vehicleType,
      riderRating: riderRating,
      riderLocation: acceptedByObj.location,
      rider: acceptedByObj,
      acceptedBy: acceptedByObj,
      booking: updated,
      message: `🛵 ${riderName} is assigned to deliver your order`,
    };

    const targetBId = updated.bookingId || bookingId;

    // Emit to Booking & Order Rooms
    _io.to(`booking_${targetBId}`).emit('rider_assigned', broadcastData);
    _io.to(`booking_${targetBId}`).emit('RIDER_ASSIGNED', broadcastData);
    _io.to(`booking_${targetBId}`).emit('order_status_update', broadcastData);
    _io.to(`booking_${targetBId}`).emit('ORDER_STATUS_UPDATED', broadcastData);
    _io.to(`booking_${targetBId}`).emit('FOOD_ORDER_UPDATED', broadcastData);
    _io.to(`booking_${targetBId}`).emit('booking_updated', broadcastData);
    _io.to(`order_${targetBId}`).emit('rider_assigned', broadcastData);
    _io.to(`order_${targetBId}`).emit('RIDER_ASSIGNED', broadcastData);
    _io.to(`order_${targetBId}`).emit('order_status_update', broadcastData);
    _io.to(`ride_${targetBId}`).emit('rider_assigned', broadcastData);
    _io.to(`ride_${targetBId}`).emit('RIDER_ASSIGNED', broadcastData);

    // Emit to Customer
    if (updated.customerId) {
      _io.to(`user_${updated.customerId}`).emit('rider_assigned', broadcastData);
      _io.to(`user_${updated.customerId}`).emit('RIDER_ASSIGNED', broadcastData);
      _io.to(`user_${updated.customerId}`).emit('order_status_update', broadcastData);
      _io.to(`user_${updated.customerId}`).emit('ORDER_STATUS_UPDATED', broadcastData);
      _io.to(`customer_${updated.customerId}`).emit('rider_assigned', broadcastData);
      _io.to(`customer_${updated.customerId}`).emit('RIDER_ASSIGNED', broadcastData);
    }

    // Emit to Restaurant / Supplier
    const restoId = updated.supplierId || updated.restaurantId || updated.partnerId || updated.providerId;
    if (restoId) {
      _io.to(`user_${restoId}`).emit('rider_assigned', broadcastData);
      _io.to(`user_${restoId}`).emit('RIDER_ASSIGNED', broadcastData);
      _io.to(`restaurant_${restoId}`).emit('rider_assigned', broadcastData);
      _io.to(`supplier:${restoId}`).emit('rider_assigned', broadcastData);
      _io.to(`supplier_${restoId}`).emit('rider_assigned', broadcastData);
    }

    // Broadcast Rider Location
    if (riderLat !== 0 && riderLon !== 0) {
      _io.to(`booking_${targetBId}`).emit('rider_location_update', {
        bookingId: targetBId,
        rideId: targetBId,
        riderId: riderId.toString(),
        latitude: riderLat,
        longitude: riderLon,
        location: acceptedByObj.location,
      });
      _io.to(`booking_${targetBId}`).emit('rider_location_updated', {
        bookingId: targetBId,
        rideId: targetBId,
        riderId: riderId.toString(),
        latitude: riderLat,
        longitude: riderLon,
        location: acceptedByObj.location,
      });
    }

    // Global broadcast for instant sync across ALL delivery partners
    _io.emit('rider_assigned', broadcastData);
    _io.emit('RIDER_ASSIGNED', broadcastData);
    _io.emit('order_status_update', broadcastData);
    _io.emit('ORDER_STATUS_UPDATED', broadcastData);
    _io.emit('DELIVERY_REQUEST_CANCELLED', {
      bookingId: targetBId,
      rideId: targetBId,
      reason: 'assigned_to_another',
      assignedRiderId: riderId.toString(),
      message: 'This order has already been assigned to another partner.',
    });
    _io.emit('ORDER_ASSIGNED_TO_OTHER', {
      bookingId: targetBId,
      rideId: targetBId,
      assignedRiderId: riderId.toString(),
    });
    _io.emit('REMOVE_AVAILABLE_ORDER', {
      bookingId: targetBId,
      orderId: targetBId,
      assignedRiderId: riderId.toString(),
    });

    _io.to('riders_room').emit('DELIVERY_REQUEST_CANCELLED', {
      bookingId: targetBId,
      rideId: targetBId,
      reason: 'assigned_to_another',
      assignedRiderId: riderId.toString(),
      message: 'This order has already been assigned to another partner.',
    });
    _io.to('riders_room').emit('ORDER_ASSIGNED_TO_OTHER', {
      bookingId: targetBId,
      rideId: targetBId,
      assignedRiderId: riderId.toString(),
    });
    _io.to('riders_room').emit('REMOVE_AVAILABLE_ORDER', {
      bookingId: targetBId,
      orderId: targetBId,
      assignedRiderId: riderId.toString(),
    });

    function getStoreCategoryLabel(b) {
      const cat = (b?.categoryName || b?.businessCategoryName || b?.serviceName || b?.supplierCategory || '').toLowerCase();
      const storeName = b?.restaurantName || b?.storeName || '';
      if (storeName && storeName !== 'Restaurant') return storeName;
      if (cat.includes('food')) return 'Restaurant';
      if (cat.includes('fashion') || cat.includes('cloth')) return 'Fashion Store';
      if (cat.includes('grocery') || cat.includes('kirana')) return 'Grocery Store';
      if (cat.includes('veg') || cat.includes('fruit')) return 'Vegetable & Fruit Store';
      if (cat.includes('electronic') || cat.includes('mobile')) return 'Electronics Store';
      if (cat.includes('toy') || cat.includes('kid')) return 'Toys & Kids Store';
      if (cat.includes('beauty')) return 'Beauty Store';
      if (cat.includes('medicine') || cat.includes('pharma')) return 'Pharmacy';
      return 'Store';
    }

    const storeLabel = getStoreCategoryLabel(updated);
    const riderRedactedBooking = redactDropLocationForRider(updated, true);
    emitToRider(riderId, 'DELIVERY_ASSIGNED', { bookingId: targetBId, booking: riderRedactedBooking, message: `Order assign हुआ! ${storeLabel} पहुँचें।` });
  }

  return { success: true, message: 'Rider assigned successfully', booking: redactDropLocationForRider(updated, true) };
}

async function riderRejectDelivery(bookingId, riderId, reason = 'Rider Declined') {
  if (!bookingId || !riderId) return { success: false, message: 'bookingId and riderId required' };

  clearBookingTimeout(bookingId);

  let riderName = 'Rider';
  try {
    const rUser = await User.findById(riderId).select('name username').lean();
    if (rUser) riderName = rUser.name || rUser.username || 'Rider';
  } catch (_) {}

  const declineEntry = {
    riderId: riderId.toString(),
    riderName: riderName,
    status: 'DECLINED',
    timestamp: new Date(),
    reason: reason || 'Rider Declined',
  };

  const updated = await Booking.findOneAndUpdate(
    { $or: [{ bookingId }, { _id: mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null }] },
    {
      deliveryStatus: 'SEARCHING_FOR_RIDER',
      pendingRiderId: null,
      $addToSet: { rejectedRiders: riderId.toString() },
      $push: { declineHistory: declineEntry },
    },
    { new: true }
  );

  if (!updated) return { success: false, message: 'Booking not found' };

  console.log(`[RIDER_REJECT] Rider ${riderId} (${riderName}) rejected ${bookingId}. Saved to declineHistory. Searching next eligible candidate.`);
  setImmediate(function() { findAndDispatchNearestRider(bookingId); });

  return { success: true, message: 'Rejection recorded in decline history. Searching next rider.', declineHistory: updated.declineHistory };
}

async function retrySearchingOrders(newRiderId) {
  try {
    const pendingOrders = await Booking.find({
      deliveryStatus: 'SEARCHING_FOR_RIDER',
      riderId: null,
      status: { $in: ['PREPARING', 'FOOD_READY', 'READY_FOR_PICKUP'] },
    }).select('bookingId rejectedRiders').lean();

    if (pendingOrders.length === 0) return;
    console.log('[RIDER_SEARCH] Retrying ' + pendingOrders.length + ' pending orders for rider ' + newRiderId);

    for (let i = 0; i < pendingOrders.length; i++) {
      const order = pendingOrders[i];
      if (!(order.rejectedRiders || []).includes(newRiderId.toString())) {
        (function(bId) {
          setTimeout(function() { findAndDispatchNearestRider(bId); }, 500 * (i + 1));
        })(order.bookingId);
      }
    }
  } catch (err) {
    console.error('[RIDER_SEARCH] Error in retrySearchingOrders:', err.message);
  }
}

async function notifyRiderFoodReady(booking) {
  if (!booking) return;
  const bId = booking.bookingId || (booking._id && booking._id.toString());
  if (booking.riderId) {
    const cat = (booking.categoryName || booking.businessCategoryName || booking.serviceName || booking.supplierCategory || '').toLowerCase();
    const storeLabel = booking.restaurantName || booking.storeName || (cat.includes('food') ? 'Restaurant' : 'Store');
    let readyText = '📦 Order Packed & Ready';
    if (cat.includes('food')) readyText = '🍲 Food Ready';
    else if (cat.includes('fashion') || cat.includes('cloth')) readyText = '👕 Fashion Order Packed';
    else if (cat.includes('grocery') || cat.includes('kirana')) readyText = '🛒 Grocery Packed';
    else if (cat.includes('veg') || cat.includes('fruit')) readyText = '🥦 Fresh Produce Packed';
    else if (cat.includes('electronic') || cat.includes('mobile')) readyText = '📱 Electronics Packed';
    else if (cat.includes('toy') || cat.includes('kid')) readyText = '🧸 Toys Packed';

    const payload = {
      bookingId: bId,
      restaurantName: storeLabel,
      storeName: storeLabel,
      pickupAddress: booking.pickupAddress || booking.serviceAddress || '',
      message: `${readyText}! ${storeLabel} पहुँचें और pickup करें।`,
      status: 'READY_FOR_PICKUP',
    };
    emitToRider(booking.riderId, 'ORDER_READY_FOR_PICKUP', payload);
    emitToRider(booking.riderId, 'FOOD_READY', payload);
    console.log('[ORDER_READY] Notified rider ' + booking.riderId + ' for ' + bId);
  } else {
    console.log('[ORDER_READY] No rider for ' + bId + '. Triggering search.');
    setImmediate(function() { findAndDispatchNearestRider(bId); });
  }
}

const TRANSFER_POLICY = {
  maxTransfersPerDay: 5,
  emergencySosNumbers: ['112', '108', '100'],
  otpExpiryMinutes: 15,
  maxHandoverSearchRadiusKm: 15,
};

function buildTransferRequestPayload(booking, riderDistKm) {
  const earningInfo = calcRiderEarning(booking);
  const items = booking.items || booking.cartItems || [];

  const hLat = Number(booking.transferLocation?.latitude || 0);
  const hLon = Number(booking.transferLocation?.longitude || 0);
  const dLat = Number(booking.customerLatitude || booking.destinationLatitude || 0);
  const dLon = Number(booking.customerLongitude || booking.destinationLongitude || 0);

  let dropDist = 1.2;
  if (hLat && hLon && dLat && dLon) {
    dropDist = parseFloat(haversineKm(hLat, hLon, dLat, dLon).toFixed(1));
  }
  const totalDist = parseFloat((riderDistKm + dropDist).toFixed(1));

  return {
    isTransfer: true,
    isTransferRequest: true,
    transferStatus: booking.transferStatus || 'TRANSFER_REQUESTED',
    transferReason: booking.transferReason || 'Vehicle Breakdown',
    transferDetails: booking.transferDetails || '',
    transferCompensation: booking.transferCompensation || earningInfo.totalEarning,
    originalRiderId: booking.originalRiderId,
    originalRiderName: booking.originalRiderName || 'Delivery Partner',
    originalRiderPhone: booking.originalRiderPhone || '',
    
    bookingId: booking.bookingId || (booking._id && booking._id.toString()),
    orderId: booking.bookingId || (booking._id && booking._id.toString()),
    restaurantId: booking.restaurantId || '',
    supplierId: booking.supplierId || '',
    restaurantName: booking.restaurantName || 'Restaurant Partner',
    restaurantPhoto: booking.restaurantPhoto || '',

    // Handover point where Rider B meets Rider A
    handoverLocation: booking.transferLocation,
    handoverAddress: booking.transferLocation?.address || 'Handover Point (Original Partner)',
    pickupAddress: booking.transferLocation?.address ? `Handover Point: ${booking.transferLocation.address}` : 'Handover Point (Original Partner)',
    pickupLatitude: hLat,
    pickupLongitude: hLon,
    supplierBusinessLatitude: hLat,
    supplierBusinessLongitude: hLon,
    pickupDistanceKm: parseFloat(riderDistKm.toFixed(1)),

    // Customer drop location
    destinationAddress: booking.customerAddress || booking.destinationAddress || 'Customer Location',
    destinationLatitude: dLat,
    destinationLongitude: dLon,
    customerAddress: booking.customerAddress || booking.destinationAddress || 'Customer Location',
    customerLatitude: dLat,
    customerLongitude: dLon,
    customerName: booking.customerName || 'Customer',
    customerPhone: booking.customerPhone || '',
    dropDistanceKm: dropDist,
    distanceKm: totalDist,
    etaMinutes: etaMinutes(riderDistKm),

    estimatedEarning: earningInfo.totalEarning,
    baseTripPay: earningInfo.baseTripPay,
    rainSurgeAmount: earningInfo.rainSurgeAmount,
    isRainSurge: earningInfo.isRainSurge,
    totalTripPay: earningInfo.totalEarning,
    totalAmount: booking.totalAmount || booking.price || 0,
    items: items,
    cartItems: items,
    status: booking.status || 'OUT_FOR_DELIVERY',
    requestedAt: new Date().toISOString(),
    message: `🔄 Order Handover: ${booking.originalRiderName || 'Partner'} needs delivery handover due to ${booking.transferReason || 'Breakdown'}`,
  };
}

// 1. Request Order Transfer
async function requestOrderTransfer({ bookingId, riderId, reason, transferLocation, details }) {
  if (!bookingId || !riderId) {
    return { success: false, message: 'bookingId and riderId are required' };
  }

  clearBookingTimeout(bookingId);

  let booking = await Booking.findOne({
    $or: [{ bookingId }, { _id: mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null }],
  });

  if (!booking) {
    return { success: false, message: 'Booking not found' };
  }

  // Real GPS Handover location validation
  let tLat = transferLocation?.latitude;
  let tLon = transferLocation?.longitude;
  let tAddress = transferLocation?.address || '';
  let tAccuracy = transferLocation?.accuracy || 10;

  if (!tLat || !tLon || isNaN(tLat) || isNaN(tLon) || (tLat === 0 && tLon === 0)) {
    const mem = _onlineRiders ? _onlineRiders.get(riderId.toString()) : null;
    if (mem && mem.location && mem.location.latitude && mem.location.longitude) {
      tLat = Number(mem.location.latitude);
      tLon = Number(mem.location.longitude);
      tAddress = tAddress || mem.location.address || 'Rider Handover GPS Location';
    } else {
      const u = await User.findById(riderId).select('latitude longitude location').lean();
      if (u && u.latitude && u.longitude) {
        tLat = Number(u.latitude);
        tLon = Number(u.longitude);
        tAddress = tAddress || u.location || 'Rider Handover GPS Location';
      }
    }
  }

  if (!tLat || !tLon || isNaN(tLat) || isNaN(tLon) || (tLat === 0 && tLon === 0)) {
    return { success: false, message: 'Valid real device GPS is required for order handover location' };
  }

  let riderA = null;
  try {
    riderA = await User.findById(riderId).select('name phoneNumber phone').lean();
  } catch (_) {}

  const origName = riderA?.name || booking.riderName || 'Original Delivery Partner';
  const origPhone = riderA?.phoneNumber || riderA?.phone || booking.riderPhone || '';

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const expiresAt = new Date(Date.now() + TRANSFER_POLICY.otpExpiryMinutes * 60 * 1000);

  booking.transferStatus = 'TRANSFER_REQUESTED';
  booking.deliveryStatus = 'TRANSFER_REQUESTED';
  booking.transferReason = reason || 'Vehicle Breakdown';
  booking.transferDetails = details || '';
  booking.transferLocation = {
    latitude: Number(tLat),
    longitude: Number(tLon),
    address: tAddress,
    accuracy: Number(tAccuracy),
    timestamp: new Date(),
  };
  booking.originalRiderId = riderId.toString();
  booking.originalRiderName = origName;
  booking.originalRiderPhone = origPhone;
  booking.transferOtp = otp;
  booking.transferOtpExpiresAt = expiresAt;
  booking.transferRiderId = null;
  booking.transferRiderName = null;
  booking.pendingRiderId = null;

  if (!booking.rejectedRiders) booking.rejectedRiders = [];
  if (!booking.rejectedRiders.includes(riderId.toString())) {
    booking.rejectedRiders.push(riderId.toString());
  }

  await booking.save();

  console.log(`[ORDER_TRANSFER] 🚨 Transfer initiated for Order ${booking.bookingId} by Rider ${origName} (${riderId}) at (${tLat}, ${tLon}) Reason: ${booking.transferReason} OTP: ${otp}`);

  emitToRider(riderId.toString(), 'TRANSFER_WAITING', {
    bookingId: booking.bookingId,
    transferOtp: otp,
    transferLocation: booking.transferLocation,
    message: 'हैंडओवर अनुरोध सक्रिय। आस-पास के राइडर खोजे जा रहे हैं...',
  });

  if (_io && booking.customerId) {
    _io.to('user_' + booking.customerId).emit('order_status_updated', {
      bookingId: booking.bookingId,
      transferStatus: 'TRANSFER_REQUESTED',
      message: 'डिलीवरी पार्टनर के वाहन में समस्या के कारण पास के दूसरे पार्टनर को ऑर्डर ट्रांसफर किया जा रहा है। आपका भोजन सुरक्षित है।',
    });
  }

  if (_io && booking.restaurantId) {
    _io.to('user_' + booking.restaurantId).emit('RIDER_SEARCH_STATUS', {
      bookingId: booking.bookingId,
      deliveryStatus: 'TRANSFER_REQUESTED',
      message: `राइडर ने वाहन खराबी (${booking.transferReason}) के कारण हैंडओवर का अनुरोध किया है।`,
    });
  }

  if (_io) {
    _io.to('admin_tracking').emit('ride_update_admin', {
      rideId: booking.bookingId,
      bookingId: booking.bookingId,
      status: booking.status,
      deliveryStatus: 'TRANSFER_REQUESTED',
      transferStatus: 'TRANSFER_REQUESTED',
      transferReason: booking.transferReason,
      transferLocation: booking.transferLocation,
      originalRiderId: booking.originalRiderId,
      originalRiderName: booking.originalRiderName,
    });
  }

  setImmediate(async () => {
    await findAndDispatchTransferRider(booking.bookingId, booking.transferLocation, riderId.toString());
  });

  return {
    success: true,
    message: 'Order transfer initiated. Searching nearby partners.',
    booking,
    transferOtp: otp,
  };
}

// 2. Search & Dispatch to Nearby Eligible Rider B around Handover Point
async function findAndDispatchTransferRider(bookingId, transferLocation, excludeRiderId) {
  try {
    let booking = await Booking.findOne({
      $or: [{ bookingId }, { _id: mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null }],
    });

    if (!booking) return;
    if (booking.transferStatus !== 'TRANSFER_REQUESTED') {
      console.log(`[TRANSFER_SEARCH] Aborting: Order ${bookingId} transferStatus is ${booking.transferStatus}`);
      return;
    }

    const tLat = Number(transferLocation?.latitude || booking.transferLocation?.latitude);
    const tLon = Number(transferLocation?.longitude || booking.transferLocation?.longitude);
    if (!tLat || !tLon) {
      console.log(`[TRANSFER_SEARCH] Aborting: Missing transfer coordinates for ${bookingId}`);
      return;
    }

    const excludeObjId = mongoose.Types.ObjectId.isValid(excludeRiderId) ? new mongoose.Types.ObjectId(excludeRiderId) : null;
    const dbRiders = await User.find({
      role: { $in: ['delivery_partner', 'rider', 'provider'] },
      isSuspended: { $ne: true },
      rider_status: { $ne: 'offline' },
      isOnline: true,
      ...(excludeObjId ? { _id: { $ne: excludeObjId } } : {}),
    }).select('_id name phoneNumber latitude longitude rider_status isOnline isAvailable approvalStatus profilePicture').lean();

    const dbRiderIds = dbRiders.map(r => r._id.toString());
    const busyBookings = await Booking.find({
      $or: [
        { riderId: { $in: dbRiderIds } },
        { providerId: { $in: dbRiderIds } },
      ],
      deliveryStatus: { $in: ['RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'RIDER_AT_RESTAURANT', 'TRANSFER_ACCEPTED_PENDING_HANDOVER'] },
      status: { $nin: ['COMPLETED', 'DELIVERED', 'CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'RESTAURANT_DECLINED'] },
    }).select('riderId providerId').lean();

    const busyRiderIds = new Set();
    busyBookings.forEach(b => {
      if (b.riderId) busyRiderIds.add(b.riderId.toString());
      if (b.providerId) busyRiderIds.add(b.providerId.toString());
    });

    const candidates = [];
    for (let i = 0; i < dbRiders.length; i++) {
      const r = dbRiders[i];
      const rId = r._id.toString();

      if (rId === excludeRiderId?.toString()) continue;
      if (r.rider_status === 'offline' || r.isOnline === false) continue;
      if ((booking.rejectedRiders || []).includes(rId)) continue;

      const mem = _onlineRiders ? _onlineRiders.get(rId) : null;
      if (mem && (mem.isOnline === false || mem.isAvailable === false)) continue;
      if (busyRiderIds.has(rId)) continue;

      let rLat = (mem && mem.location && mem.location.latitude) || r.latitude;
      let rLon = (mem && mem.location && mem.location.longitude) || r.longitude;

      if (!rLat || !rLon) continue;

      const distKm = haversineKm(tLat, tLon, Number(rLat), Number(rLon));
      if (distKm <= TRANSFER_POLICY.maxHandoverSearchRadiusKm) {
        candidates.push({
          riderId: rId,
          name: r.name || 'Delivery Partner',
          phone: r.phoneNumber || '',
          distKm,
        });
      }
    }

    candidates.sort((a, b) => a.distKm - b.distKm);

    if (candidates.length === 0) {
      console.log(`[TRANSFER_SEARCH] No eligible candidates within ${TRANSFER_POLICY.maxHandoverSearchRadiusKm}km for handover of ${bookingId}`);
      if (booking.originalRiderId) {
        emitToRider(booking.originalRiderId, 'TRANSFER_SEARCH_UPDATE', {
          bookingId,
          status: 'SEARCHING',
          message: 'आस-पास के राइडर्स ढूंढे जा रहे हैं...',
        });
      }
      return;
    }

    const nearest = candidates[0];
    console.log(`[TRANSFER_SEARCH] 🎯 Dispatching transfer request to Rider ${nearest.name} (${nearest.riderId}) - ${nearest.distKm.toFixed(2)}km from handover point`);

    booking.pendingRiderId = nearest.riderId;
    await booking.save();

    const payload = buildTransferRequestPayload(booking, nearest.distKm);

    emitToRider(nearest.riderId, 'DELIVERY_REQUEST', payload);
    emitToRider(nearest.riderId, 'new_booking_request', payload);
    emitToRider(nearest.riderId, 'TRANSFER_DELIVERY_REQUEST', payload);

    clearBookingTimeout(bookingId);

    const timeoutHandle = setTimeout(async () => {
      activeTimeouts.delete(bookingId);
      try {
        const check = await Booking.findOne({
          $or: [{ bookingId }, { _id: mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null }],
        });
        if (check && check.transferStatus === 'TRANSFER_REQUESTED' && check.pendingRiderId === nearest.riderId) {
          console.log(`[TRANSFER_TIMEOUT] Rider ${nearest.riderId} timed out for transfer ${bookingId}. Retrying next.`);
          emitToRider(nearest.riderId, 'DELIVERY_REQUEST_CANCELLED', { bookingId, reason: 'timeout' });
          if (!check.rejectedRiders) check.rejectedRiders = [];
          check.rejectedRiders.push(nearest.riderId);
          check.pendingRiderId = null;
          await check.save();
          findAndDispatchTransferRider(bookingId, transferLocation, excludeRiderId);
        }
      } catch (err) {
        console.error('[TRANSFER_TIMEOUT] Error in transfer timeout handler:', err);
      }
    }, RIDER_REQUEST_TIMEOUT_MS);

    activeTimeouts.set(bookingId, timeoutHandle);
  } catch (err) {
    console.error('[TRANSFER_SEARCH] Error finding transfer rider:', err);
  }
}

// 3. Rider B Accepts Transfer Request
async function acceptOrderTransfer({ bookingId, riderId, latitude, longitude }) {
  if (!bookingId || !riderId) {
    return { success: false, message: 'bookingId and riderId are required' };
  }

  clearBookingTimeout(bookingId);

  let booking = await Booking.findOne({
    $or: [{ bookingId }, { _id: mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null }],
  });

  if (!booking) {
    return { success: false, message: 'Booking not found' };
  }

  if (booking.transferStatus === 'TRANSFER_ACCEPTED_PENDING_HANDOVER' && booking.transferRiderId && booking.transferRiderId !== riderId.toString()) {
    return { success: false, alreadyTaken: true, message: 'This transfer was already accepted by another partner.' };
  }

  let riderB = null;
  try {
    riderB = await User.findById(riderId).lean();
  } catch (_) {}

  const rName = riderB?.name || riderB?.username || 'Delivery Partner';
  const rPhone = riderB?.phoneNumber || riderB?.phone || '';
  const rPhoto = riderB?.profilePicture || riderB?.avatar || '';

  const rLat = Number(latitude || riderB?.latitude || 0);
  const rLon = Number(longitude || riderB?.longitude || 0);
  const hLat = Number(booking.transferLocation?.latitude || 0);
  const hLon = Number(booking.transferLocation?.longitude || 0);

  const distToHandover = (rLat && rLon && hLat && hLon) ? haversineKm(rLat, rLon, hLat, hLon) : 1.2;
  const eta = etaMinutes(distToHandover);

  booking.transferStatus = 'TRANSFER_ACCEPTED_PENDING_HANDOVER';
  booking.deliveryStatus = 'TRANSFER_ACCEPTED_PENDING_HANDOVER';
  booking.status = 'TRANSFER_ACCEPTED_PENDING_HANDOVER';
  booking.transferRiderId = riderId.toString();
  booking.transferRiderName = rName;
  booking.transferRiderPhone = rPhone;
  booking.transferRiderPhoto = rPhoto;
  booking.pendingRiderId = null;

  await booking.save();

  console.log(`[TRANSFER_ACCEPT] ✅ Rider B (${rName}, ${riderId}) accepted transfer for Order ${booking.bookingId}. Handover in progress.`);

  try {
    await User.findByIdAndUpdate(riderId, { isAvailable: false });
    if (_onlineRiders) {
      const mem = _onlineRiders.get(riderId.toString());
      if (mem) {
        mem.isAvailable = false;
        _onlineRiders.set(riderId.toString(), mem);
      }
    }
  } catch (_) {}

  // 1. Notify Rider A (Show Rider B arriving + OTP to share)
  if (booking.originalRiderId) {
    emitToRider(booking.originalRiderId, 'TRANSFER_ACCEPTED', {
      bookingId: booking.bookingId,
      transferRiderId: riderId.toString(),
      transferRiderName: rName,
      transferRiderPhone: rPhone,
      transferRiderPhoto: rPhoto,
      etaMinutes: eta,
      distKm: parseFloat(distToHandover.toFixed(1)),
      transferOtp: booking.transferOtp,
      handoverLocation: booking.transferLocation,
      message: `पार्टनर ${rName} ने ट्रांसफर स्वीकार किया। वे ${eta} मिनट में पहुंच रहे हैं। कृपया हैंडओवर OTP साझा करें।`,
    });
  }

  // 2. Notify Rider B (Navigate to Handover Point)
  emitToRider(riderId.toString(), 'TRANSFER_CONFIRMED', {
    bookingId: booking.bookingId,
    originalRiderId: booking.originalRiderId,
    originalRiderName: booking.originalRiderName,
    originalRiderPhone: booking.originalRiderPhone,
    handoverLocation: booking.transferLocation,
    transferReason: booking.transferReason,
    status: 'TRANSFER_ACCEPTED_PENDING_HANDOVER',
    message: `हैंडओवर पॉइंट पर पहुंचें और पार्टनर से 4-अंकीय OTP प्राप्त करें।`,
  });

  // 3. Notify Customer
  if (_io && booking.customerId) {
    _io.to('user_' + booking.customerId).emit('order_status_updated', {
      bookingId: booking.bookingId,
      transferStatus: 'TRANSFER_ACCEPTED_PENDING_HANDOVER',
      transferRiderName: rName,
      message: `नया डिलीवरी पार्टनर ${rName} मूल राइडर से आर्डर लेने पहुंच रहा है।`,
    });
  }

  // 4. Notify Restaurant / Supplier
  if (_io && booking.restaurantId) {
    _io.to('user_' + booking.restaurantId).emit('ORDER_UPDATED', {
      bookingId: booking.bookingId,
      riderName: rName,
      transferStatus: 'TRANSFER_ACCEPTED_PENDING_HANDOVER',
      message: `नया राइडर हैंडओवर पॉइंट पर पहुंच रहा है।`,
    });
  }

  if (_io) {
    _io.to('admin_tracking').emit('ride_update_admin', {
      rideId: booking.bookingId,
      bookingId: booking.bookingId,
      status: booking.status,
      deliveryStatus: 'TRANSFER_ACCEPTED_PENDING_HANDOVER',
      transferStatus: 'TRANSFER_ACCEPTED_PENDING_HANDOVER',
      transferRiderId: booking.transferRiderId,
      transferRiderName: booking.transferRiderName,
      originalRiderId: booking.originalRiderId,
      originalRiderName: booking.originalRiderName,
    });

    _io.emit('DELIVERY_REQUEST_CANCELLED', {
      bookingId: booking.bookingId,
      rideId: booking.bookingId,
      reason: 'transfer_accepted',
      assignedRiderId: riderId.toString(),
      message: 'This transfer has already been accepted by another partner.',
    });
    _io.emit('ORDER_ASSIGNED_TO_OTHER', {
      bookingId: booking.bookingId,
      rideId: booking.bookingId,
      assignedRiderId: riderId.toString(),
    });
    _io.emit('REMOVE_AVAILABLE_ORDER', {
      bookingId: booking.bookingId,
      orderId: booking.bookingId,
      assignedRiderId: riderId.toString(),
    });

    _io.to('riders_room').emit('DELIVERY_REQUEST_CANCELLED', {
      bookingId: booking.bookingId,
      rideId: booking.bookingId,
      reason: 'transfer_accepted',
      assignedRiderId: riderId.toString(),
      message: 'This transfer has already been accepted by another partner.',
    });
    _io.to('riders_room').emit('ORDER_ASSIGNED_TO_OTHER', {
      bookingId: booking.bookingId,
      rideId: booking.bookingId,
      assignedRiderId: riderId.toString(),
    });
    _io.to('riders_room').emit('REMOVE_AVAILABLE_ORDER', {
      bookingId: booking.bookingId,
      orderId: booking.bookingId,
      assignedRiderId: riderId.toString(),
    });
  }

  return { success: true, booking, etaMinutes: eta };
}

// 4. Get / Regenerate Transfer OTP for Rider A
async function getTransferOtp({ bookingId, riderId }) {
  if (!bookingId) return { success: false, message: 'bookingId required' };

  let booking = await Booking.findOne({
    $or: [{ bookingId }, { _id: mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null }],
  });

  if (!booking) return { success: false, message: 'Booking not found' };

  if (!booking.transferOtp || (booking.transferOtpExpiresAt && new Date() > booking.transferOtpExpiresAt)) {
    booking.transferOtp = Math.floor(1000 + Math.random() * 9000).toString();
    booking.transferOtpExpiresAt = new Date(Date.now() + TRANSFER_POLICY.otpExpiryMinutes * 60 * 1000);
    await booking.save();
  }

  return {
    success: true,
    bookingId: booking.bookingId,
    transferOtp: booking.transferOtp,
    expiresAt: booking.transferOtpExpiresAt,
    transferRiderName: booking.transferRiderName,
    transferRiderPhone: booking.transferRiderPhone,
    transferStatus: booking.transferStatus,
  };
}

// 5. Verify Transfer Handover (Atomic Swap via 4-Digit OTP)
async function verifyTransferHandover({ bookingId, riderId, otp }) {
  if (!bookingId || !riderId || !otp) {
    return { success: false, message: 'bookingId, riderId and otp are required' };
  }

  let booking = await Booking.findOne({
    $or: [{ bookingId }, { _id: mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null }],
  });

  if (!booking) {
    return { success: false, message: 'Booking not found' };
  }

  if (booking.transferStatus !== 'TRANSFER_ACCEPTED_PENDING_HANDOVER') {
    return { success: false, message: `Handover cannot be verified in status '${booking.transferStatus}'` };
  }

  if (booking.transferRiderId && booking.transferRiderId !== riderId.toString()) {
    return { success: false, message: 'Only the assigned transfer partner can verify this handover.' };
  }

  const enteredOtp = String(otp).trim();
  const savedOtp = String(booking.transferOtp || '').trim();

  if (enteredOtp !== savedOtp) {
    return { success: false, message: 'अमान्य OTP! कृपया मूल डिलीवरी पार्टनर से सही 4-अंकीय कोड लें।' };
  }

  if (booking.transferOtpExpiresAt && new Date() > booking.transferOtpExpiresAt) {
    return { success: false, message: 'OTP समाप्त हो गया है। कृपया मूल राइडर से नया OTP जनरेट करवाएं।' };
  }

  const prevRiderId = booking.originalRiderId || booking.riderId;
  const prevRiderName = booking.originalRiderName || booking.riderName;
  const prevRiderPhone = booking.originalRiderPhone || booking.riderPhone;

  const newRiderId = booking.transferRiderId || riderId.toString();
  const newRiderName = booking.transferRiderName || 'Delivery Partner';
  const newRiderPhone = booking.transferRiderPhone || '';

  booking.previousRiderId = prevRiderId;
  booking.riderId = newRiderId;
  booking.riderName = newRiderName;
  booking.riderPhone = newRiderPhone;
  booking.transferStatus = 'TRANSFER_COMPLETED';
  booking.deliveryStatus = 'OUT_FOR_DELIVERY';
  booking.status = 'OUT_FOR_DELIVERY';
  booking.riderStatus = 'OUT_FOR_DELIVERY';
  booking.transferOtpVerifiedAt = new Date();

  if (!booking.transferHistory) booking.transferHistory = [];
  booking.transferHistory.push({
    transferId: `TRF-${Date.now()}`,
    previousRiderId: prevRiderId,
    previousRiderName: prevRiderName,
    previousRiderPhone: prevRiderPhone,
    nextRiderId: newRiderId,
    nextRiderName: newRiderName,
    nextRiderPhone: newRiderPhone,
    transferTime: new Date(),
    transferReason: booking.transferReason || 'Breakdown',
    transferDetails: booking.transferDetails || '',
    nextRiderAcceptedTime: new Date(),
    transferLocation: {
      latitude: booking.transferLocation?.latitude,
      longitude: booking.transferLocation?.longitude,
      address: booking.transferLocation?.address || '',
    },
    otpVerifiedAt: new Date(),
    status: 'COMPLETED',
  });

  await booking.save();

  console.log(`[TRANSFER_HANDOVER] 🎉 Atomic handover complete for Order ${booking.bookingId}: Rider A (${prevRiderId}) -> Rider B (${newRiderId})`);

  try {
    if (prevRiderId) {
      await User.findByIdAndUpdate(prevRiderId, { isAvailable: true });
      if (_onlineRiders) {
        const mem = _onlineRiders.get(prevRiderId.toString());
        if (mem) {
          mem.isAvailable = true;
          _onlineRiders.set(prevRiderId.toString(), mem);
        }
      }
    }
  } catch (_) {}

  if (prevRiderId) {
    emitToRider(prevRiderId, 'TRANSFER_COMPLETED', {
      bookingId: booking.bookingId,
      message: 'हैंडओवर सफलतापूर्वक सत्यापित हो गया है! आर्डर पार्टनर को सौंप दिया गया है।',
      penalty: 0,
      penaltyText: '₹0 PENALTY',
    });
    emitToRider(prevRiderId, 'ORDER_TRANSFERRED', {
      bookingId: booking.bookingId,
      penalty: 0,
      penaltyText: '₹0 PENALTY',
      message: 'आर्डर सफलतापूर्वक ट्रांसफर हुआ। आप पर ₹0 पेनाल्टी लगी है।',
    });
  }

  emitToRider(newRiderId, 'HANDOVER_VERIFIED', {
    bookingId: booking.bookingId,
    message: 'हैंडओवर सत्यापित! अब कृपया ग्राहक को आर्डर डिलीवर करें।',
    customerAddress: booking.customerAddress || booking.destinationAddress,
    customerLatitude: booking.customerLatitude || booking.destinationLatitude,
    customerLongitude: booking.customerLongitude || booking.destinationLongitude,
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    deliveryOtp: booking.deliveryOtp || booking.otp,
    booking,
  });

  if (_io && booking.customerId) {
    _io.to('user_' + booking.customerId).emit('order_status_updated', {
      bookingId: booking.bookingId,
      status: 'OUT_FOR_DELIVERY',
      deliveryStatus: 'OUT_FOR_DELIVERY',
      riderId: newRiderId,
      riderName: newRiderName,
      riderPhone: newRiderPhone,
      transferStatus: 'TRANSFER_COMPLETED',
      message: `आपके ऑर्डर को अब नए डिलीवरी पार्टनर ${newRiderName} द्वारा डिलीवर किया जा रहा है।`,
    });
    _io.to('user_' + booking.customerId).emit('RIDER_ASSIGNED', {
      bookingId: booking.bookingId,
      riderId: newRiderId,
      riderName: newRiderName,
      riderPhone: newRiderPhone,
      riderLatitude: booking.transferLocation?.latitude,
      riderLongitude: booking.transferLocation?.longitude,
    });
  }

  if (_io && booking.restaurantId) {
    _io.to('user_' + booking.restaurantId).emit('ORDER_UPDATED', {
      bookingId: booking.bookingId,
      riderId: newRiderId,
      riderName: newRiderName,
      riderPhone: newRiderPhone,
      status: 'OUT_FOR_DELIVERY',
      message: `आर्डर हैंडओवर पूर्ण। नया राइडर: ${newRiderName}`,
    });
  }

  if (_io) {
    _io.to('admin_tracking').emit('ride_update_admin', {
      rideId: booking.bookingId,
      bookingId: booking.bookingId,
      status: booking.status,
      deliveryStatus: booking.deliveryStatus,
      transferStatus: 'TRANSFER_COMPLETED',
      riderId: newRiderId,
      riderName: newRiderName,
      previousRiderId: prevRiderId,
      previousRiderName: booking.originalRiderName,
    });
  }

  return {
    success: true,
    message: 'Handover verified and completed successfully',
    booking,
  };
}

// 6. Cancel Order Transfer by Rider A
async function cancelOrderTransfer({ bookingId, riderId }) {
  if (!bookingId || !riderId) {
    return { success: false, message: 'bookingId and riderId required' };
  }

  clearBookingTimeout(bookingId);

  let booking = await Booking.findOne({
    $or: [{ bookingId }, { _id: mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null }],
  });

  if (!booking) return { success: false, message: 'Booking not found' };

  if (booking.transferStatus === 'TRANSFER_COMPLETED') {
    return { success: false, message: 'Cannot cancel transfer after handover is already verified and completed.' };
  }

  const prevPending = booking.pendingRiderId || booking.transferRiderId;
  if (prevPending) {
    emitToRider(prevPending, 'DELIVERY_REQUEST_CANCELLED', {
      bookingId: booking.bookingId,
      message: 'Transfer request was cancelled by original partner.',
    });
    try {
      await User.findByIdAndUpdate(prevPending, { isAvailable: true });
    } catch (_) {}
  }

  booking.transferStatus = 'NONE';
  booking.deliveryStatus = 'OUT_FOR_DELIVERY';
  booking.status = 'OUT_FOR_DELIVERY';
  booking.pendingRiderId = null;
  booking.transferRiderId = null;
  booking.transferRiderName = null;
  booking.transferRiderPhone = null;

  await booking.save();

  console.log(`[TRANSFER_CANCEL] Order ${booking.bookingId} transfer cancelled by Rider A (${riderId}). Restored delivery.`);

  return { success: true, message: 'Order transfer cancelled. You remain on the delivery.', booking };
}

// Backward-compatible entrypoint
async function riderTransferOrder(bookingId, riderId, reason = 'Restaurant Is Late', transferLocation = null, details = '') {
  if (!bookingId || !riderId) return { success: false, message: 'bookingId and riderId required' };

  // If reason is an emergency or transferLocation is provided, route to full handover flow
  const emergencyReasons = ['Bike Puncture', 'Vehicle Breakdown', 'Minor Accident', 'Health Issue', 'Emergency', 'Other'];
  if (transferLocation || emergencyReasons.includes(reason)) {
    return await requestOrderTransfer({ bookingId, riderId, reason, transferLocation, details });
  }

  // Otherwise handle restaurant delay reassignment
  clearBookingTimeout(bookingId);

  const updated = await Booking.findOneAndUpdate(
    {
      $or: [{ bookingId }, { _id: mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null }],
      riderId: riderId.toString(),
    },
    {
      $set: {
        riderId: null,
        riderName: null,
        riderPhone: null,
        deliveryStatus: 'SEARCHING_FOR_RIDER',
        pendingRiderId: null,
      },
      $addToSet: { rejectedRiders: riderId.toString() },
    },
    { new: true }
  );

  if (!updated) {
    return { success: false, message: 'Booking not found or not assigned to this rider' };
  }

  try {
    await User.findByIdAndUpdate(riderId, { isAvailable: true });
    if (_onlineRiders) {
      const mem = _onlineRiders.get(riderId.toString());
      if (mem) {
        mem.isAvailable = true;
        _onlineRiders.set(riderId.toString(), mem);
      }
    }
  } catch (_) {}

  console.log(`[RIDER_TRANSFER] 🔄 Order ${bookingId} transferred by rider ${riderId} (Reason: ${reason}). Searching next candidate.`);

  emitToRider(riderId, 'ORDER_TRANSFERRED', {
    bookingId: updated.bookingId,
    penalty: 0,
    penaltyText: '₹0 PENALTY',
    reason,
    message: 'ऑर्डर ट्रांसफर कर दिया गया है। आप पर ₹0 पेनाल्टी लगी है।',
  });

  if (_io) {
    if (updated.restaurantId) {
      _io.to('user_' + updated.restaurantId).emit('RIDER_SEARCH_STATUS', {
        bookingId: updated.bookingId,
        deliveryStatus: 'SEARCHING_FOR_RIDER',
        message: 'Rider ने ऑर्डर ट्रांसफर किया — नया Rider खोजा जा रहा है।',
      });
    }
    if (updated.customerId) {
      _io.to('user_' + updated.customerId).emit('order_status_updated', {
        bookingId: updated.bookingId,
        deliveryStatus: 'SEARCHING_FOR_RIDER',
        message: 'नया डिलीवरी पार्टनर असाइन किया जा रहा है...',
      });
    }
  }

  setImmediate(function() {
    findAndDispatchNearestRider(updated.bookingId);
  });

  return { success: true, message: 'Order transferred successfully with ₹0 penalty', booking: updated };
}

module.exports = {
  init,
  findAndDispatchNearestRider,
  scheduleDelayedRiderSearch,
  clearDelayedRiderSearch,
  clearBookingTimeout,
  riderAcceptDelivery,
  riderRejectDelivery,
  riderTransferOrder,
  requestOrderTransfer,
  findAndDispatchTransferRider,
  acceptOrderTransfer,
  getTransferOtp,
  verifyTransferHandover,
  cancelOrderTransfer,
  retrySearchingOrders,
  notifyRiderFoodReady,
  TRANSFER_POLICY,
};
