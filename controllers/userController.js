const User = require('../models/User');

// @desc    Get dating cards feed - ALL registered users
// @route   GET /api/users/feed
// @access  Private
const getFeedProfiles = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;

    console.log(`\n========== [FEED API] ==========`);
    console.log(`[FEED] Request from User ID: ${currentUserId}`);

    // Step 1: Verify current user exists
    const currentUser = await User.findById(currentUserId);
    if (!currentUser) {
      console.log(`[FEED] ERROR: Current user ${currentUserId} NOT FOUND in MongoDB`);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    console.log(`[FEED] Current user found: ${currentUser.name || currentUser.username}`);

    // Step 2: Count total users in database
    const totalUsersInDB = await User.countDocuments({ role: { $ne: 'admin' }, isAdmin: { $ne: true } });
    console.log(`[FEED] Total users in MongoDB: ${totalUsersInDB}`);

    // Step 3: Count profile-complete users
    const profileCompleteCount = await User.countDocuments({ isProfileComplete: true, role: { $ne: 'admin' }, isAdmin: { $ne: true } });
    console.log(`[FEED] Users with isProfileComplete=true: ${profileCompleteCount}`);

    // Step 4: Build query - ONLY exclude current user, ONLY require isProfileComplete
    // REMOVED: privacyProfileVisible filter (was silently hiding users)
    // REMOVED: lookingFor gender filter (was restricting feed)
    const query = {
      _id: { $ne: currentUserId },
      isProfileComplete: true,
      role: { $ne: 'admin' },
      isAdmin: { $ne: true }
    };

    console.log(`[FEED] Query filter:`, JSON.stringify(query));

    // Step 5: Fetch ALL matching profiles with all needed fields
    const profiles = await User.find(query)
      .select('name age gender bio location country state city profilePicture photos hobbies isOnline lastSeen profession verificationStatus')
      .sort({ createdAt: -1 }); // Newest first

    console.log(`[FEED] Profiles returned: ${profiles.length}`);
    
    // Step 6: Log each profile for debugging
    profiles.forEach((p, i) => {
      console.log(`[FEED]   ${i + 1}. ${p.name || 'NO NAME'} | Age: ${p.age || 'N/A'} | Gender: ${p.gender || 'N/A'} | Photo: ${p.profilePicture ? 'YES' : 'NO'} | Online: ${p.isOnline}`);
    });

    // Step 7: If no profiles found, log detailed diagnosis
    if (profiles.length === 0) {
      console.log(`[FEED] WARNING: No profiles found! Running diagnosis...`);
      const allUsers = await User.find({ _id: { $ne: currentUserId }, role: { $ne: 'admin' }, isAdmin: { $ne: true } }).select('username isProfileComplete privacyProfileVisible');
      console.log(`[FEED] All other users (including incomplete):`, allUsers.map(u => ({
        username: u.username,
        isProfileComplete: u.isProfileComplete,
        privacyProfileVisible: u.privacyProfileVisible
      })));
    }

    console.log(`========== [FEED API END] ==========\n`);

    res.json({
      success: true,
      count: profiles.length,
      profiles,
    });
  } catch (error) {
    console.error(`[FEED] CRITICAL ERROR:`, error.message, error);
    next(error);
  }
};

