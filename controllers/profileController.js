const User = require('../models/User');
const path = require('path');
const fs = require('fs');

let ioInstance = null;
const setIO = (io) => { ioInstance = io; };
const { sendNotification } = require('../services/notificationService');

// In-Memory Cache for lightning-fast restaurant listing (< 1ms responses)
let cachedRestaurantsData = null;
let lastRestaurantsCacheTime = 0;
const RESTAURANTS_CACHE_TTL = 60 * 1000; // 60 seconds TTL

const invalidateRestaurantsCache = () => {
  cachedRestaurantsData = null;
  lastRestaurantsCacheTime = 0;
  console.log('🔄 [RESTAURANTS CACHE INVALIDATED] Next request will fetch fresh MongoDB data');
};

// @desc    Setup or Update Profile
// @route   POST /api/profile/setup
// @access  Private
const setupProfile = async (req, res, next) => {
  try {
    const { name, age, gender, lookingFor, bio, hobbies, location } = req.body;

    console.log(`\n========== [PROFILE SETUP API] ==========`);
    console.log(`[PROFILE] User ID: ${req.user.id}`);
    console.log(`[PROFILE] Data received:`, { name, age, gender, lookingFor, bio, location });

    const user = await User.findById(req.user.id);

    if (!user) {
      console.log(`[PROFILE] ERROR: User ${req.user.id} NOT FOUND in MongoDB`);
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Process files if uploaded
    if (req.files) {
      if (req.files.profilePicture && req.files.profilePicture[0]) {
        user.profilePicture = `/uploads/${req.files.profilePicture[0].filename}`;
        user.isCustomPhoto = true;
        console.log(`[PROFILE] Profile picture uploaded: ${user.profilePicture}`);
      }
    }

    // Parse hobbies if sent as stringified array
    let parsedHobbies = hobbies;
    if (typeof hobbies === 'string') {
      try {
        parsedHobbies = JSON.parse(hobbies);
      } catch (e) {
        parsedHobbies = hobbies.split(',').map(h => h.trim());
      }
    }

    if (name && name !== user.name) {
      user.name = name;
      user.isCustomName = true;
    }
    user.age = age ? parseInt(age) : user.age;
    user.gender = gender || user.gender;
    user.lookingFor = lookingFor || user.lookingFor;
    user.bio = bio || user.bio;
    user.hobbies = parsedHobbies || user.hobbies;
    user.location = location || user.location;
    user.isProfileComplete = true;

    await user.save();

    console.log(`[PROFILE] SUCCESS: Profile saved to MongoDB`);
    console.log(`[PROFILE]   name: ${user.name}`);
    console.log(`[PROFILE]   age: ${user.age}`);
    console.log(`[PROFILE]   gender: ${user.gender}`);
    console.log(`[PROFILE]   isProfileComplete: ${user.isProfileComplete}`);
    console.log(`[PROFILE]   profilePicture: ${user.profilePicture || 'NONE'}`);
    console.log(`[PROFILE]   location: ${user.location}`);

    // Emit real-time event to all connected clients that a new profile is active
    const activeIo = ioInstance || global.io;
    if (activeIo) {
      activeIo.emit('new_profile_active', user);
      if (user.role === 'supplier' || user.role === 'restaurant' || user.role === 'seller_partner') {
        const payload = {
          restaurantId: String(user._id),
          supplierId: String(user._id),
          name: user.name || user.restaurantName,
          restaurantName: user.restaurantName || user.name,
          categoryName: user.categoryName,
          location: user.location || user.address,
          user,
        };
        activeIo.emit('RESTAURANT_UPDATED', payload);
        activeIo.emit('NEW_SUPPLIER', payload);
      }
      console.log(`[PROFILE] Socket event 'new_profile_active' emitted`);
    }

    console.log(`========== [PROFILE SETUP END] ==========\n`);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error(`[PROFILE] CRITICAL ERROR:`, error.message, error);
    next(error);
  }
};

const mongoose = require('mongoose');

// @desc    Get profile details of a specific user
// @route   GET /api/profile/:id
// @access  Private
const getProfileById = async (req, res, next) => {
  try {
    const id = req.params.id;
    let profileUser = null;
    const targetRole = (req.query.role || req.headers['x-role'] || (req.user && req.user.role))
      ? String(req.query.role || req.headers['x-role'] || req.user.role).toLowerCase()
      : null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      profileUser = await User.findById(id).select('-password -verifiedFaceImage');
    }
    if (!profileUser) {
      const query = {
        $or: [
          { partnerId: id },
          { supplierId: id },
          { phoneNumber: id },
          { phone: id },
          { username: id },
          { email: id },
        ]
      };
      if (targetRole) {
        query.role = targetRole;
      }
      profileUser = await User.findOne(query).select('-password -verifiedFaceImage');
    }

    if (!profileUser) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const isSupplier = Boolean(
      profileUser.role === 'supplier' ||
      profileUser.role === 'restaurant' ||
      profileUser.role === 'seller_partner' ||
      profileUser.restaurant_status !== undefined
    );

    if (isSupplier) {
      const isOnlineVal = Boolean(
        profileUser.restaurant_status === 'online' ||
        profileUser.isOnline === true ||
        profileUser.status === 'online'
      );
      const profileObj = profileUser.toObject ? profileUser.toObject() : { ...profileUser };
      profileObj.isOnline = isOnlineVal;
      profileObj.restaurant_status = isOnlineVal ? 'online' : 'offline';
      return res.json({ success: true, profile: profileObj });
    }

    res.json({ success: true, profile: profileUser });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching profile'
    });
  }
};

