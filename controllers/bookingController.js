const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Zone = require('../models/Zone');
const jwt = require('jsonwebtoken');
const socketHandlerObj = require('../sockets/socketHandler');
const riderSearchService = require('../services/riderSearchService');
const { normalizeId, areIdsEqual, toObjectIdSafely, buildIdQueryFilter, resolveSupplierIdentity, getSupplierSocketRooms } = require('../utils/idUtils');


function _haversineDist(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function _isPointInPolygon(point, polygon) {
  if (!polygon || !Array.isArray(polygon) || polygon.length === 0) return false;
  const [lat, lng] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > lng !== yj > lng &&
      lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function _minDistanceToPolygon(point, polygon, centroid) {
  if (_isPointInPolygon(point, polygon)) return 0.0;
  let minDistance = Infinity;
  if (!polygon || !Array.isArray(polygon)) return minDistance;
  for (let i = 0; i < polygon.length; i++) {
    const [vLat, vLon] = polygon[i];
    const d = _haversineDist(point[0], point[1], vLat, vLon);
    if (d < minDistance) minDistance = d;
  }
  return minDistance;
}

// In-Memory Fast Cache for Active Zones (60-second TTL avoids repeated polygon queries)
let _cachedActiveZones = null;
let _lastZoneFetchTime = 0;
async function _getActiveZonesCached() {
  const now = Date.now();
  if (_cachedActiveZones && (now - _lastZoneFetchTime < 60000)) {
    return _cachedActiveZones;
  }
  try {
    _cachedActiveZones = await Zone.find({ isActive: true }).lean();
    _lastZoneFetchTime = now;
  } catch (err) {
    if (_cachedActiveZones) return _cachedActiveZones;
    throw err;
  }
  return _cachedActiveZones;
}

let _io = null;
exports.setIO = (io) => { _io = io; };

const resolveBookingsBatch = async (bookingList) => {
  if (!Array.isArray(bookingList) || bookingList.length === 0) return bookingList || [];

  const userIdsToFetch = new Set();
  for (const b of bookingList) {
    if (!b.customerName && b.customerId && typeof b.customerId === 'string' && b.customerId.match(/^[0-9a-fA-F]{24}$/)) {
      userIdsToFetch.add(b.customerId);
    }
    if (!b.providerName && b.providerId && typeof b.providerId === 'string' && b.providerId.match(/^[0-9a-fA-F]{24}$/)) {
      userIdsToFetch.add(b.providerId);
    }
    const targetStoreId = b.restaurantId || b.providerId || b.partnerId;
    if (!b.restaurantName && targetStoreId && typeof targetStoreId === 'string' && targetStoreId.match(/^[0-9a-fA-F]{24}$/)) {
      userIdsToFetch.add(targetStoreId);
    }
  }

  const userMap = new Map();
  if (userIdsToFetch.size > 0) {
    try {
      const userDocs = await User.find({ _id: { $in: Array.from(userIdsToFetch) } })
        .select('name username restaurantName categoryName businessCategoryName partnerType businessType latitude longitude locationCoords address location')
        .lean();
      for (const u of userDocs) {
        userMap.set(u._id.toString(), u);
      }
    } catch (e) {
      console.error('[resolveBookingsBatch] User batch fetch error:', e.message);
    }
  }

  return bookingList.map((bookingObj) => {
    if (!bookingObj) return bookingObj;
    try {
      // Resolve customer
      if (bookingObj.customerId && userMap.has(bookingObj.customerId.toString())) {
        const customer = userMap.get(bookingObj.customerId.toString());
        if (!bookingObj.customerName) bookingObj.customerName = customer.name || customer.username || 'Customer';
        if (!bookingObj.customerPhoto) bookingObj.customerPhoto = customer.profilePicture || customer.avatar || null;
      }

      // Resolve provider
      if (bookingObj.providerId && userMap.has(bookingObj.providerId.toString())) {
        const provider = userMap.get(bookingObj.providerId.toString());
        if (!bookingObj.providerName) bookingObj.providerName = provider.name || provider.username || 'Provider';
        if (!bookingObj.providerPhoto) bookingObj.providerPhoto = provider.profilePicture || provider.avatar || null;
      }

      // Resolve store
      const targetStoreId = bookingObj.restaurantId || bookingObj.providerId || bookingObj.partnerId;
      if (targetStoreId && userMap.has(targetStoreId.toString())) {
        const storeDoc = userMap.get(targetStoreId.toString());
        if (!bookingObj.restaurantName) bookingObj.restaurantName = storeDoc.name || storeDoc.restaurantName || storeDoc.username || 'Partner Store';
        const storeCategory = storeDoc.categoryName || storeDoc.businessCategoryName || storeDoc.partnerType || storeDoc.businessType;
        if (storeCategory && (!bookingObj.categoryName || bookingObj.categoryName === 'Food Delivery' || bookingObj.categoryName === 'Food')) {
          bookingObj.categoryName = storeCategory;
          bookingObj.serviceName = storeCategory;
        }
        const sLat = Number(storeDoc.latitude || storeDoc.locationCoords?.latitude || 0);
        const sLon = Number(storeDoc.longitude || storeDoc.locationCoords?.longitude || 0);
        if (sLat !== 0 && sLon !== 0) {
          bookingObj.restaurantLatitude = sLat;
          bookingObj.restaurantLongitude = sLon;
          bookingObj.pickupLatitude = sLat;
          bookingObj.pickupLongitude = sLon;
        }
        const sAddr = storeDoc.fullAddress || storeDoc.address || storeDoc.location || '';
        if (sAddr && typeof sAddr === 'string' && sAddr !== '[object Object]') {
          bookingObj.pickupAddress = sAddr;
          bookingObj.restaurantAddress = sAddr;
        }
      }
    } catch (err) {
      console.error('Error in resolveBookingNames:', err.message);
    }
    return bookingObj;
  });
};

const resolveBookingNames = async (bookingObj) => {
  if (!bookingObj) return bookingObj;
  try {
    const list = await resolveBookingsBatch([bookingObj]);
    return (list && list[0]) || bookingObj;
  } catch (e) {
    console.error('[resolveBookingNames Safe Catch]:', e.message);
    return bookingObj;
  }
};

// Strict Requirement 4: State-based location visibility
// Conceal customer drop coordinates and address from rider until order is picked up
const redactDropLocationForRider = (bookingObj, isRiderContext = false) => {
  if (!bookingObj || !isRiderContext) return bookingObj;
  const status = (bookingObj.status || '').toUpperCase();
  const deliveryStatus = (bookingObj.deliveryStatus || '').toUpperCase();
  const riderStatus = (bookingObj.riderStatus || '').toUpperCase();

  const isPickedUp = ['PICKED_UP', 'OUT_FOR_DELIVERY', 'STARTED', 'SERVICE_STARTED', 'FOOD_PICKED_UP', 'REACHED_CUSTOMER', 'DELIVERED', 'COMPLETED', 'SERVICE_COMPLETED'].includes(status) ||
                     ['OUT_FOR_DELIVERY', 'PICKED_UP', 'FOOD_PICKED_UP', 'DELIVERED', 'COMPLETED'].includes(deliveryStatus) ||
                     ['OUT_FOR_DELIVERY', 'FOOD_PICKED_UP', 'REACHED_CUSTOMER', 'DELIVERED', 'COMPLETED'].includes(riderStatus);

  if (!isPickedUp) {
    const concealedCopy = (typeof bookingObj.toObject === 'function') ? bookingObj.toObject() : { ...bookingObj };
    concealedCopy.destinationAddress = 'Concealed until order pickup';
    concealedCopy.customerAddress = 'Concealed until order pickup';
    concealedCopy.deliveryAddress = 'Concealed until order pickup';
    concealedCopy.destinationLatitude = null;
    concealedCopy.destinationLongitude = null;
    concealedCopy.customerLatitude = null;
    concealedCopy.customerLongitude = null;
    concealedCopy.dropLocation = null;
    return concealedCopy;
  }
  return bookingObj;
};

// Calculate exact food items earning for restaurant (excluding rider delivery fee)
const getOrderRestaurantEarning = (b) => {
  if (!b) return 0;
  const isFood = (
    b.categoryName === 'Food Delivery' ||
    b.serviceName === 'Food Delivery' ||
    Boolean(b.restaurantId || (b.cartItems && typeof b.cartItems === 'object' && Object.keys(b.cartItems).length > 0))
  );
  if (isFood) {
    const sub = Number(b.subtotal);
    if (!isNaN(sub) && sub > 0) return sub;
    const fee = Number(b.deliveryFee) || 0;
    const p = Number(b.price) || 0;
    return Math.max(0, p - fee);
  }
  return Number(b.price) || 0;
};

// Calculate exact delivery amount paid by customer for rider earning
const getOrderRiderEarning = (b) => {
  if (!b) return 0;
  const fee = Number(b.deliveryFee);
  if (!isNaN(fee) && fee > 0) return fee;
  const tripPay = Number(b.totalTripPay || b.deliveryCharge || b.estimatedEarning);
  if (!isNaN(tripPay) && tripPay > 0) return tripPay;
  const price = Number(b.price || b.totalAmount || 0);
  const subtotal = Number(b.subtotal || 0);
  if (price > subtotal && subtotal > 0) {
    return Math.max(20, price - subtotal);
  }
  return 20; // Default base delivery pay
};

// Helper to strip heavy base64 strings from cartItems before database storage
const sanitizeCartItems = (cartItems) => {
  if (!cartItems || typeof cartItems !== 'object') return cartItems || {};
  try {
    if (Array.isArray(cartItems)) {
      return cartItems.map(it => {
        if (it && typeof it === 'object') {
          const clean = { ...it };
          if (clean.image && typeof clean.image === 'string' && clean.image.length > 500) {
            clean.image = '';
          }
          return clean;
        }
        return it;
      });
    } else {
      const cleanObj = {};
      for (const [k, it] of Object.entries(cartItems)) {
        if (it && typeof it === 'object') {
          const clean = { ...it };
          if (clean.image && typeof clean.image === 'string' && clean.image.length > 500) {
            clean.image = '';
          }
          cleanObj[k] = clean;
        } else {
          cleanObj[k] = it;
        }
      }
      return cleanObj;
    }
  } catch (e) {
    return cartItems;
  }
};

// Create new cleaning/service booking - MANDATORY DATABASE WRITE
exports.createBooking = async (req, res) => {
  try {
    const {
      bookingId,
      customerId,
      customerName,
      customerPhone,
      serviceId,
      serviceName,
      categoryName,
      price,
      serviceAddress,
      latitude,
      longitude,
      scheduledDate,
      scheduledTime,
      propertyType,
      numRooms,
      specialInstructions,
      // Food Delivery parameters
      restaurantId,
      restaurantName,
      providerId,
      pickupAddress,
      pickupLatitude,
      pickupLongitude,
      destinationAddress,
      destinationLatitude,
      destinationLongitude,
      distanceKm,
      deliveryFee,
      subtotal,
      cartItems,
      paymentMethod,
      paymentStatus,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      weatherIncentive,
      isRaining,
      status: incomingStatus,
    } = req.body;

    // Resolve authenticated customer identity
    const resolvedCustomerId = req.user ? req.user._id.toString() : (customerId || '').toString();
    const resolvedCustomerPhone = (req.user && (req.user.phoneNumber || req.user.phone)) || customerPhone || req.body.phone || '9999999999';
    const resolvedAddress = serviceAddress || destinationAddress || req.body.pickupAddress || req.body.address || 'Service Location';

    if (!resolvedCustomerId) {
      return res.status(400).json({ success: false, error: 'customerId is required' });
    }
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
      return res.status(400).json({ success: false, error: 'latitude and longitude are required' });
    }
    const newBookingId = bookingId || `book_${Date.now()}`;

    // Server-Side Idempotency Guard (Prevents duplicate orders on network retry or double-tap)
    if (bookingId) {
      const existingBooking = await Booking.findOne({ bookingId }).lean();
      if (existingBooking) {
        console.log(`⚡ [IDEMPOTENT BOOKING] Order ${bookingId} already exists. Returning existing order.`);
        return res.status(200).json({
          success: true,
          message: 'Booking already created',
          booking: existingBooking,
        });
      }
    }

    let resolvedCustomerName = (req.user && (req.user.name || req.user.username)) || customerName || 'Customer';
    let resolvedCustomerPhoto = (req.user && (req.user.profilePicture || req.user.photos?.[0])) || req.body.customerPhoto || req.body.customerPicture || null;
    if (!req.user && resolvedCustomerId && resolvedCustomerId.match(/^[0-9a-fA-F]{24}$/)) {
      const customer = await User.findById(resolvedCustomerId).lean();
      if (customer) {
        resolvedCustomerName = customer.name || customer.username || resolvedCustomerName;
        resolvedCustomerPhoto = customer.profilePicture || customer.avatar || resolvedCustomerPhoto;
      }
    }
    if (resolvedCustomerPhoto && typeof resolvedCustomerPhoto === 'string' && resolvedCustomerPhoto.length > 500) {
      resolvedCustomerPhoto = null;
    }

    
    // MANDATORY REQUIREMENT: Backend service-zone validation for Customer GPS (Cached for fast order placement)
    const checkLat = Number(destinationLatitude !== undefined && destinationLatitude !== null ? destinationLatitude : latitude);
    const checkLon = Number(destinationLongitude !== undefined && destinationLongitude !== null ? destinationLongitude : longitude);

    if (!isNaN(checkLat) && !isNaN(checkLon) && checkLat !== 0 && checkLon !== 0) {
      try {
        let activeZones = await _getActiveZonesCached();
        if (activeZones && activeZones.length > 0) {
          const userPoint = [checkLat, checkLon];
          let isCustomerServiceable = false;

          for (const zone of activeZones) {
            if (_isPointInPolygon(userPoint, zone.polygonCoordinates)) {
              isCustomerServiceable = true;
              break;
            }
            const dist = _minDistanceToPolygon(userPoint, zone.polygonCoordinates, zone.centerCoordinates);
            // Strict Zone Boundary Rule: Must be inside polygon boundary (max 200m buffer for GPS jitter)
            if (dist <= 0.2) {
              isCustomerServiceable = true;
              break;
            }
          }

          if (!isCustomerServiceable) {
            console.log(`🚫 [OUT-OF-ZONE REJECTED] Order blocked. Customer GPS (${checkLat}, ${checkLon}) is outside all active service boundaries.`);
            return res.status(400).json({
              success: false,
              error: 'This service is not available in your location.',
              message: 'This service is not available in your location.'
            });
          }
        }
      } catch (zoneErr) {
        console.warn('⚠️ [ZONE CHECK WARNING]', zoneErr.message);
      }
    }

    const isFood = (categoryName === 'Food Delivery' || serviceName === 'Food Delivery' || Boolean(restaurantId || providerId));
    let targetStoreUser = null;
    const targetStoreId = restaurantId || providerId;

    // Super Fast Parallel Execution: Check store and active booking in parallel
    if (isFood) {
      const activeFoodStatuses = [
        'PENDING_RESTAURANT',
        'RESTAURANT_ACCEPTED',
        'PREPARING',
        'FOOD_READY',
        'OUT_FOR_DELIVERY',
        'ACCEPTED',
        'STARTED',
        'PICKED_UP',
        'ON_THE_WAY'
      ];

      const [storeUserRes, existingActive] = await Promise.all([
        (targetStoreId && mongoose.Types.ObjectId.isValid(targetStoreId))
          ? User.findById(targetStoreId).lean()
          : Promise.resolve(null),
        Booking.findOne({
          customerId: customerId,
          bookingId: { $ne: newBookingId },
          status: { $in: activeFoodStatuses }
        }).lean()
      ]);

      targetStoreUser = storeUserRes;
      if (targetStoreUser) {
        const isStoreOnline = Boolean(targetStoreUser.restaurant_status === 'online' || targetStoreUser.isOnline === true);
        if (!isStoreOnline) {
          console.log(`⚠️ [STORE OFFLINE NOTICE] Store ${targetStoreId} (${targetStoreUser.restaurantName || targetStoreUser.name}) was offline in DB. Auto-marking online & routing order #${newBookingId}.`);
          User.findByIdAndUpdate(targetStoreId, { restaurant_status: 'online', isOnline: true }).catch(() => {});
        }
      }

      if (existingActive) {
        const createdMs = new Date(existingActive.createdAt).getTime();
        if (existingActive.status === 'PENDING_RESTAURANT' && (Date.now() - createdMs > 65000)) {
          console.log(`⏱️ [EXPIRED PENDING ORDER] Order ${existingActive.bookingId} timed out after 65s. Auto-marking as TIMEOUT.`);
          Booking.updateOne(
            { _id: existingActive._id },
            { status: 'TIMEOUT', cancellationReason: 'Auto-timed out after 60s without restaurant response' }
          ).catch(() => {});
        } else {
          console.log(`⚠️ [BLOCKED DUPLICATE FOOD ORDER] Customer ${customerId} already has active order ${existingActive.bookingId} (${existingActive.status})`);
          return res.status(400).json({
            success: false,
            hasActiveOrder: true,
            activeBooking: existingActive,
            error: `Aapka ek order (#${existingActive.bookingId}) pehle se chal raha hai. Pehla order complete hone ke baad hi naya order kar sakte hain.`,
            message: `You already have an active food order (#${existingActive.bookingId}) in progress. Please wait for it to complete before placing a new order.`
          });
        }
      }
    }

    let targetRestaurantId = restaurantId || providerId || req.body.supplierId || null;
    let resolvedRestoName = restaurantName || '';
    let resolvedCategory = categoryName || serviceName || req.body.supplierCategory || req.body.businessCategoryName || '';
    if (!resolvedCategory && (cartItems || req.body.cart)) {
      const rawItems = cartItems || req.body.cart;
      const cItems = Array.isArray(rawItems) ? rawItems : (rawItems.items || Object.values(rawItems));
      if (Array.isArray(cItems) && cItems.length > 0) {
        for (const it of cItems) {
          if (it && (it.categoryName || it.category || it.categoryId)) {
            resolvedCategory = it.categoryName || it.category;
            break;
          }
        }
      }
    }

    let resolvedPickupLat = Number(req.body.supplierBusinessLatitude || pickupLatitude || 0);
    let resolvedPickupLon = Number(req.body.supplierBusinessLongitude || pickupLongitude || 0);
    let resolvedPickupAddr = req.body.supplierBusinessAddress || pickupAddress || '';

    let canonicalSupplierId = resolveSupplierIdentity(targetRestaurantId);
    let restoDoc = null;

    if (canonicalSupplierId) {
      if (targetStoreUser && (String(targetStoreUser._id) === String(canonicalSupplierId) || String(targetStoreUser.supplierId) === String(canonicalSupplierId) || String(targetStoreUser.partnerId) === String(canonicalSupplierId))) {
        restoDoc = targetStoreUser;
      } else if (mongoose.Types.ObjectId.isValid(canonicalSupplierId)) {
        restoDoc = await User.findById(canonicalSupplierId).lean();
      }
      if (!restoDoc) {
        restoDoc = await User.findOne({
          $or: [
            { supplierId: canonicalSupplierId },
            { partnerId: canonicalSupplierId },
          ]
        }).lean();
      }
      if (restoDoc) {
        canonicalSupplierId = restoDoc._id.toString();
        targetRestaurantId = canonicalSupplierId;
        resolvedRestoName = resolvedRestoName || restoDoc.name || restoDoc.restaurantName || restoDoc.username || 'Restaurant';
        const docCat = restoDoc.categoryName || restoDoc.businessCategoryName || restoDoc.partnerType || restoDoc.businessType;
        if (docCat) {
          resolvedCategory = docCat;
        }
        // ALWAYS use the Supplier's actual saved business location from the database as canonical!
        const docLat = Number(restoDoc.businessLatitude || restoDoc.latitude || (restoDoc.locationCoords && restoDoc.locationCoords.latitude) || 0);
        const docLon = Number(restoDoc.businessLongitude || restoDoc.longitude || (restoDoc.locationCoords && restoDoc.locationCoords.longitude) || 0);
        if (docLat !== 0 && docLon !== 0) {
          resolvedPickupLat = docLat;
          resolvedPickupLon = docLon;
        }
        const docAddr = restoDoc.businessAddress || restoDoc.fullAddress || restoDoc.address || restoDoc.location;
        if (docAddr) {
          resolvedPickupAddr = docAddr;
        }
      }
    }

    if (!canonicalSupplierId && isFood) {
      try {
        const supp = (await User.findOne({ role: 'supplier', isOnline: true }).lean()) || (await User.findOne({ role: 'supplier' }).lean());
        if (supp) {
          restoDoc = supp;
          canonicalSupplierId = supp._id.toString();
          targetRestaurantId = canonicalSupplierId;
          resolvedRestoName = resolvedRestoName || supp.name || supp.restaurantName || 'Restaurant Partner';
          const suppCat = supp.categoryName || supp.businessCategoryName || supp.partnerType || supp.businessType;
          if (suppCat) {
            resolvedCategory = suppCat;
          }
          const suppLat = Number(supp.businessLatitude || supp.latitude || supp.locationCoords?.latitude || 0);
          const suppLon = Number(supp.businessLongitude || supp.longitude || supp.locationCoords?.longitude || 0);
          if (suppLat !== 0 && suppLon !== 0 && (resolvedPickupLat === 0 || resolvedPickupLat === Number(latitude))) {
            resolvedPickupLat = suppLat;
            resolvedPickupLon = suppLon;
          }
          if (supp.businessAddress || supp.fullAddress || supp.address || supp.location) {
            resolvedPickupAddr = resolvedPickupAddr || supp.businessAddress || supp.fullAddress || supp.address || supp.location;
          }
          console.log(`[BOOKING_CREATE] Fallback resolved canonicalSupplierId: ${canonicalSupplierId} (${resolvedRestoName}, ${resolvedCategory}, Lat: ${resolvedPickupLat}, Lon: ${resolvedPickupLon})`);
        }
      } catch (e) {}
    }

    if (!resolvedCategory) {
      if (isFood) {
        console.warn(`⚠️ [BOOKING_CREATE] Delivery order #${newBookingId} has missing category! Setting to 'Category unavailable'.`);
        resolvedCategory = 'Category unavailable';
      } else {
        resolvedCategory = 'Home Cleaning';
      }
    }

    let finalDestLat = Number(req.body.customerLatitude !== undefined && req.body.customerLatitude !== null ? req.body.customerLatitude : (destinationLatitude !== undefined && destinationLatitude !== null ? destinationLatitude : latitude));
    let finalDestLon = Number(req.body.customerLongitude !== undefined && req.body.customerLongitude !== null ? req.body.customerLongitude : (destinationLongitude !== undefined && destinationLongitude !== null ? destinationLongitude : longitude));
    let finalDestAddr = req.body.customerAddress || destinationAddress || resolvedAddress;

    let calculatedDistanceKm = Number(distanceKm || 0);
    if ((!calculatedDistanceKm || calculatedDistanceKm === 0) && resolvedPickupLat && resolvedPickupLon && finalDestLat && finalDestLon) {
      const R = 6371;
      const dLatRad = ((finalDestLat - resolvedPickupLat) * Math.PI) / 180;
      const dLonRad = ((finalDestLon - resolvedPickupLon) * Math.PI) / 180;
      const a = Math.sin(dLatRad / 2) * Math.sin(dLatRad / 2) + Math.cos((resolvedPickupLat * Math.PI) / 180) * Math.cos((finalDestLat * Math.PI) / 180) * Math.sin(dLonRad / 2) * Math.sin(dLonRad / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      calculatedDistanceKm = parseFloat((R * c).toFixed(1));
    }

    // Ride Hub Standard Pricing Rule (Authoritative backend enforcement):
    // - Minimum fare: ₹20 for trips up to 2 km.
    // - Beyond 2 km: ₹10 per km.
    // - Formula: max(20, Math.round(distanceKm * 10))
    // - Examples: 1km -> ₹20, 2km -> ₹20, 3km -> ₹30, 4km -> ₹40, 5km -> ₹50, 10km -> ₹100
    // - No separate GST line or extra hidden charges.
    let authoritativeDeliveryFee = Number(deliveryFee);
    if (isFood || calculatedDistanceKm > 0) {
      const dist = calculatedDistanceKm > 0 ? calculatedDistanceKm : 1.5;
      authoritativeDeliveryFee = dist <= 2 ? 20 : Math.max(20, Math.round(dist * 10));
    } else if (isNaN(authoritativeDeliveryFee) || authoritativeDeliveryFee <= 0) {
      authoritativeDeliveryFee = 20;
    }

    const calculatedGrandTotal = Number(subtotal || 0) > 0 ? Number(subtotal) + authoritativeDeliveryFee : Number(price);

    let resolvedRestoPhoto = '';
    let resolvedRestoPhotos = [];
    if (restoDoc) {
      const rawPhoto = restoDoc.profilePicture || restoDoc.avatar || restoDoc.image || '';
      if (rawPhoto && typeof rawPhoto === 'string' && rawPhoto.length <= 500) {
        resolvedRestoPhoto = rawPhoto;
      }
      if (Array.isArray(restoDoc.photos)) {
        resolvedRestoPhotos = restoDoc.photos
          .filter(p => typeof p === 'string' && p.length <= 500)
          .slice(0, 3);
      }
    } else if (targetRestaurantId && mongoose.Types.ObjectId.isValid(targetRestaurantId)) {
      try {
        const restoUser = await User.findById(targetRestaurantId).select('profilePicture avatar image photos').lean();
        if (restoUser) {
          const rawPhoto = restoUser.profilePicture || restoUser.avatar || restoUser.image || '';
          if (rawPhoto && typeof rawPhoto === 'string' && rawPhoto.length <= 500) {
            resolvedRestoPhoto = rawPhoto;
          }
          if (Array.isArray(restoUser.photos)) {
            resolvedRestoPhotos = restoUser.photos
              .filter(p => typeof p === 'string' && p.length <= 500)
              .slice(0, 3);
          }
        }
      } catch (_) {}
    }

    const booking = new Booking({
      bookingId: newBookingId,
      customerId: customerId,
      customerName: resolvedCustomerName,
      customerPhone: resolvedCustomerPhone,
      customerPhoto: resolvedCustomerPhoto,
      serviceId,
      serviceName: resolvedCategory,
      categoryName: resolvedCategory,
      businessCategoryName: resolvedCategory,
      supplierCategory: req.body.supplierCategory || resolvedCategory,
      categoryId: req.body.categoryId || null,
      supplierId: canonicalSupplierId || targetRestaurantId || req.body.supplierId || null,
      price: Number(calculatedGrandTotal),
      serviceAddress: finalDestAddr,
      latitude: Number(finalDestLat),
      longitude: Number(finalDestLon),
      scheduledDate: scheduledDate || new Date().toISOString().split('T')[0],
      scheduledTime: scheduledTime || '10:00 AM',
      propertyType: propertyType || 'Apartment',
      numRooms: numRooms || '2 BHK',
      specialInstructions: specialInstructions || req.body.customerNotes || req.body.specialInstructions || '',
      customerNotes: specialInstructions || req.body.customerNotes || req.body.specialInstructions || '',
      // Food Delivery & Restaurant Fields
      providerId: canonicalSupplierId || targetRestaurantId || null,
      restaurantId: canonicalSupplierId || targetRestaurantId || null,
      partnerId: canonicalSupplierId || targetRestaurantId || null,
      restaurantName: resolvedRestoName,
      pickupAddress: resolvedPickupAddr,
      pickupLatitude: resolvedPickupLat,
      pickupLongitude: resolvedPickupLon,
      supplierBusinessAddress: resolvedPickupAddr,
      supplierBusinessLatitude: resolvedPickupLat,
      supplierBusinessLongitude: resolvedPickupLon,
      pickupLocation: {
        latitude: resolvedPickupLat,
        longitude: resolvedPickupLon,
        address: resolvedPickupAddr,
        supplierId: (canonicalSupplierId || targetRestaurantId) ? String(canonicalSupplierId || targetRestaurantId) : null,
      },
      destinationAddress: finalDestAddr,
      destinationLatitude: Number(finalDestLat),
      destinationLongitude: Number(finalDestLon),
      customerAddress: finalDestAddr,
      customerLatitude: Number(finalDestLat),
      customerLongitude: Number(finalDestLon),
      dropLocation: {
        latitude: Number(finalDestLat),
        longitude: Number(finalDestLon),
        address: finalDestAddr,
        customerId: customerId ? String(customerId) : null,
      },
      distanceKm: calculatedDistanceKm,
      deliveryFee: Number(authoritativeDeliveryFee),
      subtotal: Number(subtotal || 0),
      cartItems: sanitizeCartItems(cartItems || req.body.cart || {}),
      deliveryOtp: String(Math.floor(10000 + Math.random() * 90000)),
      otp: String(Math.floor(10000 + Math.random() * 90000)),
      paymentMethod: paymentMethod || 'cash',
      paymentStatus: paymentStatus || (paymentMethod === 'cash' || paymentMethod === 'cod' ? 'PENDING' : 'PAID'),
      razorpayOrderId: razorpayOrderId || req.body.razorpayOrderId || null,
      razorpayPaymentId: razorpayPaymentId || req.body.razorpayPaymentId || null,
      razorpaySignature: razorpaySignature || req.body.razorpaySignature || null,
      restaurantPhoto: resolvedRestoPhoto,
      restaurantPhotos: resolvedRestoPhotos,
      weatherIncentive: Number(weatherIncentive || req.body.weatherSurge || req.body.rainFee || (Boolean(isRaining || req.body.isRaining) ? 10 : 0)),
      isRaining: Boolean(isRaining || req.body.isRaining),
      status: incomingStatus || (isFood ? 'PENDING_RESTAURANT' : 'ORDER_PLACED'),
    });

    // Enforce MongoDB DB write
    await booking.save();

    console.log(`[BOOKING_CREATE]
bookingId: ${booking.bookingId}
customerId: ${booking.customerId}
restaurantId: ${booking.restaurantId || 'NONE'}
partnerId: ${booking.partnerId || 'NONE'}
supplierId: ${booking.supplierId || 'NONE'}
status: ${booking.status}
createdAt: ${booking.createdAt}`);

    // Immediate acknowledgement to Customer socket
    const rawBookingObj = booking.toObject ? booking.toObject() : booking;
    if (_io) {
      if (booking.customerId) {
        _io.to(`customer_${booking.customerId}`).emit('restaurant_ringing', rawBookingObj);
        _io.to(`user_${booking.customerId}`).emit('restaurant_ringing', rawBookingObj);
        _io.to(`customer_${booking.customerId}`).emit('order_placed', rawBookingObj);
      }
      _io.to(`booking_${booking.bookingId}`).emit('restaurant_ringing', rawBookingObj);
      _io.to(`order_${booking.bookingId}`).emit('restaurant_ringing', rawBookingObj);
    }

    // Schedule 20-second delayed dispatch to Supplier Partner
    if (socketHandlerObj && typeof socketHandlerObj.scheduleSupplierOrderDispatch === 'function') {
      socketHandlerObj.scheduleSupplierOrderDispatch(rawBookingObj, 20000);
    }

    return res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      booking: rawBookingObj,
    });
  } catch (error) {
    console.error('[BOOKING_CREATE ERROR]:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Fetch real bookings history for customer or provider from MongoDB
exports.getMyBookings = async (req, res) => {
  try {
    const { userId, role, date, statusFilter, status } = req.query;
    const activeFilter = statusFilter || status || 'ALL';

    const headerRole = (req.headers['x-role'] || '').toLowerCase();
    const queryRole = (role || headerRole || '').toLowerCase();

    // 1. Determine requested role context
    let requestedRole = 'customer';
    if (['rider', 'delivery_partner', 'delivery'].includes(queryRole)) {
      requestedRole = 'rider';
    } else if (['supplier', 'seller_partner', 'restaurant'].includes(queryRole)) {
      requestedRole = 'supplier';
    } else if (queryRole === 'provider') {
      const checkRole = (req.user?.role || '').toLowerCase();
      if (['rider', 'delivery_partner', 'delivery'].includes(checkRole)) {
        requestedRole = 'rider';
      } else {
        requestedRole = 'supplier';
      }
    } else if (queryRole === 'customer') {
      requestedRole = 'customer';
    } else if (req.user && req.user.role) {
      const uRole = (req.user.role || '').toLowerCase();
      if (['rider', 'delivery_partner', 'delivery'].includes(uRole)) requestedRole = 'rider';
      else if (['supplier', 'seller_partner', 'restaurant'].includes(uRole)) requestedRole = 'supplier';
      else requestedRole = 'customer';
    }

    let targetSupplierId = null;
    let targetCustomerId = null;
    let targetRiderId = null;
    let targetPhone = null;

    // 2. Strict Access Control & Role Validation
    if (req.user) {
      const authRole = (req.user.role || '').toLowerCase();
      const authId = req.user._id.toString();

      if (requestedRole === 'supplier') {
        if (['supplier', 'seller_partner', 'restaurant'].includes(authRole)) {
          targetSupplierId = authId;
        } else if (authRole === 'customer') {
          // Cross-account protection: A customer token cannot query supplier bookings unless a verified supplier ID is passed
          if (userId && mongoose.Types.ObjectId.isValid(userId)) {
            const suppDoc = await User.findById(userId).select('role partnerId').lean();
            if (suppDoc && ['supplier', 'seller_partner', 'restaurant'].includes((suppDoc.role || '').toLowerCase())) {
              targetSupplierId = String(suppDoc._id);
            } else {
              // Not a valid supplier -> Prevent customer orders from leaking into supplier panel!
              console.warn(`[getMyBookings] Refusing to return customer orders under supplier query for customer: ${authId}`);
              return res.status(200).json({ success: true, count: 0, bookings: [] });
            }
          } else {
            return res.status(200).json({ success: true, count: 0, bookings: [] });
          }
        } else {
          return res.status(200).json({ success: true, count: 0, bookings: [] });
        }
      } else if (requestedRole === 'rider') {
        if (['rider', 'delivery_partner', 'delivery', 'provider'].includes(authRole)) {
          targetRiderId = authId;
        } else {
          return res.status(200).json({ success: true, count: 0, bookings: [] });
        }
      } else {
        // requestedRole === 'customer'
        const isCustomer = ['customer', 'user', ''].includes(authRole) || !['supplier', 'seller_partner', 'restaurant', 'provider', 'rider', 'delivery_partner', 'delivery', 'admin'].includes(authRole);
        if (isCustomer) {
          targetCustomerId = authId;
          targetPhone = req.user.phoneNumber || req.user.phone || null;
        } else {
          // Supplier or rider token querying customer orders:
          if (userId && mongoose.Types.ObjectId.isValid(userId)) {
            const custDoc = await User.findById(userId).select('role phoneNumber phone').lean();
            const custRole = (custDoc?.role || '').toLowerCase();
            const isCustDoc = ['customer', 'user', ''].includes(custRole) || !['supplier', 'seller_partner', 'restaurant', 'provider', 'rider', 'delivery_partner', 'delivery', 'admin'].includes(custRole);
            if (custDoc && isCustDoc) {
              targetCustomerId = String(custDoc._id);
              targetPhone = custDoc.phoneNumber || custDoc.phone || null;
            } else {
              return res.status(200).json({ success: true, count: 0, bookings: [] });
            }
          } else {
            return res.status(200).json({ success: true, count: 0, bookings: [] });
          }
        }
      }
    } else {
      // Unauthenticated request fallback with DB role verification
      const rawUserId = (userId || '').toString();
      if (!rawUserId) {
        return res.status(200).json({ success: true, count: 0, bookings: [] });
      }

      let targetDoc = null;
      if (mongoose.Types.ObjectId.isValid(rawUserId)) {
        try {
          targetDoc = await User.findById(rawUserId).select('phoneNumber phone partnerId partnerType restaurantName role').lean();
        } catch (e) {}
      }

      const docRole = targetDoc ? (targetDoc.role || '').toLowerCase() : '';

      if (requestedRole === 'supplier') {
        if (targetDoc && !['supplier', 'seller_partner', 'restaurant'].includes(docRole)) {
          // Requested supplier orders, but user doc belongs to a customer! Never leak customer orders!
          console.warn(`[getMyBookings] Query userId ${rawUserId} has role "${docRole}", not supplier. Denying request.`);
          return res.status(200).json({ success: true, count: 0, bookings: [] });
        }
        targetSupplierId = rawUserId;
      } else if (requestedRole === 'rider') {
        if (targetDoc && !['rider', 'delivery_partner', 'delivery', 'provider'].includes(docRole)) {
          return res.status(200).json({ success: true, count: 0, bookings: [] });
        }
        targetRiderId = rawUserId;
      } else {
        if (targetDoc && ['supplier', 'seller_partner', 'restaurant', 'provider', 'rider', 'delivery_partner', 'delivery'].includes(docRole)) {
          console.warn(`[getMyBookings] Query userId ${rawUserId} has role "${docRole}", not customer. Denying customer orders.`);
          return res.status(200).json({ success: true, count: 0, bookings: [] });
        }
        targetCustomerId = rawUserId;
        targetPhone = req.query.phone || (targetDoc ? (targetDoc.phoneNumber || targetDoc.phone) : null);
      }
    }

    console.log(`[getMyBookings] Authorized role: "${requestedRole}", suppId: "${targetSupplierId}", custId: "${targetCustomerId}", riderId: "${targetRiderId}", date: "${date}", statusFilter: "${activeFilter}"`);

    let queryConditions = [];

    if (requestedRole === 'supplier' && targetSupplierId) {
      const sId = String(targetSupplierId);
      queryConditions.push({ supplierId: sId });
      queryConditions.push({ restaurantId: sId });
      queryConditions.push({ providerId: sId });
      queryConditions.push({ partnerId: sId });
    } else if (requestedRole === 'rider' && targetRiderId) {
      const rId = String(targetRiderId);
      queryConditions.push({ riderId: rId });
      queryConditions.push({ providerId: rId });
      queryConditions.push({ assignedRiderId: rId });
      queryConditions.push({ 'assignedRider.id': rId });
      queryConditions.push({ 'assignedRider.riderId': rId });
      queryConditions.push({ 'acceptedBy.riderId': rId });
      if (targetPhone || req.query.phone) {
        queryConditions.push({ riderPhone: String(targetPhone || req.query.phone) });
      }
    } else if (requestedRole === 'customer' && (targetCustomerId || targetPhone || req.query.phone)) {
      if (targetCustomerId) {
        const cId = String(targetCustomerId);
        queryConditions.push({ customerId: cId });
        queryConditions.push({ 'dropLocation.customerId': cId });
      }
      const qPhone = targetPhone || req.query.phone;
      if (qPhone) {
        queryConditions.push({ customerPhone: String(qPhone) });
      }
    }

    if (queryConditions.length === 0) {
      return res.status(200).json({ success: true, count: 0, bookings: [] });
    }

    // Deduplicate conditions
    const seen = new Set();
    const uniqueConditions = [];
    for (const c of queryConditions) {
      const k = JSON.stringify(c);
      if (!seen.has(k)) {
        seen.add(k);
        uniqueConditions.push(c);
      }
    }

    const andClauses = [{ $or: uniqueConditions }];

    // Date filtering (YYYY-MM-DD)
    if (date && typeof date === 'string' && date.toUpperCase() !== 'ALL' && date !== 'null' && date !== 'undefined') {
      const parsedDate = new Date(`${date}T00:00:00.000Z`);
      if (!isNaN(parsedDate.getTime())) {
        const startOfDay = new Date(`${date}T00:00:00.000Z`);
        const endOfDay = new Date(`${date}T23:59:59.999Z`);
        andClauses.push({
          $or: [
            { scheduledDate: date },
            { createdAt: { $gte: startOfDay, $lte: endOfDay } }
          ]
        });
      }
    }

    // Status filtering
    if (activeFilter && activeFilter !== 'ALL' && activeFilter !== 'Order History') {
      const normFilter = activeFilter.toUpperCase();
      if (normFilter === 'COMPLETED') {
        andClauses.push({ status: { $in: ['COMPLETED', 'SERVICE_COMPLETED', 'DELIVERED', 'DELIVERED_SUCCESSFULLY'] } });
      } else if (normFilter === 'CANCELLED') {
        andClauses.push({ status: { $in: ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SUPPLIER', 'CANCELLED_BY_PROVIDER', 'CANCELLED', 'RESTAURANT_DECLINED'] } });
      } else if (normFilter === 'PREPARING' || normFilter === 'PACKING') {
        andClauses.push({ status: { $in: ['PREPARING', 'PACKING', 'ACCEPTED'] } });
      } else if (normFilter === 'READY') {
        andClauses.push({ status: 'FOOD_READY' });
      } else if (normFilter === 'OUT FOR DELIVERY') {
        andClauses.push({ status: { $in: ['OUT_FOR_DELIVERY', 'PICKED_UP', 'STARTED'] } });
      } else {
        andClauses.push({ status: activeFilter });
      }
    }

    const mongoQuery = andClauses.length > 1 ? { $and: andClauses } : andClauses[0];
    console.log('[getMyBookings] 3. Executing Booking.find with query:', JSON.stringify(mongoQuery));
    const tFindStart = Date.now();
    const mongoBookings = await Booking.find(mongoQuery)
      .select('-restaurantPhotos -restaurantPhoto -providerPhoto')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    console.log(`[getMyBookings] 4. Booking.find returned ${mongoBookings?.length} docs in ${Date.now() - tFindStart}ms`);
    const tBatchStart = Date.now();
    const resolvedBookings = await resolveBookingsBatch(mongoBookings || []);
    console.log(`[getMyBookings] 5. resolveBookingsBatch resolved in ${Date.now() - tBatchStart}ms`);

    console.log(`[BOOKING_HISTORY] FETCH
userId: ${userId}
role: ${role || 'customer'}
date: ${date || 'ALL'}
statusFilter: ${activeFilter}
resultCount: ${resolvedBookings.length}`);

    const finalBookings = (requestedRole === 'rider')
      ? resolvedBookings.map(b => redactDropLocationForRider(b, true))
      : resolvedBookings;

    return res.status(200).json({
      success: true,
      supplierId: targetSupplierId || undefined,
      customerId: targetCustomerId || undefined,
      count: finalBookings.length,
      bookings: finalBookings,
    });
  } catch (error) {
    console.error('Error fetching bookings from MongoDB:', error);
    return res.status(200).json({ success: true, count: 0, bookings: [], error: error.message });
  }
};

// Fetch single authoritative active running booking for customer or provider
exports.getActiveBooking = async (req, res) => {
  try {
    const { customerId, role, userId, providerId, restaurantId, riderId } = req.query;
    const targetUserId = customerId || userId || providerId || restaurantId || riderId;
    if (!targetUserId) {
      return res.status(200).json({ success: true, activeBooking: null });
    }

    const activeStatuses = [
      'BOOKING_REQUESTED',
      'PENDING',
      'PENDING_RESTAURANT',
      'RINGING',
      'RESTAURANT_ACCEPTED',
      'PREPARING',
      'FOOD_PREPARING',
      'FOOD_READY',
      'READY_FOR_PICKUP',
      'READY',
      'SEARCHING_FOR_RIDER',
      'OUT_FOR_DELIVERY',
      'ON_THE_WAY',
      'PICKED_UP',
      'ACCEPTED',
      'PROVIDER_ASSIGNED',
      'PROVIDER_ACCEPTED',
      'PROVIDER_ON_THE_WAY',
      'PROVIDER_ARRIVED',
      'STARTED',
      'SERVICE_STARTED',
    ];

    const idList = [targetUserId, String(targetUserId)];
    if (mongoose.Types.ObjectId.isValid(targetUserId)) {
      idList.push(new mongoose.Types.ObjectId(targetUserId));
    }

    const normRole = (role || (req.user ? req.user.role : '') || '').toLowerCase();
    const isSupplier = ['provider', 'supplier', 'seller_partner', 'restaurant'].includes(normRole) || Boolean(restaurantId || providerId);
    const isRider = ['rider', 'delivery_partner', 'delivery'].includes(normRole) || Boolean(riderId);

    let activeConditions = [];
    if (isSupplier) {
      activeConditions = [
        { providerId: { $in: idList } },
        { restaurantId: { $in: idList } },
        { supplierId: { $in: idList } },
        { partnerId: { $in: idList } },
      ];
    } else if (isRider) {
      activeConditions = [
        { riderId: { $in: idList } },
        { assignedRiderId: { $in: idList } },
      ];
    } else {
      activeConditions = [
        { customerId: { $in: idList } },
        { customerPhone: targetUserId },
      ];
    }

    // Only look for active bookings created within last 24 hours and strictly in activeStatuses
    const query = {
      $or: activeConditions,
      status: { $in: activeStatuses },
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    };

    const activeBooking = await Booking.findOne(query).sort({ createdAt: -1 });

    if (!activeBooking) {
      return res.status(200).json({ success: true, activeBooking: null });
    }

    const resolved = await resolveBookingNames(activeBooking.toObject());
    const finalActive = redactDropLocationForRider(resolved, isRider);
    return res.status(200).json({ success: true, activeBooking: finalActive });
  } catch (err) {
    console.error('Error in getActiveBooking:', err);
    return res.status(200).json({ success: true, activeBooking: null, error: err.message });
  }
};

// Dedicated Get Booking Status Endpoint (supports params, queries, and body)
exports.getBookingStatus = async (req, res) => {
  try {
    const bookingId = req.params.bookingId || req.query.bookingId || req.query.rideId || req.query.id || req.body?.bookingId;
    const isCallerRider = ['rider', 'delivery_partner', 'delivery', 'provider'].includes((req.query.role || req.headers['x-role'] || '').toLowerCase());

    if (!bookingId) {
      const uId = req.query.userId || req.query.customerId || req.user?.id || req.user?._id;
      if (uId) {
        const active = await Booking.findOne({
          $or: [{ customerId: String(uId) }, { providerId: String(uId) }, { riderId: String(uId) }],
          status: { $nin: ['COMPLETED', 'CANCELLED', 'DELIVERED'] }
        }).sort({ createdAt: -1 }).lean();
        if (active) {
          const resolved = await resolveBookingNames(active);
          const finalActive = redactDropLocationForRider(resolved, isCallerRider);
          return res.status(200).json({ success: true, booking: finalActive, order: finalActive, status: finalActive.status });
        }
      }
      return res.status(200).json({ success: true, booking: null, status: 'IDLE', message: 'No bookingId provided' });
    }

    let booking = await Booking.findOne({
      $or: [
        { bookingId: String(bookingId) },
        { rideId: String(bookingId) },
        ...(mongoose.Types.ObjectId.isValid(bookingId) ? [{ _id: new mongoose.Types.ObjectId(bookingId) }] : [])
      ]
    }).lean();

    if (!booking) {
      return res.status(200).json({ success: true, booking: null, status: 'NOT_FOUND', message: 'Booking not found' });
    }

    const resolved = await resolveBookingNames(booking);
    const finalBooking = redactDropLocationForRider(resolved, isCallerRider);
    return res.status(200).json({
      success: true,
      booking: finalBooking,
      order: finalBooking,
      status: finalBooking.status,
      deliveryStatus: finalBooking.deliveryStatus,
      riderStatus: finalBooking.riderStatus,
    });
  } catch (error) {
    console.error('Error in getBookingStatus:', error);
    return res.status(200).json({ success: true, booking: null, status: 'UNKNOWN', error: error.message });
  }
};

// Update booking lifecycle status in MongoDB
exports.updateBookingStatus = async (req, res) => {
  try {
    const rawBody = req.body || {};
    const bookingId = req.params.bookingId || rawBody.bookingId || rawBody.rideId || rawBody._id || rawBody.id || (rawBody.data && (rawBody.data.bookingId || rawBody.data.rideId));
    let status = rawBody.status || 'CANCELLED';
    const providerId = rawBody.providerId;
    const providerName = rawBody.providerName;
    const providerPhone = rawBody.providerPhone;
    const cancellationReason = rawBody.cancellationReason || rawBody.reason || 'Cancelled by user';
    const cancelledBy = (rawBody.cancelledBy || 'USER').toUpperCase();

    let booking = null;
    let isFoodOrder = false;

    // Extract authenticated rider ID from JWT or fallback to body
    let authenticatedRiderId = req.user ? req.user.id : providerId;
    if (!authenticatedRiderId && req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwt_secret_dating_app_key');
        authenticatedRiderId = decoded.id;
      } catch (err) {
        console.error('JWT verify failed in updateBookingStatus:', err.message);
      }
    }

    if (status === 'PROVIDER_ACCEPTED' || status === 'ACCEPTED') {
      if (!authenticatedRiderId) {
        return res.status(401).json({ success: false, error: 'UNAUTHENTICATED', message: 'Supplier must be authenticated.' });
      }

      let provider = null;
      if (mongoose.Types.ObjectId.isValid(authenticatedRiderId)) {
        provider = await User.findById(authenticatedRiderId);
      }
      if (!provider) {
        provider = await User.findOne({ $or: [{ _id: authenticatedRiderId }, { partnerId: authenticatedRiderId }] });
      }
      if (!provider) {
        return res.status(404).json({ success: false, error: 'RIDER_NOT_FOUND', message: 'Supplier account not found.' });
      }
      if (provider.isSuspended) {
        return res.status(403).json({ success: false, error: 'RIDER_SUSPENDED', message: 'Supplier account is suspended.' });
      }

      // Check if rider is already busy
      const activeStatuses = [
        'ACCEPTED',
        'PROVIDER_ACCEPTED',
        'PROVIDER_ON_THE_WAY',
        'PROVIDER_ARRIVED',
        'STARTED',
        'SERVICE_STARTED',
        'SERVICE_IN_PROGRESS'
      ];
      const busyBooking = await Booking.findOne({
        providerId: authenticatedRiderId,
        status: { $in: activeStatuses }
      });
      if (busyBooking) {
        return res.status(400).json({ success: false, error: 'RIDER_BUSY', message: 'You already have an active booking.' });
      }

      // Atomic MongoDB update
      const resolvedRiderName = provider.name || provider.username || providerName || 'Service Partner';
      const resolvedRiderPhone = provider.phoneNumber || provider.phone || providerPhone || '';
      const resolvedRiderPhoto = provider.profilePicture || provider.avatar || null;

      const updatedBooking = await Booking.findOneAndUpdate(
        {
          bookingId: bookingId,
          status: { $in: ['BOOKING_REQUESTED', 'PENDING', 'SEARCHING', 'PROVIDER_ASSIGNED'] }
        },
        {
          $set: {
            status: 'PROVIDER_ACCEPTED',
            providerId: authenticatedRiderId,
            providerName: resolvedRiderName,
            providerPhone: resolvedRiderPhone,
            providerPhoto: resolvedRiderPhoto,
            acceptedAt: new Date()
          }
        },
        { new: true }
      );

      if (!updatedBooking) {
        const existing = await Booking.findOne({ bookingId });
        if (existing && !['BOOKING_REQUESTED', 'PENDING', 'SEARCHING', 'PROVIDER_ASSIGNED'].includes(existing.status)) {
          return res.status(400).json({ success: false, error: 'RIDE_ALREADY_ACCEPTED', message: 'This ride has already been accepted by another provider.' });
        }
        return res.status(404).json({ success: false, error: 'BOOKING_NOT_FOUND', message: 'Booking not found.' });
      }

      booking = updatedBooking;
      status = 'PROVIDER_ACCEPTED';

      console.log(`[BOOKING_DB_STATUS] bookingId: ${booking.bookingId} status: ${booking.status}`);

      // Sync pendingRides map in-memory
      const pendingRides = socketHandlerObj.pendingRides;
      if (pendingRides) {
        let ride = pendingRides.get(bookingId) || {};
        ride.bookingId = bookingId;
        ride.rideId = bookingId;
        ride.status = 'ACCEPTED';
        ride.acceptedBy = {
          riderId: authenticatedRiderId,
          riderName: resolvedRiderName,
          riderPhone: resolvedRiderPhone,
          riderPhoto: resolvedRiderPhoto,
          riderLocation: rawBody.riderLocation || null,
        };
        ride.providerId = authenticatedRiderId;
        ride.providerName = resolvedRiderName;
        ride.providerPhone = resolvedRiderPhone;
        ride.providerPhoto = resolvedRiderPhoto;
        pendingRides.set(bookingId, ride);

        console.log(`[SOCKET_ACCEPT_EVENT] bookingId: ${bookingId} status: ${ride.status}`);

        // Emit socket events
        if (_io) {
          _io.emit('ride_accept_success', ride);
          
          if (booking.customerId) {
            _io.to(`user_${booking.customerId}`).emit('service_accepted', ride);
            _io.to(`user_${booking.customerId}`).emit('ride_accepted', ride);
          }
          
          _io.to('riders_room').emit('ride_taken', { rideId: bookingId });
          _io.emit('ride_taken', { rideId: bookingId });
        }
      }
    } else {
      if (bookingId) {
        booking = await Booking.findOne({
          $or: [
            { bookingId: String(bookingId) },
            { rideId: String(bookingId) },
            ...(mongoose.Types.ObjectId.isValid(bookingId) ? [{ _id: new mongoose.Types.ObjectId(bookingId) }] : [])
          ]
        });
      }

      if (!booking) {
        const fallbackUser = rawBody.customerId || rawBody.userId || rawBody.providerId;
        if (fallbackUser) {
          booking = await Booking.findOne({
            $or: [{ customerId: fallbackUser }, { providerId: fallbackUser }]
          }).sort({ createdAt: -1 });
        }
      }

      if (!booking) {
        console.log(`[updateBookingStatus]: No matching booking found for ID ${bookingId}`);
        return res.status(404).json({ success: false, error: 'Booking not found in database' });
      }

      // Race condition guard: Never allow status updates on already cancelled orders
      const cancelledStatuses = ['CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'RESTAURANT_DECLINED', 'NO_RESPONSE', 'TIMEOUT'];
      if (cancelledStatuses.includes(booking.status) && !status.includes('CANCEL')) {
        console.log(`⚠️ [BLOCKED STATUS UPDATE] Order ${bookingId} is already cancelled (${booking.status}). Rejecting update to ${status}.`);
        return res.status(400).json({ success: false, error: 'ORDER_ALREADY_CANCELLED', message: 'This order has already been cancelled.' });
      }

      // Status Regression Protection: Order status must never move backward
      const STATUS_RANKS = {
        'ORDER_PLACED': 1,
        'BOOKING_REQUESTED': 1,
        'PENDING_RESTAURANT': 2,
        'RESTAURANT_ACCEPTED': 3,
        'PREPARING': 4,
        'FOOD_READY': 5,
        'READY_FOR_PICKUP': 5,
        'READY': 5,
        'PROVIDER_ACCEPTED': 6,
        'RIDER_ASSIGNED': 6,
        'RIDER_AT_RESTAURANT': 7,
        'REACHED_RESTAURANT': 7,
        'OUT_FOR_DELIVERY': 8,
        'FOOD_PICKED_UP': 8,
        'PICKED_UP': 8,
        'REACHED_CUSTOMER': 9,
        'DELIVERED': 10,
        'COMPLETED': 10,
        'SERVICE_COMPLETED': 10,
      };

      const currRank = STATUS_RANKS[booking.status] || 0;
      const newRank = STATUS_RANKS[status] || 0;
      if (!status.includes('CANCEL') && currRank > 0 && newRank > 0 && newRank < currRank) {
        console.log(`⚠️ [BLOCKED STATUS REGRESSION] Order ${bookingId} is already at status ${booking.status} (rank ${currRank}). Rejecting regressive update to ${status} (rank ${newRank}).`);
        const resolved = await resolveBookingNames(booking.toObject());
        return res.status(200).json({ success: true, booking: resolved, notice: 'Status regression blocked' });
      }

      isFoodOrder = Boolean(
        booking.serviceName === 'Food Delivery' ||
        booking.categoryName === 'Food Delivery' ||
        Boolean(booking.restaurantId) ||
        (booking.cartItems && typeof booking.cartItems === 'object' && Object.keys(booking.cartItems).length > 0)
      );

      // Determine normalized status for cancellations
      if (status.includes('CANCEL')) {
        const prevStatus = (booking.status || '').toUpperCase();
        status = 'CANCELLED';
        booking.status = status;
        booking.deliveryStatus = 'CANCELLED';
        booking.riderStatus = 'CANCELLED';
        booking.cancellationReason = cancellationReason || 'Order Cancelled';
        const normalizedCancelledBy = (cancelledBy === 'PROVIDER' || cancelledBy === 'SUPPLIER' || cancelledBy === 'RESTAURANT' || cancelledBy === 'PARTNER') ? 'RESTAURANT' : (cancelledBy === 'RIDER' ? 'RIDER' : 'CUSTOMER');
        booking.cancelledBy = normalizedCancelledBy;
        booking.cancelledAt = new Date();

        const isRiderArrived = Boolean(booking.riderReachedAt || booking.riderStatus === 'REACHED_RESTAURANT' || prevStatus === 'REACHED_RESTAURANT' || prevStatus === 'RIDER_AT_RESTAURANT');
        const isReadyStage = ['FOOD_READY', 'READY', 'READY_FOR_PICKUP', 'PACKED', 'REACHED_RESTAURANT'].includes(prevStatus) || booking.riderStatus === 'REACHED_RESTAURANT' || Boolean(booking.foodReadyAt);
        const orderTotal = Number(booking.price || booking.totalAmount || 0);
        const isPaid = (booking.paymentStatus === 'PAID' || booking.paymentStatus === 'COMPLETED' || booking.paymentMethod === 'online' || booking.paymentMethod === 'wallet');

        let supplierGross = 0;
        let supplierNet = 0;
        let riderArrivalComp = 0;

        if (isReadyStage) {
          booking.refundAmount = 0;
          booking.isNonRefundable = true;
          booking.refundStatus = 'NO_REFUND';
          booking.cancellationFee = isPaid ? orderTotal : 0;
          if (isPaid) {
            booking.paymentStatus = 'PAID';
            booking.paidAmount = orderTotal;
          } else {
            booking.paymentStatus = 'CANCELLED';
            booking.paidAmount = 0;
          }
          supplierGross = Number(booking.subtotal || booking.price || orderTotal);
          supplierNet = Math.round(supplierGross * 0.8); // 80% gross value protection for ready food
          console.log(`🛡️ [ZERO REFUND ENFORCED] Order ${booking.bookingId} cancelled at stage ${prevStatus}. Paid: ₹${booking.paidAmount}, Refund: ₹0 (Non-Refundable). Supplier Net: ₹${supplierNet}`);
        } else {
          if (isPaid) {
            booking.refundAmount = orderTotal;
            booking.isNonRefundable = false;
            booking.refundStatus = 'REFUND_PROCESSED';
            booking.paymentStatus = 'REFUNDED';
            booking.paidAmount = orderTotal;
          } else {
            booking.refundAmount = 0;
            booking.isNonRefundable = false;
            booking.refundStatus = 'NOT_APPLICABLE';
            booking.paymentStatus = 'CANCELLED';
            booking.paidAmount = 0;
          }
          console.log(`💳 [REFUND CALCULATED] Order ${booking.bookingId} cancelled at stage ${prevStatus}. Paid: ₹${booking.paidAmount}, Refund: ₹${booking.refundAmount}.`);
        }

        // Guaranteed ₹20 Arrival Compensation for Rider
        const assignedRider = booking.riderId || (isFoodOrder ? null : booking.providerId);
        if (isRiderArrived && assignedRider && !booking.riderArrivalGuaranteedPaid) {
          booking.riderArrivalGuaranteedPaid = true;
          booking.riderCompensation = 20;
          booking.riderCompensationPaid = true;
          booking.riderArrivalFee = 20;
          riderArrivalComp = 20;

          // Credit ₹20 to Rider's wallet / earnings asynchronously
          if (mongoose.Types.ObjectId.isValid(assignedRider)) {
            User.findByIdAndUpdate(assignedRider, {
              $inc: { walletBalance: 20, totalEarnings: 20, availableBalance: 20 }
            }).catch(e => console.error('[Rider Arrival Comp DB Error]:', e.message));

            const Transaction = require('../models/Transaction');
            Transaction.create({
              userId: assignedRider,
              type: 'rider_arrival_guarantee',
              amount: 20,
              currency: 'INR',
              status: 'completed',
              description: `₹20 Guaranteed Arrival Fee for cancelled order ${booking.bookingId}`,
            }).catch(e => console.error('[Transaction Save Error]:', e.message));
          }
          console.log(`🏍️ [RIDER ARRIVAL FEE CREDITED] ₹20 credited to rider ${assignedRider} for cancelled order ${booking.bookingId}`);
        }

        // Financial Breakdown persistence
        const customerPaidAmount = isPaid ? orderTotal : 0;
        const platformShare = Math.max(0, customerPaidAmount - booking.refundAmount - supplierNet - riderArrivalComp);
        booking.financialBreakdown = {
          customerPaid: customerPaidAmount,
          customerRefund: booking.refundAmount,
          supplierGross: supplierGross,
          supplierDeductions: Math.max(0, supplierGross - supplierNet),
          supplierNet: supplierNet,
          riderFare: 0,
          riderArrivalCompensation: riderArrivalComp,
          platformShare: platformShare,
        };

        riderSearchService.clearDelayedRiderSearch(booking.bookingId);
        riderSearchService.clearBookingTimeout(booking.bookingId);

        if (assignedRider && mongoose.Types.ObjectId.isValid(assignedRider)) {
          User.findByIdAndUpdate(assignedRider, { isAvailable: true }).catch(() => {});
          const socketHandlerObj = require('../sockets/socketHandler');
          if (socketHandlerObj.onlineRiders && socketHandlerObj.onlineRiders.has(assignedRider.toString())) {
            const mem = socketHandlerObj.onlineRiders.get(assignedRider.toString());
            if (mem) { mem.isAvailable = true; socketHandlerObj.onlineRiders.set(assignedRider.toString(), mem); }
          }
        }
      } else if (isFoodOrder && (status === 'PROVIDER_ARRIVED' || status === 'REACHED_RESTAURANT')) {
        // STRICT STATUS SEPARATION: Rider reaching restaurant MUST NEVER change order status!
        // Order status remains PREPARING (or current state). Only riderStatus changes to REACHED_RESTAURANT.
        booking.riderStatus = 'REACHED_RESTAURANT';
        booking.riderReachedAt = new Date();
        booking.deliveryStatus = 'RIDER_AT_RESTAURANT';
        console.log(`ORDER #${booking.bookingId} | ACTOR: RIDER | EVENT: REACHED_RESTAURANT | RIDER_STATUS: REACHED_RESTAURANT | ORDER_STATUS: ${booking.status}`);
      } else if (status === 'SERVICE_STARTED' || status === 'STARTED' || status === 'OUT_FOR_DELIVERY' || status === 'FOOD_PICKED_UP') {
        booking.status = isFoodOrder ? 'OUT_FOR_DELIVERY' : 'SERVICE_STARTED';
        booking.startedAt = new Date();
        if (isFoodOrder) {
          booking.riderStatus = 'OUT_FOR_DELIVERY';
          booking.deliveryStatus = 'OUT_FOR_DELIVERY';
          booking.pickedUpAt = new Date();
        }
      } else if (status === 'SERVICE_COMPLETED' || status === 'COMPLETED' || status === 'DELIVERED') {
        booking.status = 'COMPLETED';
        booking.completedAt = new Date();
        if (isFoodOrder) {
          booking.riderStatus = 'DELIVERED';
          booking.deliveryStatus = 'DELIVERED';
        }
      } else {
        booking.status = status;
      }

      if (providerId) {
        booking.providerId = providerId;
        if (typeof providerId === 'string' && providerId.match(/^[0-9a-fA-F]{24}$/)) {
          const provider = await User.findById(providerId).lean();
          if (provider) {
            booking.providerName = provider.name || provider.username || providerName || booking.providerName;
            booking.providerPhone = provider.phoneNumber || provider.phone || providerPhone || booking.providerPhone;
            booking.providerPhoto = provider.profilePicture || provider.avatar || rawBody.providerPhoto || booking.providerPhoto;
          } else if (providerName) {
            booking.providerName = providerName;
          }
        } else if (providerName) {
          booking.providerName = providerName;
        }
      }
      if (rawBody.providerPhoto) booking.providerPhoto = rawBody.providerPhoto;
      if (providerPhone) booking.providerPhone = providerPhone;

      if (status === 'COMPLETED' || status === 'SERVICE_COMPLETED' || status === 'DELIVERED') {
        booking.deliveryStatus = 'DELIVERED';
        booking.riderStatus = 'DELIVERED';
      } else if (status === 'STARTED' || status === 'SERVICE_STARTED' || status === 'OUT_FOR_DELIVERY') {
        booking.deliveryStatus = 'OUT_FOR_DELIVERY';
        booking.riderStatus = 'OUT_FOR_DELIVERY';
      } else if (status === 'REACHED_CUSTOMER' || status === 'ARRIVED_AT_DROP') {
        booking.deliveryStatus = 'OUT_FOR_DELIVERY';
        booking.riderStatus = 'REACHED_CUSTOMER';
      } else if (status === 'PROVIDER_ARRIVED' || status === 'REACHED_RESTAURANT') {
        if (isFoodOrder) {
          booking.deliveryStatus = 'RIDER_AT_RESTAURANT';
          booking.riderStatus = 'REACHED_RESTAURANT';
        } else {
          booking.deliveryStatus = 'RIDER_ASSIGNED';
        }
      }

      // Enforce MongoDB save
      if (booking.latitude == null) booking.latitude = 0;
      if (booking.longitude == null) booking.longitude = 0;
      if (!booking.serviceAddress) booking.serviceAddress = 'Service Location';
      if (!booking.scheduledDate) booking.scheduledDate = new Date().toISOString().split('T')[0];
      if (!booking.scheduledTime) booking.scheduledTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      await booking.save({ validateModifiedOnly: true });
    }

    // Broadcast status update via Socket.IO immediately to sync Customer, Restaurant & Rider
    if (_io) {
      const payload = {
        bookingId: booking.bookingId,
        rideId: booking.bookingId,
        status: booking.status,
        riderStatus: booking.riderStatus,
        deliveryStatus: booking.deliveryStatus,
        providerId: booking.providerId,
        providerName: booking.providerName,
        providerPhone: booking.providerPhone,
        providerPhoto: booking.providerPhoto,
        customerId: booking.customerId,
        customerName: booking.customerName,
        restaurantId: booking.restaurantId,
        restaurantName: booking.restaurantName,
        riderId: booking.riderId,
        cancelledBy: booking.cancelledBy,
        cancellationReason: booking.cancellationReason || 'Order Cancelled',
        reason: booking.cancellationReason || 'Order Cancelled',
        serviceName: booking.serviceName,
        categoryName: booking.categoryName,
        price: booking.price,
        updatedAt: booking.updatedAt
      };
      _io.emit('booking_status_updated', payload);
      
      // If rider reached restaurant, emit dedicated event for restaurant and live tracking
      if (booking.riderStatus === 'REACHED_RESTAURANT' || status === 'REACHED_RESTAURANT' || status === 'PROVIDER_ARRIVED') {
        const riderReachedPayload = {
          bookingId: booking.bookingId,
          rideId: booking.bookingId,
          riderId: booking.providerId || authenticatedRiderId,
          riderName: booking.providerName,
          riderPhone: booking.providerPhone,
          riderPhoto: booking.providerPhoto,
          riderStatus: 'REACHED_RESTAURANT',
          status: booking.status, // Remains PREPARING
          orderStatus: booking.status,
          reachedAt: booking.riderReachedAt || new Date(),
        };
        if (booking.restaurantId) {
          _io.to(`user_${booking.restaurantId}`).emit('rider_reached_restaurant', riderReachedPayload);
        }
        _io.to(`booking_${booking.bookingId}`).emit('rider_reached_restaurant', riderReachedPayload);
        _io.emit('rider_reached_restaurant', riderReachedPayload);
      }

      if (booking.status === 'CANCELLED') {
        _io.emit('order_cancelled', payload);
        _io.emit('order_status_updated', payload);
        _io.emit('booking_status_updated', payload);
        _io.emit('rider_arrived_removed', { bookingId: booking.bookingId });

        if (booking.customerId) {
          _io.to(`user_${booking.customerId}`).emit('order_cancelled', payload);
          _io.to(`user_${booking.customerId}`).emit('service_cancelled', payload);
          _io.to(`user_${booking.customerId}`).emit('ride_cancelled', payload);
          _io.to(`user_${booking.customerId}`).emit('order_status_updated', payload);
          _io.to(`user_${booking.customerId}`).emit('booking_status_updated', payload);
        }
        if (booking.restaurantId) {
          _io.to(`user_${booking.restaurantId}`).emit('order_cancelled', payload);
          _io.to(`user_${booking.restaurantId}`).emit('rider_arrived_removed', { bookingId: booking.bookingId });
          _io.to(`user_${booking.restaurantId}`).emit('order_status_updated', payload);
          _io.to(`user_${booking.restaurantId}`).emit('booking_status_updated', payload);
        }
        if (booking.riderId) {
          _io.to(`user_${booking.riderId}`).emit('order_cancelled', payload);
          _io.to(`rider_${booking.riderId}`).emit('order_cancelled', payload);
          _io.to(`user_${booking.riderId}`).emit('DELIVERY_REQUEST_CANCELLED', { bookingId: booking.bookingId, reason: booking.cancellationReason });
          _io.to(`user_${booking.riderId}`).emit('order_status_updated', payload);
        }
        if (booking.providerId && booking.providerId !== booking.restaurantId) {
          _io.to(`user_${booking.providerId}`).emit('order_cancelled', payload);
          _io.to(`user_${booking.providerId}`).emit('service_cancelled', payload);
          _io.to(`user_${booking.providerId}`).emit('ride_cancelled', payload);
        }
        _io.to('riders_room').emit('DELIVERY_REQUEST_CANCELLED', { bookingId: booking.bookingId, reason: booking.cancellationReason });
        _io.to('riders_room').emit('order_cancelled', payload);
        _io.to(`booking_${booking.bookingId}`).emit('order_cancelled', payload);
        _io.to(`booking_${booking.bookingId}`).emit('order_status_updated', payload);
      } else {
        if (booking.customerId) {
          _io.to(`user_${booking.customerId}`).emit('booking_status_updated', payload);
          _io.to(`user_${booking.customerId}`).emit('order_status_updated', payload);

          // Dynamic Single Notification for Customer (Requirement 11)
          try {
            const notifService = require('../services/notificationService');
            const rawCat = (booking.categoryName || booking.businessCategoryName || booking.serviceName || booking.supplierCategory || '').toLowerCase();
            let catType = 'store';
            let storeTitle = 'Store';
            let isFood = false;

            if (rawCat.includes('food') || rawCat.includes('restaurant') || booking.restaurantId) {
              isFood = true;
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
            const bIdShort = String(booking.bookingId || booking._id || '').slice(-6);

            let notifTitle = 'Order Update';
            let notifText = `Order #${bIdShort} update: ${booking.status}`;
            const currentStage = (booking.riderStatus || booking.status || '').toUpperCase();

            if (currentStage === 'REACHED_RESTAURANT' || currentStage === 'ARRIVED_AT_STORE' || currentStage === 'AT_RESTAURANT') {
              notifTitle = `Rider at ${storeTitle}`;
              notifText = `Rider has reached ${reachedTarget}.`;
            } else if (currentStage === 'FOOD_PREPARING' || currentStage === 'PREPARING' || currentStage === 'RESTAURANT_ACCEPTED') {
              notifTitle = isFood ? 'Food Preparing' : `${storeTitle} Packing Order`;
              notifText = isFood ? 'Your meal is being prepared.' : `Your order is being packed at ${reachedTarget}.`;
            } else if (currentStage === 'FOOD_READY' || currentStage === 'READY' || currentStage === 'READY_FOR_PICKUP') {
              notifTitle = isFood ? 'Food Ready' : 'Order Packed & Ready';
              notifText = isFood ? 'Your meal is ready for pickup.' : `Your order is packed and ready for pickup at ${reachedTarget}.`;
            } else if (currentStage === 'OUT_FOR_DELIVERY' || currentStage === 'FOOD_PICKED_UP' || currentStage === 'PICKED_UP') {
              notifTitle = 'Out for Delivery';
              notifText = 'Rider has collected your order and is on the way to your location.';
            } else if (currentStage === 'REACHED_CUSTOMER') {
              notifTitle = 'Rider Arrived';
              notifText = 'Rider has reached your delivery location.';
            } else if (currentStage === 'DELIVERED' || currentStage === 'COMPLETED') {
              notifTitle = 'Order Delivered';
              notifText = isFood ? 'Order delivered successfully. Enjoy your meal!' : 'Order delivered successfully. Thank you for shopping with us!';
            }

            notifService.updateOrSendOrderNotification(
              booking.customerId,
              booking.providerId || booking.riderId || null,
              booking.bookingId,
              currentStage,
              notifText,
              notifTitle,
              _io,
              { bookingId: booking.bookingId, status: booking.status, riderStatus: booking.riderStatus }
            ).catch((err) => console.warn('[Notif Send Warn]:', err.message));
          } catch (notifErr) {
            console.warn('[Notification Error in updateBookingStatus]:', notifErr.message);
          }
        }
        if (booking.providerId) {
          _io.to(`user_${booking.providerId}`).emit('booking_status_updated', payload);
          _io.to(`user_${booking.providerId}`).emit('order_status_updated', payload);
        }
        if (booking.restaurantId) {
          _io.to(`user_${booking.restaurantId}`).emit('booking_status_updated', payload);
          _io.to(`user_${booking.restaurantId}`).emit('order_status_updated', payload);
        }
      }
    }

    if (status.includes('CANCEL')) {
      console.log(`[BOOKING] CANCEL
bookingId: ${booking.bookingId}
cancelledBy: ${booking.cancelledBy}
status: ${booking.status}
databaseUpdated: true`);
    } else if (status === 'COMPLETED' || status === 'SERVICE_COMPLETED' || status === 'DELIVERED') {
      console.log(`[BOOKING] COMPLETE
bookingId: ${booking.bookingId}
status: ${booking.status}
databaseUpdated: true`);

      if (!isFoodOrder && booking) {
        isFoodOrder = Boolean(
          booking.serviceName === 'Food Delivery' ||
          booking.categoryName === 'Food Delivery' ||
          Boolean(booking.restaurantId) ||
          (booking.cartItems && typeof booking.cartItems === 'object' && Object.keys(booking.cartItems).length > 0)
        );
      }

      try {
        const effectiveRestaurantId = booking.restaurantId || booking.partnerId;
        const effectiveRiderId = booking.riderId || (isFoodOrder ? null : booking.providerId);
        const restoEarnedAmount = getOrderRestaurantEarning(booking);
        const riderEarnedAmount = getOrderRiderEarning(booking);
        const Transaction = require('../models/Transaction');

        // 1. Credit Restaurant/Store for food/items subtotal (Idempotent: exactly once per bookingId)
        if (effectiveRestaurantId && restoEarnedAmount > 0) {
          try {
            const existingRestoTx = await Transaction.findOne({
              userId: effectiveRestaurantId,
              description: { $regex: String(booking.bookingId) }
            }).lean();

            if (!existingRestoTx) {
              await Transaction.create({
                userId: effectiveRestaurantId,
                type: 'service_earning',
                amount: restoEarnedAmount,
                currency: 'INR',
                status: 'completed',
                description: `Order completed: ${booking.restaurantName || booking.serviceName || 'Store Order'} (#${booking.bookingId})`,
              });
              await User.findByIdAndUpdate(effectiveRestaurantId, {
                $inc: {
                  walletBalance: restoEarnedAmount,
                  totalEarnings: restoEarnedAmount,
                  availableBalance: restoEarnedAmount,
                }
              }).catch(() => {});
              console.log(`💾 [RESTAURANT TRANSACTION SAVED]: Store earning of ₹${restoEarnedAmount} credited to wallet for restaurant ${effectiveRestaurantId}`);
            } else {
              console.log(`⚡ [IDEMPOTENT RESTAURANT EARNING]: Store earning for #${booking.bookingId} already credited.`);
            }
          } catch (tErr) {
            console.error('Error saving restaurant transaction on completion:', tErr.message);
          }
        }

        // 2. Credit Rider for exact delivery fee paid by customer (Idempotent: exactly once per bookingId)
        if (effectiveRiderId && riderEarnedAmount > 0) {
          try {
            const existingRiderTx = await Transaction.findOne({
              userId: effectiveRiderId,
              description: { $regex: String(booking.bookingId) }
            }).lean();

            if (!existingRiderTx) {
              await Transaction.create({
                userId: effectiveRiderId,
                type: 'delivery_earning',
                amount: riderEarnedAmount,
                currency: 'INR',
                status: 'completed',
                description: `Delivery fee earned for Order #${booking.bookingId} (${booking.restaurantName || 'Store'} → ${booking.customerName || 'Customer'})`,
              });
              await User.findByIdAndUpdate(effectiveRiderId, {
                $inc: {
                  walletBalance: riderEarnedAmount,
                  totalEarnings: riderEarnedAmount,
                  availableBalance: riderEarnedAmount,
                }
              }).catch(() => {});
              console.log(`💾 [RIDER TRANSACTION SAVED]: Delivery earning of ₹${riderEarnedAmount} credited to wallet for rider ${effectiveRiderId}`);
            } else {
              console.log(`⚡ [IDEMPOTENT RIDER EARNING]: Delivery earning for #${booking.bookingId} already credited to rider ${effectiveRiderId}.`);
            }
          } catch (rErr) {
            console.error('Error saving rider transaction on completion:', rErr.message);
          }
        }

        // Emit real-time socket events so restaurant and rider apps instantly update wallet/pocket balance
        try {
          if (_io) {
            const compPayload = {
              bookingId: booking.bookingId,
              rideId: booking.bookingId,
              restaurantId: effectiveRestaurantId,
              riderId: effectiveRiderId,
              customerId: booking.customerId,
              price: restoEarnedAmount,
              earningAmount: restoEarnedAmount,
              riderEarning: riderEarnedAmount,
              foodTotal: restoEarnedAmount,
              status: 'COMPLETED',
            };
            _io.emit('service_completed', compPayload);
            _io.emit('booking_status_updated', compPayload);
            _io.emit('order_status_updated', compPayload);

            if (booking.customerId) {
              _io.to(`user_${booking.customerId}`).emit('order_status_updated', compPayload);
              _io.to(`user_${booking.customerId}`).emit('service_completed', compPayload);
            }

            // Emit to Restaurant
            if (effectiveRestaurantId) {
              _io.to(`user_${effectiveRestaurantId}`).emit('earnings_updated', { ...compPayload, price: restoEarnedAmount, pocketBalance: restoEarnedAmount });
              _io.to(`restaurant_${effectiveRestaurantId}`).emit('earnings_updated', { ...compPayload, price: restoEarnedAmount, pocketBalance: restoEarnedAmount });
              _io.to(`user_${effectiveRestaurantId}`).emit('order_status_updated', compPayload);
              _io.to(`restaurant_${effectiveRestaurantId}`).emit('order_status_updated', compPayload);
            }

            // Emit to Rider
            if (effectiveRiderId) {
              const riderPayload = { ...compPayload, price: riderEarnedAmount, pocketBalance: riderEarnedAmount, earning: riderEarnedAmount };
              _io.to(`user_${effectiveRiderId}`).emit('earnings_updated', riderPayload);
              _io.to(`rider_${effectiveRiderId}`).emit('earnings_updated', riderPayload);
              _io.to(`user_${effectiveRiderId}`).emit('order_status_updated', compPayload);
              _io.to(`rider_${effectiveRiderId}`).emit('order_status_updated', compPayload);
            }
          }
        } catch (sErr) {}
      } catch (compErr) {
        console.error('Error during post-completion processing:', compErr.message);
      }
    } else {
      console.log(`[BOOKING] STATUS UPDATE
bookingId: ${booking.bookingId}
status: ${booking.status}
databaseUpdated: true`);
    }

    const bookingObj = await resolveBookingNames(booking.toObject());
    return res.status(200).json({ success: true, booking: bookingObj });
  } catch (error) {
    console.error('Error updating booking status:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Rate completed service – supports separate restaurant & rider ratings
exports.rateBooking = async (req, res) => {
  try {
    const { bookingId, rating, reviewText, ratingTarget } = req.body;
    let booking = await Booking.findOne({ bookingId });
    if (!booking && mongoose.Types.ObjectId.isValid(bookingId)) {
      booking = await Booking.findById(bookingId);
    }
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const numRating = Math.min(5, Math.max(1, Number(rating) || 5));
    const feedback = (reviewText || '').trim();
    const now = new Date();

    if (ratingTarget === 'restaurant') {
      booking.restaurantRating = numRating;
      booking.restaurantFeedback = feedback;
      booking.restaurantRatedAt = now;
    } else if (ratingTarget === 'rider') {
      booking.riderRating = numRating;
      booking.riderFeedback = feedback;
      booking.riderRatedAt = now;
    } else {
      // Legacy / fallback: write to both old generic field AND restaurant field
      booking.rating = numRating;
      booking.reviewText = feedback;
      booking.restaurantRating = numRating;
      booking.restaurantFeedback = feedback;
      booking.restaurantRatedAt = now;
    }

    await booking.save();

    const bookingObj = await resolveBookingNames(booking.toObject());
    return res.status(200).json({
      success: true,
      message: ratingTarget
        ? `${ratingTarget.charAt(0).toUpperCase() + ratingTarget.slice(1)} rated successfully`
        : 'Rating submitted successfully',
      booking: bookingObj,
    });
  } catch (error) {
    console.error('Error rating booking:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Provider/Rider Earnings Summary (Real Completed Services / Deliveries - Total Withdrawals)
exports.getProviderEarnings = async (req, res) => {
  try {
    const { providerId, date, month, year } = req.query;
    if (!providerId) {
      return res.status(400).json({ success: false, error: 'providerId is required' });
    }

    const JOINING_BONUS = 0; // 100% Real Order Earnings Only - No Dummy Bonus
    const User = require('../models/User');

    // Build matching IDs list to match ObjectId, string ID, and phone numbers
    const idVariants = [providerId, String(providerId)];
    let providerUser = null;
    if (mongoose.Types.ObjectId.isValid(providerId)) {
      try {
        providerUser = await User.findById(providerId);
        if (providerUser) {
          if (providerUser._id) idVariants.push(providerUser._id);
          if (providerUser.id) idVariants.push(providerUser.id);
          if (providerUser.phoneNumber) idVariants.push(providerUser.phoneNumber);
        }
      } catch (e) {}
    } else {
      try {
        providerUser = await User.findOne({
          $or: [{ phoneNumber: providerId }, { phone: providerId }, { username: providerId }]
        });
        if (providerUser) {
          idVariants.push(providerUser._id);
          idVariants.push(String(providerUser._id));
        }
      } catch (e) {}
    }

    const isRider = (
      req.query.role === 'rider' ||
      req.query.role === 'driver' ||
      req.query.role === 'delivery_partner' ||
      (providerUser && ['rider', 'driver', 'delivery_partner'].includes(providerUser.role))
    );

    // Build date range filter if date or month/year supplied
    const dateQuery = {};
    if (date && date !== 'All Time' && date !== 'Today') {
      const targetDate = new Date(date);
      if (!isNaN(targetDate.getTime())) {
        const startOfDay = new Date(targetDate.toISOString().split('T')[0] + 'T00:00:00.000Z');
        const endOfDay = new Date(targetDate.toISOString().split('T')[0] + 'T23:59:59.999Z');
        dateQuery.$or = [
          { completedAt: { $gte: startOfDay, $lte: endOfDay } },
          { scheduledDate: date },
        ];
      }
    } else if (date === 'Today') {
      const todayStr = new Date().toISOString().split('T')[0];
      const startOfDay = new Date(todayStr + 'T00:00:00.000Z');
      const endOfDay = new Date(todayStr + 'T23:59:59.999Z');
      dateQuery.$or = [
        { completedAt: { $gte: startOfDay, $lte: endOfDay } },
        { scheduledDate: todayStr },
      ];
    } else if (month && year) {
      const startOfMonth = new Date(Number(year), Number(month)-1, 1);
      const endOfMonth = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);
      dateQuery.$or = [
        { completedAt: { $gte: startOfMonth, $lte: endOfMonth } },
      ];
    }

    const mainFilter = {
      $or: isRider
        ? [
            { riderId: { $in: idVariants } },
            { providerId: { $in: idVariants } },
          ]
        : [
            { providerId: { $in: idVariants } },
            { restaurantId: { $in: idVariants } },
            { partnerId: { $in: idVariants } },
          ],
      status: { $in: ['COMPLETED', 'SERVICE_COMPLETED', 'DELIVERED'] },
    };
    // Merge date filter if present
    if (dateQuery.$or) {
      mainFilter.$and = [{ $or: dateQuery.$or }];
    }
    const completedBookings = await Booking.find(mainFilter).sort({ completedAt: -1 });

    const calcEarning = (b) => isRider ? getOrderRiderEarning(b) : getOrderRestaurantEarning(b);
    const totalServiceEarnings = completedBookings.reduce((sum, b) => sum + calcEarning(b), 0);
    const totalEarnings = totalServiceEarnings;

    // Fetch total requested & approved withdrawals for this provider
    const Withdrawal = require('../models/Withdrawal');
    let withdrawals = [];
    try {
      withdrawals = await Withdrawal.find({
        userId: { $in: idVariants },
        status: { $in: ['pending', 'approved'] }
      });
    } catch (e) {}

    const totalWithdrawn = withdrawals.reduce((sum, w) => sum + (w.withdrawAmount || 0), 0);
    // Real Pocket Balance = Total Real Earnings - Total Withdrawn
    const pocketBalance = Math.max(0, totalServiceEarnings - totalWithdrawn);

    // Filter today's earnings
    const todayStr = new Date().toISOString().split('T')[0];
    const todayBookings = completedBookings.filter((b) => {
      const bDate = b.completedAt ? b.completedAt.toISOString().split('T')[0] : (b.scheduledDate || '');
      return bDate === todayStr;
    });
    const todaysEarnings = todayBookings.reduce((sum, b) => sum + calcEarning(b), 0);

    // Breakdown list for calendar
    const earningsList = [];
    for (let b of completedBookings) {
      const resolved = await resolveBookingNames(b.toObject());
      const itemEarning = calcEarning(resolved);
      earningsList.push({
        id: resolved.bookingId,
        bookingId: resolved.bookingId,
        serviceName: isRider ? (resolved.restaurantName ? `Delivery (${resolved.restaurantName})` : 'Delivery Completed') : (resolved.serviceName || 'Store Order'),
        date: resolved.scheduledDate || (resolved.completedAt ? resolved.completedAt.toISOString().split('T')[0] : todayStr),
        time: resolved.scheduledTime || '10:00 AM',
        price: itemEarning,
        netEarning: itemEarning,
        customerName: resolved.customerName,
        status: resolved.status,
      });
    }

    return res.status(200).json({
      success: true,
      joiningBonus: JOINING_BONUS,
      todaysEarnings,
      totalServiceEarnings,
      totalEarnings,
      totalWithdrawn,
      pocketBalance,
      completedServicesCount: completedBookings.length,
      averageEarning: completedBookings.length ? Math.round(totalServiceEarnings / completedBookings.length) : 0,
      earningsList,
      withdrawals,
    });
  } catch (error) {
    console.error('Error calculating provider earnings:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Provider/Rider Withdrawal Request endpoint
exports.requestProviderWithdrawal = async (req, res) => {
  try {
    const { providerId, userId, withdrawAmount, upiId, bankDetails } = req.body;
    const authId = req.user && !req.user.isAdmin ? req.user._id.toString() : null;
    const pId = authId || providerId || userId || (req.user && req.user.id);
    const amount = Number(withdrawAmount);

    if (!pId) {
      return res.status(400).json({ success: false, message: 'providerId is required' });
    }
    if (isNaN(amount) || amount < 1) {
      return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is ₹1.' });
    }

    const resolvedBankDetails = bankDetails || (upiId ? `UPI ID: ${upiId}` : 'UPI Payout');

    const User = require('../models/User');
    const JOINING_BONUS = 0;

    const idVariants = [pId, String(pId)];
    let providerUser = null;
    try {
      providerUser = await User.findById(pId);
      if (providerUser) {
        if (providerUser._id) idVariants.push(String(providerUser._id));
        if (providerUser.partnerId) idVariants.push(String(providerUser.partnerId));
      }
    } catch (e) {}

    const isRider = (
      req.body.role === 'rider' ||
      (providerUser && ['rider', 'driver', 'delivery_partner'].includes(providerUser.role))
    );

    const completedBookings = await Booking.find({
      $or: isRider
        ? [
            { riderId: { $in: idVariants } },
            { providerId: { $in: idVariants } },
          ]
        : [
            { providerId: { $in: idVariants } },
            { restaurantId: { $in: idVariants } },
            { partnerId: { $in: idVariants } },
          ],
      status: { $in: ['COMPLETED', 'SERVICE_COMPLETED', 'DELIVERED'] },
    });
    const totalServiceEarnings = completedBookings.reduce((sum, b) => sum + (isRider ? getOrderRiderEarning(b) : getOrderRestaurantEarning(b)), 0);

    const Withdrawal = require('../models/Withdrawal');
    const prevWithdrawals = await Withdrawal.find({
      userId: { $in: idVariants },
      status: { $in: ['pending', 'approved'] }
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

    const Transaction = require('../models/Transaction');
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
      console.error('Error creating transaction record:', tErr.message);
    }

    console.log(`💸 [WITHDRAWAL REQUEST CREATED]: Provider: ${pId}, Amount: ₹${amount}, Details: ${resolvedBankDetails}`);

    try {
      const _io = req.app.get('io') || global.io;
      if (_io) {
        const payload = { userId: pId, pocketBalance: newBalance, withdrawAmount: amount };
        _io.to(`user_${pId}`).emit('earnings_updated', payload);
        _io.to(`restaurant_${pId}`).emit('earnings_updated', payload);
        _io.to(`rider_${pId}`).emit('earnings_updated', payload);
        _io.emit('withdrawal_created', withdrawal);
      }
    } catch (sErr) {}

    return res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted successfully! Admin will review and process your payout.',
      withdrawal,
      pocketBalance: newBalance,
      totalEarnings: JOINING_BONUS + totalServiceEarnings,
    });
  } catch (error) {
    console.error('Error processing withdrawal request:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get merged real-time Transaction History for Provider/Rider
exports.getProviderTransactions = async (req, res) => {
  try {
    const authId = req.user && !req.user.isAdmin ? req.user._id.toString() : null;
    const pId = authId || req.query.providerId || req.query.userId || (req.user && req.user.id);
    if (!pId) {
      return res.status(400).json({ success: false, message: 'providerId is required' });
    }

    const Transaction = require('../models/Transaction');
    const Booking = require('../models/Booking');
    const Withdrawal = require('../models/Withdrawal');
    const User = require('../models/User');

    // Build matching IDs list to match ObjectId, string ID, and phone numbers
    const idVariants = [pId, String(pId)];
    let providerUser = null;
    if (mongoose.Types.ObjectId.isValid(pId)) {
      try {
        providerUser = await User.findById(pId);
        if (providerUser) {
          if (providerUser._id) idVariants.push(providerUser._id);
          if (providerUser.id) idVariants.push(providerUser.id);
          if (providerUser.phoneNumber) idVariants.push(providerUser.phoneNumber);
        }
      } catch (e) {}
    } else {
      try {
        providerUser = await User.findOne({
          $or: [{ phoneNumber: pId }, { phone: pId }, { username: pId }]
        });
        if (providerUser) {
          idVariants.push(providerUser._id);
          idVariants.push(String(providerUser._id));
        }
      } catch (e) {}
    }

    const isRider = (
      req.query.role === 'rider' ||
      req.query.role === 'driver' ||
      req.query.role === 'delivery_partner' ||
      (providerUser && ['rider', 'driver', 'delivery_partner'].includes(providerUser.role))
    );

    // 1. Fetch completed bookings for this provider/rider
    const completedBookings = await Booking.find({
      $or: isRider
        ? [
            { riderId: { $in: idVariants } },
            { providerId: { $in: idVariants } },
          ]
        : [
            { providerId: { $in: idVariants } },
            { restaurantId: { $in: idVariants } },
            { partnerId: { $in: idVariants } },
          ],
      status: { $in: ['COMPLETED', 'SERVICE_COMPLETED', 'DELIVERED'] }
    }).sort({ completedAt: -1, createdAt: -1 }).lean();

    // 2. Fetch withdrawal requests for this provider
    const withdrawals = await Withdrawal.find({
      userId: { $in: idVariants }
    }).sort({ createdAt: -1 }).lean();

    // 3. Fetch mongo transactions
    const mongoTransactions = await Transaction.find({
      userId: { $in: idVariants }
    }).sort({ createdAt: -1 }).lean();

    const combinedMap = new Map();

    // Add completed service / delivery earnings
    completedBookings.forEach(b => {
      const key = `b_${b.bookingId || b._id}`;
      const earned = isRider ? getOrderRiderEarning(b) : getOrderRestaurantEarning(b);
      combinedMap.set(key, {
        id: b.bookingId || b._id,
        type: isRider ? 'delivery_earning' : 'service_earning',
        title: isRider ? (b.restaurantName ? `Delivery (${b.restaurantName})` : 'Delivery Completed') : (b.serviceName || b.categoryName || 'Store Order Completed'),
        subtitle: `Cust: ${b.customerName || 'Customer'}`,
        amount: earned,
        isCredit: true,
        status: 'completed',
        date: b.completedAt || b.scheduledDate || b.createdAt,
      });
    });

    // Add withdrawal requests
    withdrawals.forEach(w => {
      const key = `w_${w._id}`;
      combinedMap.set(key, {
        id: String(w._id),
        type: 'withdrawal_payout',
        title: 'Withdrawal Request',
        subtitle: `${typeof w.bankDetails === 'string' ? w.bankDetails : 'UPI Payout'}`,
        amount: Number(w.withdrawAmount || 0),
        isCredit: false,
        status: w.status || 'pending',
        date: w.createdAt,
      });
    });

    // Add mongo transactions if not duplicate of booking or withdrawal
    mongoTransactions.forEach(t => {
      let isDuplicate = false;
      for (const [k, item] of combinedMap.entries()) {
        if (k === 'joining_bonus') continue;
        if (
          Math.abs(item.amount) === Math.abs(t.amount) &&
          Math.abs(new Date(item.date).getTime() - new Date(t.createdAt).getTime()) < 120000
        ) {
          isDuplicate = true;
          break;
        }
        if (t.description && item.id && String(t.description).includes(String(item.id))) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        const key = `t_${t._id}`;
        combinedMap.set(key, {
          id: String(t._id),
          type: t.type,
          title: t.type === 'service_earning' ? 'Service Earning' : 'Withdrawal Request',
          subtitle: t.description || 'Transaction record',
          amount: Math.abs(t.amount || 0),
          isCredit: (t.amount || 0) >= 0,
          status: t.status || 'completed',
          date: t.createdAt,
        });
      }
    });

    const transactions = Array.from(combinedMap.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return res.status(200).json({
      success: true,
      count: transactions.length,
      transactions,
    });
  } catch (error) {
    console.error('Error fetching provider transactions:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};



// Restaurant Partner Accepts Food Order -> Immediately transitions to PREPARING
// and STARTS NEAREST RIDER SEARCH IMMEDIATELY without waiting for food ready
exports.restaurantAcceptOrder = async (req, res) => {
  try {
    const { bookingId, restaurantId, preparationTime } = req.body;
    if (!bookingId) {
      return res.status(400).json({ success: false, error: 'bookingId is required' });
    }

    let booking = await Booking.findOne({ bookingId });
    if (!booking && mongoose.Types.ObjectId.isValid(bookingId)) {
      booking = await Booking.findById(bookingId);
    }
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const effectiveRestaurantId = restaurantId || booking.restaurantId || booking.providerId;

    const prepMinutes = Number(preparationTime) || Number(booking.preparationTime) || 15;
    const now = new Date();
    const prepEndsAt = new Date(now.getTime() + prepMinutes * 60 * 1000);

    booking.status = 'PREPARING';
    booking.acceptedAt = now;
    booking.prepStartedAt = now;
    booking.prepEndsAt = prepEndsAt;
    booking.preparationTime = prepMinutes;
    booking.deliveryStatus = 'SEARCHING_FOR_RIDER';

    if (effectiveRestaurantId) {
      const canonicalSuppId = resolveSupplierIdentity(effectiveRestaurantId);
      // Clear any previous rider assignment / rejections for a fresh search
      booking.rejectedRiders = [];
      booking.riderId = null;
      booking.pendingRiderId = null;

      booking.supplierId = canonicalSuppId;
      booking.partnerId = canonicalSuppId;
      booking.providerId = canonicalSuppId;
      booking.restaurantId = canonicalSuppId;
    }

    if (!booking.scheduledDate) booking.scheduledDate = now.toISOString().split('T')[0];
    if (!booking.scheduledTime) booking.scheduledTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    await booking.save();
    console.log(`🍳 [PREPARING] bookingId: ${booking.bookingId}, prepTime: ${prepMinutes}m, endsAt: ${prepEndsAt.toISOString()}`);

    const bookingObj = await resolveBookingNames(booking.toObject());

    if (_io) {
      const payload = {
        bookingId: booking.bookingId,
        rideId: booking.bookingId,
        status: 'PREPARING',
        acceptedAt: booking.acceptedAt,
        prepStartedAt: booking.prepStartedAt,
        prepEndsAt: booking.prepEndsAt,
        preparationTime: prepMinutes,
        restaurantName: booking.restaurantName,
        booking: bookingObj,
      };

      const acceptedEventPayload = {
        ...payload,
        status: 'ACCEPTED',
        message: 'Restaurant Accepted Your Order',
      };

      if (booking.customerId) {
        console.log(`📢 Emitting RESTAURANT_ACCEPTED & FOOD_PREPARING to user_${booking.customerId}`);
        _io.to(`user_${booking.customerId}`).emit('RESTAURANT_ACCEPTED', acceptedEventPayload);
        _io.to(`user_${booking.customerId}`).emit('FOOD_PREPARING', payload);
        _io.to(`user_${booking.customerId}`).emit('order_status_updated', payload);
        _io.to(`user_${booking.customerId}`).emit('booking_status_updated', payload);
      }

      const suppTarget = booking.supplierId || booking.restaurantId;
      if (suppTarget) {
        const suppRooms = getSupplierSocketRooms(suppTarget);
        for (const rm of suppRooms) {
          _io.to(rm).emit('FOOD_PREPARING', payload);
          _io.to(rm).emit('RESTAURANT_ACCEPTED', payload);
          _io.to(rm).emit('order_status_updated', payload);
          _io.to(rm).emit('booking_status_updated', payload);
        }
      }

      _io.emit('order_status_updated', payload);
      _io.emit('booking_status_updated', payload);
    }

    // 🚀 30 SECONDS DELAY: Dispatch rider search after 30 seconds of restaurant acceptance
    riderSearchService.scheduleDelayedRiderSearch(booking.bookingId, 30000);

    return res.status(200).json({
      success: true,
      message: 'Order accepted by restaurant. Preparation timer started and 30-second delayed rider dispatch scheduled.',
      booking: bookingObj,
    });
  } catch (error) {
    console.error('Error accepting food order:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Restaurant Partner Marks Food Ready for Pickup
exports.restaurantFoodReady = async (req, res) => {
  try {
    const { bookingId, restaurantId } = req.body;
    if (!bookingId) {
      return res.status(400).json({ success: false, error: 'bookingId is required' });
    }

    let booking = await Booking.findOne({ bookingId });
    if (!booking && mongoose.Types.ObjectId.isValid(bookingId)) {
      booking = await Booking.findById(bookingId);
    }
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    booking.status = 'FOOD_READY';
    booking.foodReadyAt = new Date();
    if (!booking.scheduledDate) booking.scheduledDate = new Date().toISOString().split('T')[0];
    if (!booking.scheduledTime) booking.scheduledTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    await booking.save();

    console.log(`ORDER #${booking.bookingId} | ACTOR: RESTAURANT | EVENT: MARK_READY | ORDER_STATUS: FOOD_READY`);
    console.log(`🍲 [FOOD_READY] bookingId: ${booking.bookingId}, restaurant: ${booking.restaurantName}`);

    const bookingObj = await resolveBookingNames(booking.toObject());

    if (_io) {
      const payload = {
        bookingId: booking.bookingId,
        rideId: booking.bookingId,
        status: 'FOOD_READY',
        riderStatus: booking.riderStatus,
        deliveryStatus: booking.deliveryStatus,
        foodReadyAt: booking.foodReadyAt,
        restaurantName: booking.restaurantName,
        booking: bookingObj,
      };

      if (booking.customerId) {
        console.log(`📢 Emitting FOOD_READY to user_${booking.customerId}`);
        _io.to(`user_${booking.customerId}`).emit('FOOD_READY', payload);
        _io.to(`user_${booking.customerId}`).emit('order_status_updated', payload);
      }
      const suppTarget = booking.supplierId || booking.restaurantId;
      if (suppTarget) {
        const suppRooms = getSupplierSocketRooms(suppTarget);
        for (const rm of suppRooms) {
          _io.to(rm).emit('FOOD_READY', payload);
          _io.to(rm).emit('order_status_updated', payload);
        }
      }
      if (booking.providerId) {
        console.log(`📢 Emitting FOOD_READY to rider user_${booking.providerId}`);
        _io.to(`user_${booking.providerId}`).emit('FOOD_READY', payload);
        _io.to(`user_${booking.providerId}`).emit('order_status_updated', payload);
      }
      _io.to(`booking_${booking.bookingId}`).emit('FOOD_READY', payload);
      _io.to(`booking_${booking.bookingId}`).emit('order_status_updated', payload);
      
      _io.emit('order_status_updated', payload);
      _io.emit('booking_status_updated', payload);
      _io.emit('FOOD_READY', payload);
    }

    // 🛵 Notify assigned rider or trigger search if not yet assigned
    setImmediate(() => {
      riderSearchService.notifyRiderFoodReady(booking);
    });

    return res.status(200).json({
      success: true,
      message: 'Food marked ready',
      booking: bookingObj,
    });
  } catch (error) {
    console.error('Error marking food ready:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Rider Accepts Delivery Assignment via API
exports.riderAcceptDelivery = async (req, res) => {
  try {
    const bookingId = req.params.bookingId || req.body.bookingId;
    const riderId = req.body.riderId || req.user?._id || req.user?.id;
    if (!bookingId || !riderId) {
      return res.status(400).json({ success: false, error: 'bookingId and riderId are required' });
    }

    const lat = Number(req.body.latitude || (req.body.location && req.body.location.latitude) || 0);
    const lon = Number(req.body.longitude || (req.body.location && req.body.location.longitude) || 0);

    const result = await riderSearchService.riderAcceptDelivery(bookingId, riderId.toString(), lat || undefined, lon || undefined);
    if (result.success) {
      if (result.booking) {
        result.booking = redactDropLocationForRider(result.booking, true);
      }
      return res.status(200).json(result);
    } else {
      return res.status(409).json(result);
    }
  } catch (err) {
    console.error('Error in riderAcceptDelivery:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Rider Rejects Delivery Assignment via API
exports.riderRejectDelivery = async (req, res) => {
  try {
    const bookingId = req.params.bookingId || req.body.bookingId;
    const riderId = req.body.riderId || req.user?._id || req.user?.id;
    if (!bookingId || !riderId) {
      return res.status(400).json({ success: false, error: 'bookingId and riderId are required' });
    }

    const result = await riderSearchService.riderRejectDelivery(bookingId, riderId.toString());
    return res.status(200).json(result);
  } catch (err) {
    console.error('Error in riderRejectDelivery:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Rider Transfers Delivery Assignment (Restaurant Delay or Emergency Handover)
exports.riderTransferOrder = async (req, res) => {
  try {
    const bookingId = req.params.bookingId || req.body.bookingId;
    const riderId = req.body.riderId || req.user?._id || req.user?.id;
    const reason = req.body.reason || 'Restaurant Is Late';
    const transferLocation = req.body.transferLocation || null;
    const details = req.body.details || '';
    if (!bookingId || !riderId) {
      return res.status(400).json({ success: false, error: 'bookingId and riderId are required' });
    }

    const result = await riderSearchService.riderTransferOrder(bookingId, riderId.toString(), reason, transferLocation, details);
    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (err) {
    console.error('Error in riderTransferOrder:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Request Emergency Order Transfer (Rider A)
exports.requestOrderTransfer = async (req, res) => {
  try {
    const bookingId = req.params.bookingId || req.body.bookingId;
    const riderId = req.body.riderId || req.user?._id || req.user?.id;
    const { reason, transferLocation, details } = req.body;

    if (!bookingId || !riderId) {
      return res.status(400).json({ success: false, error: 'bookingId and riderId are required' });
    }

    const result = await riderSearchService.requestOrderTransfer({
      bookingId,
      riderId: riderId.toString(),
      reason: reason || 'Vehicle Breakdown',
      transferLocation,
      details,
    });

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (err) {
    console.error('Error in requestOrderTransfer:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Rider B Accepts Order Transfer Request
exports.acceptOrderTransfer = async (req, res) => {
  try {
    const bookingId = req.params.bookingId || req.body.bookingId;
    const riderId = req.body.riderId || req.user?._id || req.user?.id;
    const { latitude, longitude } = req.body;

    if (!bookingId || !riderId) {
      return res.status(400).json({ success: false, error: 'bookingId and riderId are required' });
    }

    const result = await riderSearchService.acceptOrderTransfer({
      bookingId,
      riderId: riderId.toString(),
      latitude,
      longitude,
    });

    if (result.success) {
      return res.status(200).json(result);
    } else {
      const statusCode = result.alreadyTaken ? 409 : 400;
      return res.status(statusCode).json(result);
    }
  } catch (err) {
    console.error('Error in acceptOrderTransfer:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Get Transfer OTP (Rider A)
exports.getTransferOtp = async (req, res) => {
  try {
    const bookingId = req.params.bookingId || req.body.bookingId || req.query.bookingId;
    const riderId = req.body.riderId || req.query.riderId || req.user?._id || req.user?.id;

    if (!bookingId) {
      return res.status(400).json({ success: false, error: 'bookingId is required' });
    }

    const result = await riderSearchService.getTransferOtp({
      bookingId,
      riderId: riderId ? riderId.toString() : null,
    });

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (err) {
    console.error('Error in getTransferOtp:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Verify Transfer Handover via OTP (Rider B)
exports.verifyTransferHandover = async (req, res) => {
  try {
    const bookingId = req.params.bookingId || req.body.bookingId;
    const riderId = req.body.riderId || req.user?._id || req.user?.id;
    const { otp } = req.body;

    if (!bookingId || !riderId || !otp) {
      return res.status(400).json({ success: false, error: 'bookingId, riderId and otp are required' });
    }

    const result = await riderSearchService.verifyTransferHandover({
      bookingId,
      riderId: riderId.toString(),
      otp,
    });

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (err) {
    console.error('Error in verifyTransferHandover:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Cancel Order Transfer (Rider A)
exports.cancelOrderTransfer = async (req, res) => {
  try {
    const bookingId = req.params.bookingId || req.body.bookingId;
    const riderId = req.body.riderId || req.user?._id || req.user?.id;

    if (!bookingId || !riderId) {
      return res.status(400).json({ success: false, error: 'bookingId and riderId are required' });
    }

    const result = await riderSearchService.cancelOrderTransfer({
      bookingId,
      riderId: riderId.toString(),
    });

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (err) {
    console.error('Error in cancelOrderTransfer:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};



// Restaurant Partner Declines Food Order
exports.restaurantDeclineOrder = async (req, res) => {
  try {
    const { bookingId, restaurantId, reason } = req.body;
    if (!bookingId) {
      return res.status(400).json({ success: false, error: 'bookingId is required' });
    }

    let booking = await Booking.findOne({ bookingId });
    if (!booking && mongoose.Types.ObjectId.isValid(bookingId)) {
      booking = await Booking.findById(bookingId);
    }
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const declineStatus = reason?.toLowerCase()?.includes('timeout') || reason?.toLowerCase()?.includes('no response')
      ? 'NO_RESPONSE'
      : 'RESTAURANT_DECLINED';

    booking.status = declineStatus;
    booking.deliveryStatus = 'CANCELLED';
    booking.riderStatus = 'CANCELLED';
    booking.cancellationReason = reason || 'Declined by restaurant';
    booking.cancelledBy = 'RESTAURANT';
    booking.cancelledAt = new Date();
    if (!booking.scheduledDate) booking.scheduledDate = new Date().toISOString().split('T')[0];
    if (!booking.scheduledTime) booking.scheduledTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    await booking.save();

    riderSearchService.clearDelayedRiderSearch(booking.bookingId);
    riderSearchService.clearBookingTimeout(booking.bookingId);

    if (booking.riderId && mongoose.Types.ObjectId.isValid(booking.riderId)) {
      User.findByIdAndUpdate(booking.riderId, { isAvailable: true }).catch(() => {});
      const socketHandlerObj = require('../sockets/socketHandler');
      if (socketHandlerObj.onlineRiders && socketHandlerObj.onlineRiders.has(booking.riderId.toString())) {
        const mem = socketHandlerObj.onlineRiders.get(booking.riderId.toString());
        if (mem) { mem.isAvailable = true; socketHandlerObj.onlineRiders.set(booking.riderId.toString(), mem); }
      }
    }

    console.log(`❌ [RESTAURANT_DECLINED] bookingId: ${booking.bookingId}, status: ${declineStatus}, reason: ${booking.cancellationReason}`);

    const bookingObj = await resolveBookingNames(booking.toObject());

    if (_io) {
      const payload = {
        bookingId: booking.bookingId,
        rideId: booking.bookingId,
        status: declineStatus,
        riderStatus: 'CANCELLED',
        deliveryStatus: 'CANCELLED',
        reason: booking.cancellationReason,
        cancellationReason: booking.cancellationReason,
        cancelledBy: 'RESTAURANT',
        booking: bookingObj,
      };

      _io.emit('order_cancelled', payload);
      _io.emit('order_status_updated', payload);
      _io.emit('booking_status_updated', payload);
      _io.emit('RESTAURANT_DECLINED', payload);
      _io.emit('rider_arrived_removed', { bookingId: booking.bookingId });

      if (booking.customerId) {
        _io.to(`user_${booking.customerId}`).emit('RESTAURANT_DECLINED', payload);
        _io.to(`user_${booking.customerId}`).emit('order_cancelled', payload);
        _io.to(`user_${booking.customerId}`).emit('order_status_updated', payload);
        _io.to(`user_${booking.customerId}`).emit('booking_status_updated', payload);
      }
      if (booking.restaurantId) {
        _io.to(`user_${booking.restaurantId}`).emit('order_cancelled', payload);
        _io.to(`user_${booking.restaurantId}`).emit('rider_arrived_removed', { bookingId: booking.bookingId });
        _io.to(`user_${booking.restaurantId}`).emit('order_status_updated', payload);
        _io.to(`user_${booking.restaurantId}`).emit('booking_status_updated', payload);
      }
      if (booking.riderId) {
        _io.to(`user_${booking.riderId}`).emit('order_cancelled', payload);
        _io.to(`rider_${booking.riderId}`).emit('order_cancelled', payload);
        _io.to(`user_${booking.riderId}`).emit('DELIVERY_REQUEST_CANCELLED', { bookingId: booking.bookingId, reason: booking.cancellationReason });
        _io.to(`user_${booking.riderId}`).emit('order_status_updated', payload);
      }
      _io.to('riders_room').emit('DELIVERY_REQUEST_CANCELLED', { bookingId: booking.bookingId, reason: booking.cancellationReason });
      _io.to('riders_room').emit('order_cancelled', payload);
      _io.to(`booking_${booking.bookingId}`).emit('order_cancelled', payload);
      _io.to(`booking_${booking.bookingId}`).emit('order_status_updated', payload);
    }

    return res.status(200).json({
      success: true,
      message: 'Order declined',
      booking: bookingObj,
    });
  } catch (error) {
    console.error('Error declining food order:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Authoritative Booking Details Fetch from DB
exports.getBookingById = async (req, res) => {
  try {
    const { bookingId } = req.params;
    if (!bookingId) {
      return res.status(200).json({ success: true, booking: null, message: 'bookingId is required' });
    }

    let booking = await Booking.findOne({
      $or: [
        { bookingId: String(bookingId) },
        { rideId: String(bookingId) },
        ...(mongoose.Types.ObjectId.isValid(bookingId) ? [{ _id: new mongoose.Types.ObjectId(bookingId) }] : [])
      ]
    }).lean();

    if (!booking) {
      return res.status(200).json({ success: true, booking: null, message: 'Booking not found or expired' });
    }

    const isCallerRider = ['rider', 'delivery_partner', 'delivery', 'provider'].includes((req.query.role || req.headers['x-role'] || '').toLowerCase()) ||
      (Boolean(req.query.userId) && (String(req.query.userId) === String(booking.riderId || '') || String(req.query.userId) === String(booking.pendingRiderId || '')));
    const resolved = await resolveBookingNames(booking);
    const finalBooking = redactDropLocationForRider(resolved, isCallerRider);
    return res.status(200).json({ success: true, booking: finalBooking });
  } catch (error) {
    console.error('Error fetching booking by id:', error);
    return res.status(200).json({ success: true, booking: null, error: error.message });
  }
};

// ── TEST: Force Dispatch Rider Request (only for dev/testing) ─────────────────
exports.testDispatchToRider = async (req, res) => {
  try {
    // Find requested or latest booking that can be dispatched
    const requestedId = req.body?.bookingId || req.query?.bookingId;
    let booking = null;
    if (requestedId) {
      booking = await Booking.findOne({ bookingId: requestedId });
      if (!booking && mongoose.Types.ObjectId.isValid(requestedId)) {
        booking = await Booking.findById(requestedId);
      }
    }
    if (!booking) {
      booking = await Booking.findOne({ status: { $in: ['PREPARING', 'ACCEPTED', 'CONFIRMED'] } }).sort({ createdAt: -1 });
    }
    if (!booking) {
      booking = await Booking.findOne({}).sort({ createdAt: -1 });
    }
    if (!booking) {
      return res.status(404).json({ success: false, error: 'No booking found' });
    }

    // Reset for fresh dispatch
    booking.deliveryStatus = 'SEARCHING_FOR_RIDER';
    booking.rejectedRiders = [];
    booking.riderId        = null;
    booking.pendingRiderId = null;
    await booking.save();

    console.log('[TEST_DISPATCH] Reset booking ' + (booking.bookingId || booking._id) + ' for test dispatch');

    // Trigger rider search using the live riderSearchService
    const bId = booking.bookingId || booking._id.toString();
    riderSearchService.findAndDispatchNearestRider(bId);

    return res.status(200).json({
      success: true,
      message: 'Rider search triggered for booking ' + bId + '. Check Delivery Rider app for incoming request!',
      bookingId: bId,
      status: booking.status,
    });
  } catch (err) {
    console.error('[TEST_DISPATCH] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Fetch any active pending delivery request assigned or available to the rider
exports.getPendingRiderRequest = async (req, res) => {
  try {
    const riderId = (req.query.riderId || req.query.userId || '').toString();
    if (!riderId) {
      return res.status(200).json({ success: true, hasPending: false, request: null });
    }

    let booking = await Booking.findOne({
      status: { $in: ['PREPARING', 'FOOD_READY', 'ACCEPTED'] },
      riderId: { $in: [null, ''] },
      assignedRiderId: { $in: [null, ''] },
      $or: [
        { pendingRiderId: riderId, deliveryStatus: { $in: ['RIDER_REQUESTED', 'SEARCHING_FOR_RIDER'] } },
        { deliveryStatus: 'SEARCHING_FOR_RIDER', rejectedRiders: { $ne: riderId } },
      ],
    }).sort({ createdAt: -1 });

    if (!booking) {
      return res.status(200).json({ success: true, hasPending: false, request: null });
    }

    const dist = Number(booking.distanceKm) || 1.0;
    const fee = Number(booking.deliveryFee) || Math.round(25 + dist * 5);
    const resolved = await resolveBookingNames(booking.toObject());

    const itemsList = booking.items || booking.cartItems || [];

    let restoPhoto = booking.restaurantPhoto || (booking.restaurantPhotos && booking.restaurantPhotos[0]) || '';
    let restoPhotos = booking.restaurantPhotos && booking.restaurantPhotos.length ? booking.restaurantPhotos : (restoPhoto ? [restoPhoto] : []);
    if (!restoPhoto && booking.restaurantId) {
      try {
        const restoUser = await User.findById(booking.restaurantId).select('profilePicture avatar image photos').lean();
        if (restoUser) {
          restoPhoto = restoUser.profilePicture || restoUser.avatar || restoUser.image || (restoUser.photos && restoUser.photos[0]) || '';
          if (restoUser.photos && restoUser.photos.length) restoPhotos = restoUser.photos;
        }
      } catch (_) {}
    }

    let restoName = booking.restaurantName;
    let restoPhone = booking.restaurantPhone || '';
    let restoAddress = booking.pickupAddress || '';
    let pLat = Number(booking.pickupLatitude || booking.restaurantLatitude || 0);
    let pLon = Number(booking.pickupLongitude || booking.restaurantLongitude || 0);

    const targetRestoId = booking.restaurantId || booking.partnerId || booking.providerId;
    if (targetRestoId && mongoose.Types.ObjectId.isValid(targetRestoId)) {
      try {
        const restoUser = await User.findById(targetRestoId).select('name username restaurantName phoneNumber phone address location latitude longitude locationCoords profilePicture avatar image photos').lean();
        if (restoUser) {
          if (!restoName || restoName === 'Restaurant') {
            restoName = restoUser.restaurantName || restoUser.name || restoUser.username || 'Restaurant';
          }
          if (!restoPhone) restoPhone = restoUser.phoneNumber || restoUser.phone || '';
          if (!restoAddress) restoAddress = restoUser.address || restoUser.location || '';
          const rLat = Number(restoUser.latitude || restoUser.locationCoords?.latitude || 0);
          const rLon = Number(restoUser.longitude || restoUser.locationCoords?.longitude || 0);
          if (pLat === 0 && rLat !== 0) pLat = rLat;
          if (pLon === 0 && rLon !== 0) pLon = rLon;
          if (!restoPhoto) restoPhoto = restoUser.profilePicture || restoUser.avatar || restoUser.image || (restoUser.photos && restoUser.photos[0]) || '';
          if (restoUser.photos && restoUser.photos.length && (!restoPhotos || !restoPhotos.length)) {
            restoPhotos = restoUser.photos;
          }
        }
      } catch (_) {}
    }

    let custName = booking.customerName || 'Customer';
    let custPhone = booking.customerPhone || '';
    let destAddress = booking.destinationAddress || booking.serviceAddress || 'Customer Location';
    let dLat = Number(booking.destinationLatitude || booking.latitude || 0);
    let dLon = Number(booking.destinationLongitude || booking.longitude || 0);

    if (booking.customerId && mongoose.Types.ObjectId.isValid(booking.customerId)) {
      try {
        const custUser = await User.findById(booking.customerId).select('name username phoneNumber phone address location latitude longitude locationCoords').lean();
        if (custUser) {
          if (!custName || custName === 'Customer') custName = custUser.name || custUser.username || 'Customer';
          if (!custPhone) custPhone = custUser.phoneNumber || custUser.phone || '';
          if (!destAddress || destAddress === 'Customer Location') destAddress = custUser.address || custUser.location || '';
          const cLat = Number(custUser.latitude || custUser.locationCoords?.latitude || 0);
          const cLon = Number(custUser.longitude || custUser.locationCoords?.longitude || 0);
          if (dLat === 0 && cLat !== 0) dLat = cLat;
          if (dLon === 0 && cLon !== 0) dLon = cLon;
        }
      } catch (_) {}
    }

    let realDropDist = booking.dropDistanceKm;
    if ((!realDropDist || realDropDist === 3.5) && pLat && pLon && dLat && dLon) {
      const R = 6371;
      const dLatRad = ((dLat - pLat) * Math.PI) / 180;
      const dLonRad = ((dLon - pLon) * Math.PI) / 180;
      const a = Math.sin(dLatRad / 2) * Math.sin(dLatRad / 2) + Math.cos((pLat * Math.PI) / 180) * Math.cos((dLat * Math.PI) / 180) * Math.sin(dLonRad / 2) * Math.sin(dLonRad / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      realDropDist = parseFloat((R * c).toFixed(1));
    } else if (!realDropDist) {
      realDropDist = dist;
    }

    const requestPayload = {
      bookingId: booking.bookingId,
      orderId: booking.bookingId,
      _id: booking._id,
      categoryName: booking.categoryName || booking.businessCategoryName || booking.supplierCategory || 'Store',
      businessCategoryName: booking.businessCategoryName || booking.categoryName || booking.supplierCategory || 'Store',
      supplierCategory: booking.supplierCategory || booking.categoryName || 'Store',
      categoryId: booking.categoryId || null,
      supplierId: targetRestoId || booking.supplierId || '',
      restaurantId: targetRestoId || '',
      restaurantName: restoName || 'Restaurant',
      restaurantPhone: restoPhone,
      pickupAddress: restoAddress || 'Store Location',
      pickupLatitude: pLat || null,
      pickupLongitude: pLon || null,
      supplierBusinessAddress: booking.supplierBusinessAddress || restoAddress || 'Store Location',
      supplierBusinessLatitude: booking.supplierBusinessLatitude || pLat || null,
      supplierBusinessLongitude: booking.supplierBusinessLongitude || pLon || null,
      pickupLocation: booking.pickupLocation || {
        latitude: booking.supplierBusinessLatitude || pLat || null,
        longitude: booking.supplierBusinessLongitude || pLon || null,
        address: booking.supplierBusinessAddress || restoAddress || 'Store Location',
      },
      destinationAddress: destAddress || 'Customer Location',
      destinationLatitude: dLat || null,
      destinationLongitude: dLon || null,
      customerAddress: booking.customerAddress || destAddress || 'Customer Location',
      customerLatitude: booking.customerLatitude || dLat || null,
      customerLongitude: booking.customerLongitude || dLon || null,
      dropLocation: booking.dropLocation || {
        latitude: booking.customerLatitude || dLat || null,
        longitude: booking.customerLongitude || dLon || null,
        address: booking.customerAddress || destAddress || 'Customer Location',
      },
      customerName: custName,
      customerPhone: custPhone,
      distanceKm: dist,
      pickupDistanceKm: booking.pickupDistanceKm || dist,
      dropDistanceKm: realDropDist,
      etaMinutes: Math.ceil((dist / 25) * 60),
      estimatedEarning: fee,
      totalAmount: booking.price || booking.subtotal || 0,
      paymentMethod: booking.paymentMethod || 'cash',
      paymentStatus: booking.paymentStatus || 'PENDING',
      restaurantPhoto: restoPhoto,
      restaurantPhotos: restoPhotos,
      prepStartedAt: booking.prepStartedAt || null,
      prepEndsAt: booking.prepEndsAt || null,
      preparationTime: booking.preparationTime || 15,
      status: booking.status || 'PREPARING',
      deliveryStatus: booking.deliveryStatus,
      items: itemsList,
      cartItems: itemsList,
    };

    return res.status(200).json({
      success: true,
      hasPending: true,
      request: requestPayload,
    });
  } catch (err) {
    console.error('Error in getPendingRiderRequest:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Automatically generate the next sequential test order (Requirement 15)
exports.testGenerateNextOrder = async (req, res) => {
  try {
    const existingTestBookings = await Booking.find({
      bookingId: { $regex: '^TEST-RH-' },
    }).select('bookingId').lean();

    let nextNum = 5083;
    existingTestBookings.forEach(b => {
      const match = b.bookingId.match(/^TEST-RH-(\d+)/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n >= nextNum) nextNum = n + 1;
      }
    });

    const newBookingId = `TEST-RH-${nextNum}`;

    const sampleItems = [
      { name: 'Special Gulab Jamun (4 pcs)', quantity: 2, price: 90 },
      { name: 'Paneer Butter Masala', quantity: 1, price: 180 },
      { name: 'Butter Naan', quantity: 3, price: 30 },
    ];

    const prepTime = 15;
    const now = new Date();
    const endsAt = new Date(now.getTime() + prepTime * 60000);

    const photos = ['/uploads/cat_food.jpg', '/uploads/cat_bakery.jpg', '/uploads/cat_beverages.jpg', '/uploads/bhopal_lake_hero.jpg'];

    let sampleSupplier = await User.findOne({ role: 'supplier', isOnline: true }).lean();
    if (!sampleSupplier) {
      sampleSupplier = await User.findOne({ role: 'supplier' }).lean();
    }

    const restoId = sampleSupplier?._id ? sampleSupplier._id.toString() : '6a9ce2f67a5c419e200b38cc';
    const restoName = sampleSupplier?.restaurantName || sampleSupplier?.name || 'Gupta Sweets & Fast Food';
    const restoPhone = sampleSupplier?.phoneNumber || sampleSupplier?.phone || '9876543211';
    const catName = sampleSupplier?.categoryName || sampleSupplier?.businessCategoryName || sampleSupplier?.partnerType || 'Food';
    const pLat = Number(sampleSupplier?.latitude || sampleSupplier?.locationCoords?.latitude || 23.2330);
    const pLon = Number(sampleSupplier?.longitude || sampleSupplier?.locationCoords?.longitude || 77.4350);
    const pAddr = sampleSupplier?.address || sampleSupplier?.location || 'Shop 12, Main Market, MP Nagar Zone 1, Bhopal';

    const dLat = parseFloat((pLat - 0.0180).toFixed(4));
    const dLon = parseFloat((pLon + 0.0070).toFixed(4));
    const dAddr = 'Flat 402, Green Valley Apts, Arera Colony, Bhopal';

    const newBooking = new Booking({
      bookingId: newBookingId,
      customerId: 'cust_test_auto_' + nextNum,
      customerName: 'Test Customer ' + nextNum,
      customerPhone: '9876500000',
      serviceId: 'delivery_test',
      serviceName: catName,
      categoryName: catName,
      businessCategoryName: catName,
      supplierCategory: catName,
      categoryId: sampleSupplier?.categoryId || null,
      supplierId: restoId,
      price: 360,
      subtotal: 300,
      deliveryFee: 60,
      distanceKm: 2.8,
      restaurantId: restoId,
      partnerId: restoId,
      providerId: restoId,
      restaurantName: restoName,
      restaurantPhone: restoPhone,
      restaurantPhoto: photos[0],
      restaurantPhotos: photos,
      pickupAddress: pAddr,
      pickupLatitude: pLat,
      pickupLongitude: pLon,
      supplierBusinessAddress: pAddr,
      supplierBusinessLatitude: pLat,
      supplierBusinessLongitude: pLon,
      destinationAddress: dAddr,
      destinationLatitude: dLat,
      destinationLongitude: dLon,
      customerAddress: dAddr,
      customerLatitude: dLat,
      customerLongitude: dLon,
      serviceAddress: dAddr,
      latitude: dLat,
      longitude: dLon,
      items: sampleItems,
      cartItems: sampleItems,
      deliveryOtp: String(Math.floor(10000 + Math.random() * 90000)),
      otp: String(Math.floor(10000 + Math.random() * 90000)),
      paymentMethod: nextNum % 2 === 0 ? 'online' : 'cash',
      paymentStatus: nextNum % 2 === 0 ? 'COMPLETED' : 'PENDING',
      status: 'PREPARING',
      deliveryStatus: 'SEARCHING_FOR_RIDER',
      preparationTime: prepTime,
      prepStartedAt: now,
      prepEndsAt: endsAt,
      rejectedRiders: [],
    });

    await newBooking.save();
    console.log(`🚀 [AUTO_NEXT_ORDER] Generated and saved ${newBookingId} to MongoDB!`);

    riderSearchService.findAndDispatchNearestRider(newBookingId);

    return res.status(201).json({
      success: true,
      message: `Next test order ${newBookingId} generated and dispatched!`,
      bookingId: newBookingId,
      booking: newBooking,
    });
  } catch (err) {
    console.error('Error generating next test order:', err);
  }
};

// Get count of riders who have reached the restaurant and are waiting for food
exports.getReachedRidersCount = async (req, res) => {
  try {
    const restaurantId = req.query.restaurantId || req.user?._id || req.user?.id;
    const query = {
      riderStatus: 'REACHED_RESTAURANT',
      status: { $in: ['ACCEPTED', 'PREPARING', 'FOOD_READY', 'FOOD_PREPARING', 'RESTAURANT_ACCEPTED'] }
    };
    if (restaurantId) {
      query.restaurantId = restaurantId.toString();
    }
    const count = await Booking.countDocuments(query);
    return res.status(200).json({ success: true, count });
  } catch (err) {
    console.error('Error in getReachedRidersCount:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Get list of all riders assigned to this restaurant's active/preparing orders with real-time status and live GPS
exports.getRestaurantRiders = async (req, res) => {
  try {
    const restaurantId = req.query.restaurantId || req.user?._id || req.user?.id;
    const socketHandlerObj = require('../sockets/socketHandler');
    const onlineRidersMap = socketHandlerObj.onlineRiders || new Map();

    const query = {
      $or: [
        { riderId: { $exists: true, $ne: null } },
        { providerId: { $exists: true, $ne: null } },
        { 'acceptedBy.riderId': { $exists: true, $ne: null } }
      ],
      status: { $in: ['PREPARING', 'FOOD_READY', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'RESTAURANT_ACCEPTED', 'STARTED'] }
    };

    if (restaurantId) {
      query.$and = [
        {
          $or: [
            { restaurantId: restaurantId.toString() },
            { supplierId: restaurantId.toString() },
            { partnerId: restaurantId.toString() }
          ]
        }
      ];
    }

    const bookings = await Booking.find(query).sort({ updatedAt: -1 }).limit(30).lean();

    const User = require('../models/User');
    const ridersList = [];
    const seenRiderBooking = new Set();

    for (const b of bookings) {
      const rId = b.riderId || b.providerId || b.acceptedBy?.riderId;
      if (!rId) continue;
      const key = `${rId}_${b.bookingId}`;
      if (seenRiderBooking.has(key)) continue;
      seenRiderBooking.add(key);

      let riderUser = null;
      if (mongoose.Types.ObjectId.isValid(rId)) {
        riderUser = await User.findById(rId).select('name phoneNumber profilePicture avatar photos latitude longitude').lean();
      }

      // Check real-time GPS location from socket map first
      const memRider = onlineRidersMap.get(rId.toString());
      let currentLat = memRider?.location?.latitude || b.driverLat || b.riderLatitude || riderUser?.latitude || null;
      let currentLon = memRider?.location?.longitude || b.driverLon || b.riderLongitude || riderUser?.longitude || null;

      const isArrived = (b.riderStatus === 'REACHED_RESTAURANT' || b.deliveryStatus === 'RIDER_AT_RESTAURANT');

      let storeLat = b.pickupLatitude || b.restaurantLatitude || null;
      let storeLon = b.pickupLongitude || b.restaurantLongitude || null;

      if ((!storeLat || !storeLon) && b.restaurantId && mongoose.Types.ObjectId.isValid(b.restaurantId)) {
        try {
          const restoUser = await User.findById(b.restaurantId).select('latitude longitude businessLatitude businessLongitude locationCoords').lean();
          if (restoUser) {
            storeLat = restoUser.businessLatitude || restoUser.latitude || restoUser.locationCoords?.latitude || null;
            storeLon = restoUser.businessLongitude || restoUser.longitude || restoUser.locationCoords?.longitude || null;
          }
        } catch (_) {}
      }

      ridersList.push({
        riderId: rId.toString(),
        bookingId: b.bookingId,
        orderId: b.bookingId,
        riderName: b.riderName || b.providerName || riderUser?.name || 'Delivery Partner',
        riderPhone: b.riderPhone || b.providerPhone || riderUser?.phoneNumber || '',
        riderPhoto: b.riderPhoto || b.providerPhoto || riderUser?.profilePicture || riderUser?.avatar || (riderUser?.photos && riderUser?.photos[0]) || null,
        riderStatus: b.riderStatus || (isArrived ? 'REACHED_RESTAURANT' : 'ASSIGNED'),
        deliveryStatus: b.deliveryStatus || 'ASSIGNED',
        orderStatus: b.status,
        isArrived: isArrived,
        statusText: isArrived ? 'Rider Arrived' : (b.deliveryStatus === 'OUT_FOR_DELIVERY' ? 'Out for Delivery' : 'On the way to store'),
        arrivedAt: b.riderReachedAt || null,
        latitude: currentLat ? Number(currentLat) : null,
        longitude: currentLon ? Number(currentLon) : null,
        storeLatitude: storeLat ? Number(storeLat) : null,
        storeLongitude: storeLon ? Number(storeLon) : null,
        storeName: b.restaurantName || 'Store',
        customerName: b.customerName || 'Customer',
        totalAmount: b.price || b.subtotal || 0,
      });
    }

    return res.status(200).json({
      success: true,
      count: ridersList.length,
      riders: ridersList,
    });
  } catch (err) {
    console.error('Error in getRestaurantRiders:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Explicit Customer Cancellation Endpoint with Zero Refund Rule Enforced
exports.cancelBooking = async (req, res) => {
  try {
    const rawBody = req.body || {};
    const bookingId = req.params.bookingId || rawBody.bookingId || rawBody.rideId || rawBody.id;
    const cancellationReason = rawBody.cancellationReason || rawBody.reason || 'Cancelled by customer';
    const rawCancelledBy = (rawBody.cancelledBy || 'CUSTOMER').toUpperCase();
    const normalizedCancelledBy = (rawCancelledBy === 'PROVIDER' || rawCancelledBy === 'SUPPLIER' || rawCancelledBy === 'RESTAURANT' || rawCancelledBy === 'PARTNER') ? 'RESTAURANT' : (rawCancelledBy === 'RIDER' ? 'RIDER' : 'CUSTOMER');

    if (!bookingId) {
      return res.status(400).json({ success: false, error: 'bookingId is required' });
    }

    let booking = null;
    if (mongoose.Types.ObjectId.isValid(bookingId)) {
      booking = await Booking.findById(bookingId);
    }
    if (!booking) {
      booking = await Booking.findOne({ bookingId: String(bookingId) });
    }
    if (!booking) {
      booking = await Booking.findOne({
        $or: [{ bookingId: String(bookingId) }, { rideId: String(bookingId) }],
      }).sort({ createdAt: -1 });
    }

    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found in database' });
    }

    // Clear any pending 20-second supplier dispatch timer for this booking
    if (global.activeSupplierDispatchTimers && global.activeSupplierDispatchTimers.has(booking.bookingId)) {
      clearTimeout(global.activeSupplierDispatchTimers.get(booking.bookingId));
      global.activeSupplierDispatchTimers.delete(booking.bookingId);
      console.log(`⏱️ [20S DELAY CANCELLED] Cleared pending supplier timer for order #${booking.bookingId}`);
    }

    // 1. Duplicate Cancellation Prevention - Idempotent 200 OK
    const cancelledStatuses = ['CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_PROVIDER', 'RESTAURANT_DECLINED', 'NO_RESPONSE', 'TIMEOUT'];
    if (cancelledStatuses.includes(booking.status)) {
      console.log(`⚠️ [IDEMPOTENT CANCELLATION] Order ${booking.bookingId} is already cancelled (${booking.status}). Returning consistent 200 OK.`);
      return res.status(200).json({
        success: true,
        alreadyCancelled: true,
        message: 'This order has already been cancelled.',
        booking,
        order: booking,
        status: 'CANCELLED',
        paidAmount: booking.paidAmount || 0,
        refundAmount: booking.refundAmount || 0,
        refundStatus: booking.refundStatus || 'NOT_APPLICABLE',
      });
    }

    // 2. Completed / Delivered Check
    if (['COMPLETED', 'DELIVERED', 'SERVICE_COMPLETED'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        error: 'CANNOT_CANCEL_DELIVERED',
        message: 'Delivered orders cannot be cancelled.',
      });
    }

    // 3. Out for delivery check (rider on the way with order)
    if (['OUT_FOR_DELIVERY', 'FOOD_PICKED_UP', 'STARTED', 'IN_TRANSIT'].includes(booking.status) || booking.riderStatus === 'OUT_FOR_DELIVERY' || booking.riderStatus === 'FOOD_PICKED_UP') {
      return res.status(400).json({
        success: false,
        error: 'OUT_FOR_DELIVERY',
        message: 'Your order has already been picked up by the delivery partner and is out for delivery. Cancellation is no longer possible.',
      });
    }

    const prevStatus = (booking.status || '').toUpperCase();
    const isFoodOrder = (
      booking.serviceName === 'Food Delivery' ||
      booking.categoryName === 'Food Delivery' ||
      Boolean(booking.restaurantId) ||
      (booking.cartItems && typeof booking.cartItems === 'object' && Object.keys(booking.cartItems).length > 0)
    );

    // 4. Zero Refund Rule after Food Ready
    const isReadyStage = ['FOOD_READY', 'READY', 'READY_FOR_PICKUP', 'PACKED', 'REACHED_RESTAURANT'].includes(prevStatus) || booking.riderStatus === 'REACHED_RESTAURANT';
    const orderTotal = Number(booking.price || booking.totalAmount || 0);
    const isPaid = (booking.paymentStatus === 'PAID' || booking.paymentStatus === 'COMPLETED' || booking.paymentMethod === 'online' || booking.paymentMethod === 'wallet');

    let refundAmount = 0;
    let isNonRefundable = false;
    let refundStatus = 'NOT_APPLICABLE';
    let paidAmount = isPaid ? orderTotal : 0;

    if (isReadyStage) {
      // ZERO REFUND RULE ENFORCED ON BACKEND
      refundAmount = 0;
      isNonRefundable = true;
      refundStatus = 'NO_REFUND';
      if (isPaid) {
        booking.paymentStatus = 'PAID';
        paidAmount = orderTotal;
      } else {
        booking.paymentStatus = 'CANCELLED';
        paidAmount = 0;
      }
      console.log(`🛡️ [ZERO REFUND ENFORCED] Order ${booking.bookingId} cancelled at stage ${prevStatus}. Paid: ₹${paidAmount}, Refund: ₹0 (Non-Refundable).`);
    } else {
      // Before Ready stage (Pending / Accepted / Preparing)
      if (isPaid) {
        refundAmount = orderTotal;
        isNonRefundable = false;
        refundStatus = 'REFUND_PROCESSED';
        booking.paymentStatus = 'REFUNDED';
        paidAmount = orderTotal;
      } else {
        refundAmount = 0;
        isNonRefundable = false;
        refundStatus = 'NOT_APPLICABLE';
        booking.paymentStatus = 'CANCELLED';
        paidAmount = 0;
      }
      console.log(`💳 [REFUND CALCULATED] Order ${booking.bookingId} cancelled at stage ${prevStatus}. Paid: ₹${paidAmount}, Refund: ₹${refundAmount}.`);
    }

    // 5. Update and Persist in MongoDB
    booking.status = 'CANCELLED';
    booking.deliveryStatus = 'CANCELLED';
    booking.riderStatus = 'CANCELLED';
    booking.cancellationReason = cancellationReason;
    booking.cancelledBy = normalizedCancelledBy;
    booking.cancelledAt = new Date();
    booking.paidAmount = paidAmount;
    booking.refundAmount = refundAmount;
    booking.refundStatus = refundStatus;
    booking.isNonRefundable = isNonRefundable;
    booking.cancellationFee = isNonRefundable ? orderTotal : 0;

    // 5. Rider Compensation Calculation (Requirement 18 & 20 & 22)
    const assignedRider = booking.riderId || (isFoodOrder ? null : booking.providerId);
    let riderCompensation = 0;
    if (assignedRider && normalizedCancelledBy !== 'RIDER') {
      riderCompensation = 20; // Configured compensation amount
      booking.riderCompensation = riderCompensation;
      booking.riderCompensationPaid = true;

      try {
        const Transaction = require('../models/Transaction');
        await Transaction.create({
          userId: assignedRider,
          type: 'service_earning',
          amount: riderCompensation,
          currency: 'INR',
          status: 'completed',
          description: `Rider cancellation compensation for Order #${booking.bookingId}`,
        });
        console.log(`💰 [RIDER COMPENSATION] Credited ₹${riderCompensation} to rider ${assignedRider} for cancelled order ${booking.bookingId}`);
      } catch (cErr) {
        console.error('Error logging rider compensation transaction:', cErr.message);
      }
    }

    // Update and Persist in MongoDB
    booking.status = 'CANCELLED';
    booking.deliveryStatus = 'CANCELLED';
    booking.riderStatus = 'CANCELLED';
    booking.cancellationReason = cancellationReason;
    booking.cancelledBy = normalizedCancelledBy;
    booking.cancelledAt = new Date();
    booking.paidAmount = paidAmount;
    booking.refundAmount = refundAmount;
    booking.refundStatus = refundStatus;
    booking.isNonRefundable = isNonRefundable;
    booking.cancellationFee = isNonRefundable ? orderTotal : 0;
    if (booking.latitude == null) booking.latitude = 0;
    if (booking.longitude == null) booking.longitude = 0;
    if (!booking.serviceAddress) booking.serviceAddress = 'Service Location';
    await booking.save({ validateModifiedOnly: true });

    // 6. Clear Delayed Rider Timers & Releases
    riderSearchService.clearDelayedRiderSearch(booking.bookingId);
    riderSearchService.clearBookingTimeout(booking.bookingId);

    if (assignedRider && mongoose.Types.ObjectId.isValid(assignedRider)) {
      User.findByIdAndUpdate(assignedRider, { isAvailable: true }).catch(() => {});
      const socketHandlerObj = require('../sockets/socketHandler');
      if (socketHandlerObj.onlineRiders && socketHandlerObj.onlineRiders.has(assignedRider.toString())) {
        const mem = socketHandlerObj.onlineRiders.get(assignedRider.toString());
        if (mem) { mem.isAvailable = true; socketHandlerObj.onlineRiders.set(assignedRider.toString(), mem); }
      }
    }

    // Dynamic Single Notification Update (Requirement 11)
    const notifService = require('../services/notificationService');
    const _io = req.app.get('io') || global.io;
    if (booking.customerId) {
      const bIdShort = String(booking.bookingId || booking._id || '').slice(-6);
      notifService.updateOrSendOrderNotification(
        booking.customerId,
        null,
        booking.bookingId,
        'CANCELLED',
        `Order #${bIdShort} has been cancelled (${booking.cancellationReason || 'Cancelled'}).`,
        'Order Cancelled',
        _io,
        { bookingId: booking.bookingId, status: 'CANCELLED' }
      ).catch(() => {});
    }

    // 7. Socket.IO Real-time Events
    const cancelPayload = {
      bookingId: booking.bookingId,
      rideId: booking.bookingId,
      orderId: booking.bookingId,
      status: 'CANCELLED',
      orderStatus: 'CANCELLED',
      deliveryStatus: 'CANCELLED',
      riderStatus: 'CANCELLED',
      cancelledBy: booking.cancelledBy,
      cancellationReason: booking.cancellationReason,
      reason: booking.cancellationReason,
      paidAmount: booking.paidAmount,
      refundAmount: booking.refundAmount,
      isNonRefundable: booking.isNonRefundable,
      refundStatus: booking.refundStatus,
      paymentStatus: booking.paymentStatus,
      riderCompensation: booking.riderCompensation || 0,
      customerId: booking.customerId,
      customerName: booking.customerName,
      restaurantId: booking.restaurantId,
      restaurantName: booking.restaurantName,
      riderId: booking.riderId,
      cancelledAt: booking.cancelledAt,
      price: booking.price,
      totalAmount: booking.price,
      updatedAt: booking.updatedAt,
    };

    if (_io) {
      _io.emit('order_cancelled', cancelPayload);
      _io.emit('order_status_updated', cancelPayload);
      _io.emit('booking_status_updated', cancelPayload);
      _io.emit('FOOD_ORDER_UPDATED', cancelPayload);
      _io.emit('rider_arrived_removed', { bookingId: booking.bookingId });

      if (booking.customerId) {
        _io.to(`user_${booking.customerId}`).emit('order_cancelled', cancelPayload);
        _io.to(`user_${booking.customerId}`).emit('order_status_updated', cancelPayload);
        _io.to(`user_${booking.customerId}`).emit('booking_status_updated', cancelPayload);
      }
      if (booking.restaurantId) {
        _io.to(`user_${booking.restaurantId}`).emit('order_cancelled', cancelPayload);
        _io.to(`user_${booking.restaurantId}`).emit('order_status_updated', cancelPayload);
        _io.to(`user_${booking.restaurantId}`).emit('booking_status_updated', cancelPayload);
        _io.to(`user_${booking.restaurantId}`).emit('rider_arrived_removed', { bookingId: booking.bookingId });
      }
      if (booking.riderId) {
        _io.to(`user_${booking.riderId}`).emit('order_cancelled', cancelPayload);
        _io.to(`rider_${booking.riderId}`).emit('order_cancelled', cancelPayload);
        _io.to(`user_${booking.riderId}`).emit('DELIVERY_REQUEST_CANCELLED', { bookingId: booking.bookingId, reason: booking.cancellationReason });
        _io.to(`user_${booking.riderId}`).emit('order_status_updated', cancelPayload);
        if (riderCompensation > 0) {
          _io.to(`user_${booking.riderId}`).emit('earnings_updated', { riderCompensation, pocketBalance: riderCompensation });
        }
      }
      _io.to('riders_room').emit('DELIVERY_REQUEST_CANCELLED', { bookingId: booking.bookingId, reason: booking.cancellationReason });
      _io.to('riders_room').emit('order_cancelled', cancelPayload);
      _io.to(`booking_${booking.bookingId}`).emit('order_cancelled', cancelPayload);
      _io.to(`booking_${booking.bookingId}`).emit('order_status_updated', cancelPayload);
      _io.to(`order_${booking.bookingId}`).emit('order_cancelled', cancelPayload);
    }

    return res.json({
      success: true,
      message: 'Order cancelled successfully',
      booking,
      order: booking,
      status: 'CANCELLED',
      paidAmount: booking.paidAmount,
      refundAmount: booking.refundAmount,
      isNonRefundable: booking.isNonRefundable,
      refundStatus: booking.refundStatus,
      paymentStatus: booking.paymentStatus,
      riderCompensation: booking.riderCompensation || 0,
    });
  } catch (error) {
    console.error('❌ [cancelBooking Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── GET RESTAURANT REVIEWS & RATING (Requirement 24, 25, 26) ──────────────────
exports.getRestaurantReviews = async (req, res) => {
  try {
    const restaurantId = req.params.restaurantId || req.query.restaurantId || req.query.supplierId;
    if (!restaurantId) {
      return res.status(400).json({ success: false, error: 'restaurantId is required' });
    }

    const idVariants = [restaurantId, String(restaurantId)];
    if (mongoose.Types.ObjectId.isValid(restaurantId)) {
      idVariants.push(new mongoose.Types.ObjectId(restaurantId));
    }

    const Review = require('../models/Review');
    const directReviews = await Review.find({
      restaurantId: { $in: [restaurantId, String(restaurantId)] },
    }).sort({ createdAt: -1 }).lean();

    const reviewedOrders = await Booking.find({
      $or: [
        { restaurantId: { $in: idVariants } },
        { providerId: { $in: idVariants } },
        { partnerId: { $in: idVariants } },
        { supplierId: { $in: idVariants } },
      ],
      restaurantRating: { $ne: null, $gt: 0 },
    }).sort({ restaurantRatedAt: -1, createdAt: -1 }).lean();

    const reviews = [];
    let totalStars = 0;

    for (const rev of directReviews) {
      const star = Number(rev.rating) || 5;
      totalStars += star;
      reviews.push({
        id: rev._id,
        _id: rev._id,
        rating: star,
        feedback: rev.comment || '',
        comment: rev.comment || '',
        customerName: rev.userName || 'Guest Reviewer',
        userName: rev.userName || 'Guest Reviewer',
        customerPhoto: rev.userPhoto || null,
        ratedAt: rev.createdAt,
        createdAt: rev.createdAt,
        source: rev.source || 'ROYAL_PANEL',
      });
    }

    for (const ord of reviewedOrders) {
      const star = Number(ord.restaurantRating) || 5;
      totalStars += star;
      reviews.push({
        id: ord.bookingId || ord._id,
        _id: ord._id,
        orderId: ord.bookingId || ord._id,
        rating: star,
        feedback: ord.restaurantFeedback || ord.reviewText || '',
        comment: ord.restaurantFeedback || ord.reviewText || '',
        customerName: ord.customerName || 'Verified Customer',
        userName: ord.customerName || 'Verified Customer',
        customerPhoto: ord.customerPhoto || null,
        ratedAt: ord.restaurantRatedAt || ord.updatedAt || ord.createdAt,
        createdAt: ord.restaurantRatedAt || ord.updatedAt || ord.createdAt,
        source: 'ORDER_DELIVERY',
      });
    }

    reviews.sort((a, b) => new Date(b.createdAt || b.ratedAt).getTime() - new Date(a.createdAt || a.ratedAt).getTime());

    const count = reviews.length;
    const averageRating = count > 0 ? parseFloat((totalStars / count).toFixed(1)) : 4.8;

    return res.status(200).json({
      success: true,
      restaurantId,
      averageRating,
      totalReviews: count,
      reviews,
    });
  } catch (error) {
    console.error('Error fetching restaurant reviews:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── GET SUPPLIER MY REVIEWS ──────────────────────────────────────────────────
exports.getSupplierMyReviews = async (req, res) => {
  try {
    const supplierId = req.query.supplierId || req.user?._id || req.user?.id;
    if (!supplierId) {
      return res.status(400).json({ success: false, error: 'supplierId is required' });
    }
    req.params.restaurantId = supplierId;
    return exports.getRestaurantReviews(req, res);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── GET RIDER NEARBY ONLINE RESTAURANTS & GUARANTEED ORDER HOTSPOTS (Req 15 & 16) ─
exports.getRiderNearbyHotspots = async (req, res) => {
  try {
    const lat = Number(req.query.latitude || req.query.lat || 0);
    const lon = Number(req.query.longitude || req.query.lon || 0);

    // Fetch ONLY Online Suppliers/Restaurants (Requirement 16)
    const onlineSuppliers = await User.find({
      $or: [
        { role: { $in: ['supplier', 'seller_partner', 'provider', 'restaurant', 'store', 'partner'] } },
        { partnerType: { $in: ['restaurant', 'store', 'food', 'supplier'] } },
        { restaurantName: { $exists: true, $ne: '' } },
      ],
      $and: [
        {
          $or: [
            { isOnline: true },
            { restaurant_status: 'online' },
            { isAvailable: true },
          ],
        },
        { restaurant_status: { $ne: 'offline' } },
        { isSuspended: { $ne: true } },
      ],
    }).select('_id name restaurantName businessName categoryName businessCategoryName partnerType businessType latitude longitude businessLatitude businessLongitude locationCoords address fullAddress location profilePicture avatar photos').lean();

    // Fetch all active orders waiting for a rider (Requirement 15)
    const pendingOrders = await Booking.find({
      status: { $in: ['PREPARING', 'FOOD_READY', 'READY', 'ACCEPTED', 'PENDING'] },
      deliveryStatus: { $in: ['SEARCHING_FOR_RIDER', 'RIDER_REQUESTED', 'PENDING'] },
      riderId: null,
    }).select('restaurantId partnerId providerId supplierId bookingId').lean();

    const hotStoreIds = new Set();
    pendingOrders.forEach(o => {
      if (o.restaurantId) hotStoreIds.add(o.restaurantId.toString());
      if (o.partnerId) hotStoreIds.add(o.partnerId.toString());
      if (o.providerId) hotStoreIds.add(o.providerId.toString());
      if (o.supplierId) hotStoreIds.add(o.supplierId.toString());
    });

    const hotspots = [];
    for (const store of onlineSuppliers) {
      const sLat = Number(store.businessLatitude || store.latitude || store.locationCoords?.latitude || 0);
      const sLon = Number(store.businessLongitude || store.longitude || store.locationCoords?.longitude || 0);
      if (sLat === 0 || sLon === 0) continue;

      let distKm = 0.5;
      if (lat > 0 && lon > 0) {
        distKm = parseFloat(_haversineDist(lat, lon, sLat, sLon).toFixed(2));
      }

      const storeIdStr = store._id.toString();
      const hasGuaranteedOrder = hotStoreIds.has(storeIdStr);
      const etaMins = Math.max(2, Math.round((distKm / 25) * 60));

      hotspots.push({
        id: storeIdStr,
        restaurantId: storeIdStr,
        name: store.restaurantName || store.businessName || store.name || 'Store Partner',
        categoryName: store.categoryName || store.businessCategoryName || store.partnerType || 'Food',
        address: store.fullAddress || store.address || store.location || 'Store Location',
        latitude: sLat,
        longitude: sLon,
        distanceKm: distKm,
        etaMinutes: etaMins,
        etaText: `${etaMins} mins`,
        hasGuaranteedOrder: hasGuaranteedOrder,
        hasPendingOrder: hasGuaranteedOrder,
        photo: store.profilePicture || store.avatar || (store.photos && store.photos[0]) || '',
      });
    }

    hotspots.sort((a, b) => a.distanceKm - b.distanceKm);

    return res.status(200).json({
      success: true,
      count: hotspots.length,
      hotspots,
    });
  } catch (error) {
    console.error('Error fetching rider nearby hotspots:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