// @desc    Block a user
// @route   POST /api/users/block/:id
// @access  Private
const blockUser = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;
    const targetUserId = req.params.id;

    if (currentUserId === targetUserId) {
      return res.status(400).json({ success: false, message: 'You cannot block yourself' });
    }

    const currentUser = await User.findById(currentUserId);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Add to blockedUsers if not already there
    if (!currentUser.blockedUsers.some(id => id.toString() === targetUserId.toString())) {
      currentUser.blockedUsers.push(targetUserId);
      await currentUser.save();
    }

    res.json({ success: true, message: 'User blocked successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Unblock a user
// @route   POST /api/users/unblock/:id
// @access  Private
const unblockUser = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;
    const targetUserId = req.params.id;

    const currentUser = await User.findById(currentUserId);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (currentUser.blockedUsers.some(id => id.toString() === targetUserId.toString())) {
      currentUser.blockedUsers = currentUser.blockedUsers.filter(id => id.toString() !== targetUserId.toString());
      await currentUser.save();
    }

    res.json({ success: true, message: 'User unblocked successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user profile details / photo
// @route   PUT /api/users/update-profile
// @access  Private / Public with userId
const updateUserProfile = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.body?.userId || req.query?.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const { profilePicture, name, photos, vehicleNumber, secondaryPhone, zone, latitude, longitude, locationCoords, address, fullAddress, location } = req.body;
    const updateData = {};
    if (profilePicture !== undefined) updateData.profilePicture = profilePicture;
    if (name !== undefined) updateData.name = name;
    if (photos !== undefined) updateData.photos = photos;
    if (vehicleNumber !== undefined) updateData.vehicleNumber = vehicleNumber;
    if (secondaryPhone !== undefined) updateData.secondaryPhone = secondaryPhone;
    if (zone !== undefined) updateData.zone = zone;

    const lat = Number(latitude || (locationCoords && locationCoords.latitude) || 0);
    const lon = Number(longitude || (locationCoords && locationCoords.longitude) || 0);
    if (!isNaN(lat) && lat !== 0) {
      updateData.latitude = lat;
      updateData.businessLatitude = lat;
    }
    if (!isNaN(lon) && lon !== 0) {
      updateData.longitude = lon;
      updateData.businessLongitude = lon;
    }
    if (lat !== 0 && lon !== 0 && !isNaN(lat) && !isNaN(lon)) {
      updateData.locationCoords = { latitude: lat, longitude: lon };
    }
    const addr = fullAddress || address || location || '';
    if (addr && typeof addr === 'string' && addr.trim() && addr !== '[object Object]') {
      updateData.address = addr.trim();
      updateData.fullAddress = addr.trim();
      updateData.location = addr.trim();
    }

    const updatedUser = await User.findByIdAndUpdate(userId, { $set: updateData }, { new: true });
    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    console.log(`✅ [USER PROFILE UPDATED] User ${userId} updated (GPS: ${updateData.latitude}, ${updateData.longitude})`);
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user mobile number with OTP verification & duplicate check
// @route   POST /api/users/update-phone
// @access  Private / Public with userId
const updatePhoneWithOtp = async (req, res, next) => {
  try {
    const Otp = require('../models/Otp');
    const smsService = require('../services/smsService');

    const userId = req.user?.id || req.body?.userId || req.query?.userId;
    const { newPhone, newPhoneNumber, otp } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const rawPhone = newPhone || newPhoneNumber || '';
    const cleanPhone = String(rawPhone).replace(/[^0-9]/g, '').slice(-10);
    const cleanOtp = String(otp || '').trim();

    if (!cleanPhone || cleanPhone.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit new mobile number is required.' });
    }

    if (!cleanOtp || cleanOtp.length !== 6) {
      return res.status(400).json({ success: false, message: 'Valid 6-digit OTP is required.' });
    }

    // 1. Verify user exists
    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    // If new phone is already the user's current phone
    if (currentUser.phoneNumber === cleanPhone || currentUser.phone === cleanPhone) {
      return res.status(400).json({ success: false, message: 'New mobile number cannot be the same as your current number.' });
    }

    // 2. Duplicate phone check against all other users in MongoDB
    const duplicateUser = await User.findOne({
      _id: { $ne: userId },
      $or: [
        { phoneNumber: cleanPhone },
        { phone: cleanPhone },
        { username: cleanPhone },
      ],
    });

    if (duplicateUser) {
      return res.status(409).json({
        success: false,
        message: 'This mobile number is already registered with another account.',
      });
    }

    // 3. Verify OTP from Otp collection
    const otpDoc = await Otp.findOne({
      phoneNumber: cleanPhone,
      purpose: { $in: ['update_phone', 'login', 'signup'] },
      verified: false,
      expiresAt: { $gt: new Date() },
    });

    if (!otpDoc) {
      return res.status(400).json({
        success: false,
        message: 'OTP expired or not found. Please request a new OTP.',
      });
    }

    const submittedHash = smsService.hashOtp(cleanOtp);
    if (submittedHash !== otpDoc.otpHash) {
      otpDoc.attempts = (otpDoc.attempts || 0) + 1;
      await otpDoc.save();
      return res.status(401).json({ success: false, message: 'Incorrect OTP. Please check and try again.' });
    }

    // 4. Delete used OTP
    await Otp.deleteMany({ phoneNumber: cleanPhone });

    // 5. Update user mobile number in MongoDB
    currentUser.phoneNumber = cleanPhone;
    currentUser.phone = cleanPhone;
    // If username was equal to old phone, update it as well
    if (/^\d{10}$/.test(currentUser.username)) {
      currentUser.username = cleanPhone;
    }
    currentUser.isMobileVerified = true;
    await currentUser.save();

    console.log(`📱 [PHONE UPDATED] User ${userId} successfully updated mobile number to +91${cleanPhone}`);

    return res.status(200).json({
      success: true,
      message: 'Mobile number updated successfully!',
      phoneNumber: cleanPhone,
      user: currentUser,
    });
  } catch (error) {
    console.error('❌ [UPDATE PHONE ERROR]:', error);
    return res.status(500).json({ success: false, message: 'Failed to update mobile number: ' + error.message });
  }
};

module.exports = {
  getFeedProfiles,
  blockUser,
  unblockUser,
  updateUserProfile,
  updatePhoneWithOtp,
};