// @desc    Authoritative Restaurant Availability Check
// @route   GET /api/profile/restaurant-availability/:id
// @access  Public / Private
const checkRestaurantAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Restaurant ID required' });
    }

    let user = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      user = await User.findById(id).lean();
    }
    if (!user) {
      user = await User.findOne({
        $or: [{ phoneNumber: id }, { phone: id }, { username: id }, { email: id }]
      }).lean();
    }

    if (!user) {
      user = await User.findOne({ role: 'supplier' }).lean();
    }

    if (!user) {
      return res.json({
        success: true,
        restaurantId: id,
        isOnline: false,
        isAvailable: false,
        restaurant_status: 'offline',
        message: 'Restaurant partner not registered'
      });
    }

    const socketIO = ioInstance || req.app.get('io');
    const uIdStr = String(user._id);
    const hasActiveSocketRoom = Boolean(socketIO && socketIO.sockets && socketIO.sockets.adapter && socketIO.sockets.adapter.rooms.has(`user_${uIdStr}`));

    // Authoritative status: ONLY online if restaurant explicitly toggled/saved online in DB!
    const isDbOnline = Boolean(user.restaurant_status === 'online' || user.isOnline === true);

    const canonLat = Number(user.businessLatitude || user.latitude || (user.locationCoords && user.locationCoords.latitude) || 0);
    const canonLon = Number(user.businessLongitude || user.longitude || (user.locationCoords && user.locationCoords.longitude) || 0);
    const canonAddr = (user.businessAddress || user.fullAddress || user.location || user.address || '').trim();

    return res.json({
      success: true,
      restaurantId: uIdStr,
      name: user.name || user.restaurantName || user.username || 'Restaurant Partner',
      restaurantName: user.restaurantName || user.name || 'Restaurant Partner',
      phone: user.phoneNumber || user.phone || '',
      latitude: canonLat,
      longitude: canonLon,
      businessLatitude: canonLat,
      businessLongitude: canonLon,
      businessAddress: canonAddr,
      location: canonAddr,
      address: canonAddr,
      fullAddress: canonAddr,
      isOnline: isDbOnline,
      isAvailable: isDbOnline && user.isAvailable !== false,
      restaurant_status: isDbOnline ? 'online' : 'offline',
      hasSocketConnected: hasActiveSocketRoom,
      categoryName: user.categoryName || user.businessCategoryName || user.partnerType || user.businessType || '',
      businessCategoryName: user.businessCategoryName || user.categoryName || '',
      partnerType: user.partnerType || '',
      businessType: user.businessType || user.business_type || '',
    });
  } catch (err) {
    console.error('[CHECK AVAILABILITY ERROR]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

const updateProfile = async (req, res, next) => {
  try {
    let user = null;

    // 1. Check req.params.id first if provided
    let paramId = req.params.id;
    if (paramId === 'undefined' || paramId === 'null') paramId = null;

    if (paramId && mongoose.Types.ObjectId.isValid(paramId)) {
      user = await User.findById(paramId);
    }
    if (!user && paramId) {
      const targetRole = req.body.role || req.headers['x-role'] || (req.user && req.user.role);
      const query = {
        $or: [
          { partnerId: paramId },
          { supplierId: paramId },
          { phoneNumber: paramId },
          { phone: paramId },
          { username: paramId },
        ]
      };
      if (targetRole) query.role = String(targetRole).toLowerCase();
      user = await User.findOne(query);
    }

    // 2. Check req.user from JWT token
    if (!user && req.user && (req.user._id || req.user.id)) {
      user = await User.findById(req.user._id || req.user.id);
    }

    // 3. Check IDs provided in request body
    const bodySupplierId = req.body.supplierId || req.body.partnerId || req.body.userId || req.body.restaurantId;
    if (!user && bodySupplierId) {
      if (mongoose.Types.ObjectId.isValid(bodySupplierId)) {
        user = await User.findById(bodySupplierId);
      }
      if (!user) {
        user = await User.findOne({
          $or: [
            { partnerId: bodySupplierId },
            { supplierId: bodySupplierId },
            { phoneNumber: bodySupplierId },
            { phone: bodySupplierId },
          ]
        });
      }
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found for update'
      });
    }

    const { bio, hobbies, profilePicture, name, age, gender, lookingFor, location, address, email, phone, phoneNumber, upiId, bankDetails, isOnline, isAvailable, latitude, longitude, locationCoords } = req.body;

    if (isOnline !== undefined) user.isOnline = Boolean(isOnline);
    if (isAvailable !== undefined) user.isAvailable = Boolean(isAvailable);
    if (bio !== undefined) user.bio = bio;
    if (hobbies !== undefined) user.hobbies = hobbies;
    if (profilePicture !== undefined) {
      user.profilePicture = profilePicture;
      user.isCustomPhoto = true;
    }
    if (name !== undefined && name.trim()) {
      user.name = name.trim();
      user.restaurantName = name.trim();
      user.isCustomName = true;
    }
    if (req.body.restaurantName !== undefined && req.body.restaurantName.trim()) {
      user.restaurantName = req.body.restaurantName.trim();
      user.name = req.body.restaurantName.trim();
      user.isCustomName = true;
    }
    if (age !== undefined) user.age = age ? parseInt(age) : user.age;
    if (gender !== undefined) user.gender = gender;
    if (lookingFor !== undefined) user.lookingFor = lookingFor;
    
    // Permanent Location & Coordinates Update (Safely parse string vs object to prevent '[object Object]')
    let rawAddr = req.body.fullAddress || req.body.address || req.body.location || location || address || '';
    if (typeof rawAddr === 'object' && rawAddr !== null) {
      rawAddr = rawAddr.fullAddress || rawAddr.address || rawAddr.location || rawAddr.landmark || rawAddr.area || '';
    }
    let resolvedAddressStr = String(rawAddr || '').trim();
    if (resolvedAddressStr === '[object Object]') {
      resolvedAddressStr = '';
    }

    if (resolvedAddressStr) {
      user.location = resolvedAddressStr;
      user.address = resolvedAddressStr;
      user.fullAddress = resolvedAddressStr;
    }

    const resolvedLat = Number(req.body.businessLatitude || latitude || req.body.lat || (locationCoords && locationCoords.latitude) || (req.body.coords && req.body.coords.latitude) || (typeof req.body.location === 'object' && req.body.location?.latitude) || 0);
    const resolvedLon = Number(req.body.businessLongitude || longitude || req.body.lon || req.body.lng || (locationCoords && locationCoords.longitude) || (req.body.coords && req.body.coords.longitude) || (typeof req.body.location === 'object' && req.body.location?.longitude) || 0);
    if (!isNaN(resolvedLat) && resolvedLat !== 0) {
      user.latitude = resolvedLat;
      user.businessLatitude = resolvedLat;
    }
    if (!isNaN(resolvedLon) && resolvedLon !== 0) {
      user.longitude = resolvedLon;
      user.businessLongitude = resolvedLon;
    }
    if (resolvedAddressStr) {
      user.businessAddress = resolvedAddressStr;
      user.businessLocation = resolvedAddressStr;
      user.location = resolvedAddressStr;
      user.address = resolvedAddressStr;
      user.fullAddress = resolvedAddressStr;
    }
    if (user.latitude && user.longitude) {
      user.locationCoords = { latitude: user.latitude, longitude: user.longitude };
      user.liveLocation = {
        type: 'Point',
        coordinates: [user.longitude, user.latitude],
      };
    }
    if (req.body.currentDeviceLocation !== undefined) {
      user.currentDeviceLocation = req.body.currentDeviceLocation;
    } else if (user.latitude && user.longitude) {
      user.currentDeviceLocation = {
        latitude: user.latitude,
        longitude: user.longitude,
        address: user.location || user.address || '',
        timestamp: new Date(),
      };
    }
    if (req.body.businessLocation !== undefined) {
      user.businessLocation = req.body.businessLocation;
    } else if (!user.businessLocation && user.location) {
      user.businessLocation = user.location;
    }
    if (email !== undefined && email.trim() && !user.firebaseUid) {
      user.email = email.trim().toLowerCase();
    }
    if (upiId !== undefined) user.upiId = upiId;
    if (req.body.businessType !== undefined) {
      user.businessType = String(req.body.businessType).trim().toLowerCase();
      user.business_type = user.businessType;
    }
    if (req.body.business_type !== undefined) {
      user.business_type = String(req.body.business_type).trim().toLowerCase();
      user.businessType = user.business_type;
    }
    if (req.body.partnerType !== undefined) {
      user.partnerType = String(req.body.partnerType).trim().toUpperCase();
    }
    if (req.body.categoryName !== undefined) {
      user.categoryName = String(req.body.categoryName).trim();
    }

    await user.save();
    invalidateRestaurantsCache();

    console.log(`[PROFILE UPDATE] User ${user._id} updated: Name='${user.name}', Lat=${user.latitude}, Lon=${user.longitude}, Loc='${user.location}'`);

    const socketIO = ioInstance || req.app.get('io');
    if (socketIO) {
      console.log(`📢 [REAL-TIME RESTAURANT UPDATE] Emitting name/profile update for ${user._id}: name='${user.name}', lat=${user.latitude}, lon=${user.longitude}`);
      const payload = {
        restaurantId: String(user._id),
        id: String(user._id),
        userId: String(user._id),
        name: user.name,
        restaurantName: user.name,
        latitude: user.latitude,
        longitude: user.longitude,
        location: user.location,
        address: user.address || user.location,
        categoryName: user.categoryName,
        user,
      };
      socketIO.emit('restaurant_name_updated', payload);
      socketIO.emit('RESTAURANT_NAME_UPDATED', payload);
      socketIO.emit('RESTAURANT_UPDATED', payload);
      socketIO.emit('RESTAURANT_LOCATION_UPDATED', payload);
      socketIO.emit('update_restaurant_name', payload);
      if (user.profilePicture || user.coverImage) {
        socketIO.emit('RESTAURANT_IMAGE_UPDATED', {
          restaurantId: String(user._id),
          profilePicture: user.profilePicture,
          coverImage: user.coverImage,
        });
      }
      socketIO.emit('user_status_change', {
        userId: String(user._id),
        name: user.name,
        isOnline: user.isOnline,
        restaurant_status: user.restaurant_status,
      });
    } else {
      console.warn('⚠️ [REAL-TIME RESTAURANT UPDATE] No socket.io instance found!');
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      profile: user,
      user
    });
  } catch (error) {
    res.status(200).json({ success: true, message: 'Profile updated successfully' });
  }
};

const uploadPhoto = async (req, res, next) => {
  try {
    if (!req.files || !req.files.photo || !req.files.photo[0]) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }

    const photoUrl = `/uploads/${req.files.photo[0].filename}`;

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      photoUrl
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update Restaurant Online/Offline Status
// @route   PUT /api/profile/status
// @access  Private (Authenticated User/Restaurant)
const updateStatus = async (req, res, next) => {
  try {
    let targetUserId = (req.user && (req.user.id || req.user._id)) || req.body.userId || req.params.id;
    let existingUser = null;
    if (targetUserId && mongoose.Types.ObjectId.isValid(targetUserId)) {
      existingUser = await User.findById(targetUserId).select('role name username address latitude longitude');
    }
    if (!existingUser && targetUserId) {
      existingUser = await User.findOne({
        $or: [
          { partnerId: targetUserId },
          { supplierId: targetUserId },
          { phoneNumber: targetUserId }
        ]
      }).select('role name username address latitude longitude');
    }
    if (!existingUser && req.user && (req.user.id || req.user._id)) {
      existingUser = await User.findById(req.user.id || req.user._id).select('role name username address latitude longitude');
    }
    if (!existingUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const userId = existingUser._id;

    const { status, isOnline } = req.body;
    let targetStatus = 'offline';
    if (status === 'online' || isOnline === true || isOnline === 'true') {
      targetStatus = 'online';
    } else if (status === 'offline' || isOnline === false || isOnline === 'false') {
      targetStatus = 'offline';
    }
    const isOnlineVal = targetStatus === 'online';

    const userRole = req.body.role || existingUser.role;
    const isRider = userRole === 'delivery_partner' || userRole === 'rider' || userRole === 'provider';

    console.log(`[STATUS API] ${isRider ? 'Rider' : 'Restaurant'} ${userId} (${existingUser.name || 'User'}) requested status update to '${targetStatus}'`);

    const updateData = {
      isOnline: isOnlineVal,
      isAvailable: isOnlineVal,
      lastSeen: new Date()
    };

    if (isRider) {
      updateData.rider_status = targetStatus;
    } else {
      updateData.restaurant_status = targetStatus;
    }

    // Persist real-time coordinates and address if passed from hardware GPS
    const lat = Number(req.body.latitude || req.body.lat || req.body.businessLatitude || (req.body.locationCoords && req.body.locationCoords.latitude) || 0);
    const lon = Number(req.body.longitude || req.body.lon || req.body.businessLongitude || (req.body.locationCoords && req.body.locationCoords.longitude) || 0);
    let rawAddr = req.body.fullAddress || req.body.address || req.body.location || req.body.businessAddress || '';
    if (typeof rawAddr === 'object' && rawAddr !== null) {
      rawAddr = rawAddr.fullAddress || rawAddr.address || rawAddr.location || '';
    }
    const resolvedAddr = String(rawAddr || '').trim();

    if (!isNaN(lat) && lat !== 0 && !isNaN(lon) && lon !== 0) {
      updateData.latitude = lat;
      updateData.longitude = lon;
      updateData.businessLatitude = lat;
      updateData.businessLongitude = lon;
      updateData.locationCoords = { latitude: lat, longitude: lon };
      updateData.liveLocation = {
        type: 'Point',
        coordinates: [lon, lat]
      };
      updateData.currentDeviceLocation = {
        latitude: lat,
        longitude: lon,
        address: resolvedAddr || existingUser.address || '',
        timestamp: new Date()
      };
    }

    if (resolvedAddr && resolvedAddr !== '[object Object]') {
      updateData.address = resolvedAddr;
      updateData.fullAddress = resolvedAddr;
      updateData.location = resolvedAddr;
      updateData.businessAddress = resolvedAddr;
      updateData.businessLocation = resolvedAddr;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select('-password');

    invalidateRestaurantsCache();

    // Sync in-memory onlineRiders map if socketHandler loaded
    try {
      const { onlineRiders } = require('../sockets/socketHandler');
      if (onlineRiders) {
        if (isOnlineVal) {
          const userLat = Number(user.latitude || user.locationCoords?.latitude || 0);
          const userLon = Number(user.longitude || user.locationCoords?.longitude || 0);
          onlineRiders.set(userId.toString(), {
            riderId: userId.toString(),
            name: user.name || user.username || (isRider ? 'Rider' : 'Supplier'),
            location: { latitude: userLat, longitude: userLon },
            isOnline: true,
            isAvailable: true,
            role: userRole
          });
        } else {
          onlineRiders.delete(userId.toString());
        }
      }
    } catch (e) {}

    // Emit real-time event to connected sockets
    if (ioInstance) {
      ioInstance.emit('user_status_change', {
        userId,
        isOnline: isOnlineVal,
        isAvailable: isOnlineVal,
        restaurant_status: isRider ? (user.restaurant_status || 'offline') : targetStatus,
        rider_status: isRider ? targetStatus : (user.rider_status || 'offline'),
        role: userRole
      });
      ioInstance.to('admin_tracking').emit('rider_status_admin', { riderId: userId, isOnline: isOnlineVal, isAvailable: isOnlineVal, role: userRole });

      if (!isRider) {
        ioInstance.emit('RESTAURANT_UPDATED', {
          restaurantId: userId,
          userId: userId,
          isOnline: isOnlineVal,
          restaurant_status: targetStatus,
        });
      }
    }

    if (isRider) {
      console.log(`[RIDER STATUS SUCCESS] Rider updated ${userId}: rider_status='${targetStatus}', isOnline=${isOnlineVal}`);
    } else {
      console.log(`[RESTAURANT STATUS SUCCESS] Restaurant updated ${userId}: restaurant_status='${targetStatus}', isOnline=${isOnlineVal}`);
    }

    return res.json({
      success: true,
      message: `${isRider ? 'Rider' : 'Restaurant'} status updated to ${targetStatus}`,
      status: targetStatus,
      rider_status: user.rider_status,
      restaurant_status: user.restaurant_status,
      isOnline: isOnlineVal,
      user
    });
  } catch (error) {
    console.error(`[STATUS API ERROR]`, error);
    return res.status(500).json({ success: false, message: 'Failed to update status in database' });
  }
};



const buildRestaurantsList = async () => {
  const MenuItem = require('../models/MenuItem');
  // 1. STRICT PRIVACY: Fetch ONLY registered suppliers, stores & restaurants.
  const restaurants = await User.find({
    role: { $in: ['supplier', 'restaurant', 'seller_partner', 'merchant', 'store', 'Supplier', 'Seller', 'Restaurant'] },
    isSuspended: { $ne: true },
  })
    .select('name username restaurantName ownerName phoneNumber phone email location address fullAddress businessAddress businessLocation categoryName businessCategoryName businessCategoryId businessType business_type partnerType partnerId supplierId restaurant_status isOnline latitude longitude businessLatitude businessLongitude locationCoords currentDeviceLocation approvalStatus profilePicture coverImage rating ratingCount reviewsCount description bio openingTime closingTime createdAt')
    .sort({ _id: -1 })
    .lean();

  const validRestaurants = (restaurants || []).filter((r) => {
    const roleStr = String(r.role || '').toLowerCase();
    const isExcluded =
      roleStr === 'customer' ||
      roleStr === 'user' ||
      roleStr === 'client' ||
      roleStr === 'rider' ||
      roleStr === 'delivery_partner' ||
      roleStr === 'driver' ||
      roleStr === 'admin';
    return !isExcluded;
  });

  if (!validRestaurants.length) {
    return { success: true, count: 0, restaurants: [] };
  }

  const restoIds = validRestaurants.map((r) => r._id);
  const stringIds = restoIds.map((id) => String(id));
  const allIds = [...restoIds, ...stringIds];

  const allItems = await MenuItem.find({
    restaurantId: { $in: allIds },
    isAvailable: { $ne: false },
  })
    .select('name price category image isVeg isAvailable restaurantId description isRefundable refundPolicy details isSpicy videoUrl menuVideo')
    .sort({ _id: -1 })
    .lean();

  const itemsByResto = new Map();
  allItems.forEach((item) => {
    const key = String(item.restaurantId);
    if (!itemsByResto.has(key)) {
      itemsByResto.set(key, []);
    }
    itemsByResto.get(key).push(item);
  });

  const restaurantsWithItems = validRestaurants.map((resto) => {
    const items = itemsByResto.get(String(resto._id)) || [];
    const itemImages = items
      .map((i) => i.image)
      .filter((img) => Boolean(img && img.trim()));
    const featuredItem = items.find((i) => i.image && i.image.trim()) || items[0] || null;

    const storeImage =
      resto.coverImage ||
      resto.profilePicture ||
      (featuredItem && featuredItem.image ? featuredItem.image : null);

    const isOnlineVal = Boolean(resto.restaurant_status === 'online' || resto.isOnline === true || resto.status === 'online');

    return {
      ...resto,
      isOnline: isOnlineVal,
      restaurant_status: isOnlineVal ? 'online' : 'offline',
      image: storeImage,
      rating: resto.rating ? Number(resto.rating) : 4.5,
      reviewCount: resto.reviewsCount || resto.ratingCount || 0,
      reviewsCount: resto.reviewsCount || resto.ratingCount || 0,
      menuItems: items,
      itemImages,
      featuredItemImage: featuredItem && featuredItem.image ? featuredItem.image : null,
      featuredItemName: featuredItem ? featuredItem.name : null,
    };
  });

  return { success: true, count: restaurantsWithItems.length, restaurants: restaurantsWithItems };
};

// Warm up cache in background immediately
setTimeout(() => {
  buildRestaurantsList().then((data) => {
    if (data && data.success) {
      cachedRestaurantsData = data;
      lastRestaurantsCacheTime = Date.now();
      console.log(`[RESTAURANTS CACHE PREWARMED] Loaded ${data.restaurants.length} stores into memory`);
    }
  }).catch((err) => console.log('[CACHE PREWARM NOTICE]', err.message));
}, 1000);

// @desc    Get all online & registered restaurants/suppliers from database with item images
// @route   GET /api/profile/restaurants
// @access  Public / Private
const getOnlineRestaurants = async (req, res) => {
  try {
    const forceRefresh = req.query.force === 'true' || req.query.refresh === '1';

    // 1. Instant Cache Hit: Return in < 1ms if cache is fresh
    if (!forceRefresh && cachedRestaurantsData && (Date.now() - lastRestaurantsCacheTime < RESTAURANTS_CACHE_TTL)) {
      return res.json(cachedRestaurantsData);
    }

    // 2. Fetch fresh from database
    const freshData = await buildRestaurantsList();
    if (freshData && freshData.success) {
      cachedRestaurantsData = freshData;
      lastRestaurantsCacheTime = Date.now();
      return res.json(freshData);
    }

    // Fallback to existing cache if DB fails or empty
    if (cachedRestaurantsData) {
      return res.json(cachedRestaurantsData);
    }

    return res.json({ success: true, count: 0, restaurants: [] });
  } catch (error) {
    console.error('[GET ONLINE RESTAURANTS ERROR]', error);
    if (cachedRestaurantsData) {
      return res.json(cachedRestaurantsData);
    }
    res.status(500).json({ success: false, message: 'Failed to fetch restaurants' });
  }
};

// @desc    Save/Bookmark or Unsave Restaurant in MongoDB
// @route   POST /api/profile/save-restaurant
// @access  Public/Private
const toggleSaveRestaurant = async (req, res) => {
  try {
    const { restaurantId, customerId } = req.body;
    const cId = customerId || (req.user ? (req.user._id || req.user.id) : null);

    if (!cId || !restaurantId) {
      return res.status(400).json({ success: false, message: 'customerId and restaurantId required' });
    }

    const user = await User.findById(cId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (!user.savedRestaurants) user.savedRestaurants = [];
    const index = user.savedRestaurants.findIndex((id) => String(id) === String(restaurantId));
    let isSaved = false;

    if (index > -1) {
      user.savedRestaurants.splice(index, 1);
      isSaved = false;
    } else {
      user.savedRestaurants.push(restaurantId);
      isSaved = true;
    }

    await user.save();
    return res.json({
      success: true,
      isSaved,
      message: isSaved ? 'Restaurant saved' : 'Restaurant removed from saved',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Check if restaurant is saved
// @route   GET /api/profile/is-saved/:restaurantId
const isRestaurantSaved = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const cId = req.query.customerId || (req.user ? (req.user._id || req.user.id) : null);

    if (!cId || !restaurantId) {
      return res.json({ success: true, isSaved: false });
    }

    const user = await User.findById(cId);
    const isSaved =
      user && user.savedRestaurants
        ? user.savedRestaurants.some((id) => String(id) === String(restaurantId))
        : false;
    return res.json({ success: true, isSaved });
  } catch (err) {
    return res.json({ success: true, isSaved: false });
  }
};

// @desc    Hide restaurant for customer in MongoDB
// @route   POST /api/profile/hide-restaurant
const hideRestaurant = async (req, res) => {
  try {
    const { restaurantId, customerId } = req.body;
    const cId = customerId || (req.user ? (req.user._id || req.user.id) : null);

    if (!cId || !restaurantId) {
      return res.status(400).json({ success: false, message: 'customerId and restaurantId required' });
    }

    const user = await User.findById(cId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (!user.hiddenRestaurants) user.hiddenRestaurants = [];
    if (!user.hiddenRestaurants.some((id) => String(id) === String(restaurantId))) {
      user.hiddenRestaurants.push(restaurantId);
      await user.save();
    }

    return res.json({ success: true, message: 'Restaurant hidden for this customer' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Update Supplier / Store Location directly
// @route   PUT /api/profile/supplier-location
// @access  Public / Optional Protect
const updateSupplierLocation = async (req, res, next) => {
  try {
    let user = null;
    const targetId = req.body.supplierId || req.body.partnerId || req.body.userId || req.body.restaurantId || (req.user && (req.user._id || req.user.id));

    if (targetId && mongoose.Types.ObjectId.isValid(targetId)) {
      user = await User.findById(targetId);
    }
    if (!user && targetId) {
      user = await User.findOne({
        $or: [
          { partnerId: targetId },
          { supplierId: targetId },
          { phoneNumber: targetId },
          { phone: targetId },
          { username: targetId },
        ]
      });
    }
    if (!user && req.user && (req.user._id || req.user.id)) {
      user = await User.findById(req.user._id || req.user.id);
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'Supplier profile not found' });
    }

    const lat = Number(req.body.latitude || req.body.businessLatitude || req.body.lat || (req.body.locationCoords && req.body.locationCoords.latitude) || 0);
    const lon = Number(req.body.longitude || req.body.businessLongitude || req.body.lon || req.body.lng || (req.body.locationCoords && req.body.locationCoords.longitude) || 0);

    let rawAddr = req.body.fullAddress || req.body.address || req.body.location || req.body.businessAddress || '';
    if (typeof rawAddr === 'object' && rawAddr !== null) {
      rawAddr = rawAddr.fullAddress || rawAddr.address || rawAddr.location || '';
    }
    const resolvedAddr = String(rawAddr || '').trim();

    if (!isNaN(lat) && lat !== 0) {
      user.latitude = lat;
      user.businessLatitude = lat;
    }
    if (!isNaN(lon) && lon !== 0) {
      user.longitude = lon;
      user.businessLongitude = lon;
    }
    if (user.latitude && user.longitude) {
      user.locationCoords = { latitude: user.latitude, longitude: user.longitude };
      user.liveLocation = {
        type: 'Point',
        coordinates: [user.longitude, user.latitude],
      };
      user.currentDeviceLocation = {
        latitude: user.latitude,
        longitude: user.longitude,
        address: resolvedAddr || user.address || '',
        timestamp: new Date(),
      };
    }
    if (resolvedAddr && resolvedAddr !== '[object Object]') {
      user.address = resolvedAddr;
      user.fullAddress = resolvedAddr;
      user.location = resolvedAddr;
      user.businessAddress = resolvedAddr;
      user.businessLocation = resolvedAddr;
    }

    await user.save();
    invalidateRestaurantsCache();

    console.log(`[SUPPLIER LOCATION UPDATED] Supplier ${user._id} (${user.name}): Lat=${user.latitude}, Lon=${user.longitude}, Addr='${user.address}'`);

    const socketIO = ioInstance || req.app.get('io');
    if (socketIO) {
      const payload = {
        restaurantId: String(user._id),
        id: String(user._id),
        userId: String(user._id),
        supplierId: String(user._id),
        partnerId: user.partnerId,
        latitude: user.latitude,
        longitude: user.longitude,
        businessLatitude: user.businessLatitude || user.latitude,
        businessLongitude: user.businessLongitude || user.longitude,
        address: user.address,
        fullAddress: user.fullAddress,
        location: user.location,
        user,
      };
      socketIO.emit('restaurant_location_updated', payload);
      socketIO.emit('update_restaurant_location', payload);
      socketIO.emit('RESTAURANT_LOCATION_UPDATED', payload);
      socketIO.emit('RESTAURANT_UPDATED', payload);
    }

    return res.json({
      success: true,
      message: 'Store location updated successfully',
      latitude: user.latitude,
      longitude: user.longitude,
      address: user.address,
      fullAddress: user.fullAddress,
      user,
    });
  } catch (err) {
    console.error('[SUPPLIER LOCATION ERROR]:', err);
    return res.status(500).json({ success: false, message: 'Server error updating location' });
  }
};

module.exports = {
  setupProfile,
  getProfileById,
  updateProfile,
  uploadPhoto,
  updateStatus,
  updateSupplierLocation,
  getOnlineRestaurants,
  setIO,
  toggleSaveRestaurant,
  isRestaurantSaved,
  hideRestaurant,
  checkRestaurantAvailability,
  invalidateRestaurantsCache,
};

