const express = require('express');
const {
  setupProfile,
  getProfileById,
  updateProfile,
  uploadPhoto,
  updateStatus,
  updateSupplierLocation,
  getOnlineRestaurants,
  toggleSaveRestaurant,
  isRestaurantSaved,
  hideRestaurant,
  checkRestaurantAvailability,
} = require('../controllers/profileController');
const { protect, optionalProtect } = require('../middleware/authMiddleware');
const { upload, compressImage } = require('../middleware/uploadMiddleware');

const router = express.Router();

// Restaurant List & Database Check Endpoints
router.get('/restaurants/check', async (req, res) => {
  try {
    const User = require('../models/User');
    const MenuItem = require('../models/MenuItem');
    
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

router.get('/restaurants/online', getOnlineRestaurants);
router.get('/restaurants', getOnlineRestaurants);

// Restaurant / Partner Online/Offline Status Endpoint
router.put('/status', optionalProtect, updateStatus);
router.post('/status', optionalProtect, updateStatus);

// Direct Store / Supplier Location Update Endpoint
router.put('/supplier-location', optionalProtect, updateSupplierLocation);
router.post('/supplier-location', optionalProtect, updateSupplierLocation);

// Upload → Auto-compress image to ≤50KB → Setup profile
router.post(
  '/setup',
  protect,
  upload.fields([{ name: 'profilePicture', maxCount: 1 }]),
  compressImage,
  setupProfile
);

const jwt = require('jsonwebtoken');
const User = require('../models/User');

router.post('/save-restaurant', optionalProtect, toggleSaveRestaurant);
router.get('/is-saved/:restaurantId', optionalProtect, isRestaurantSaved);
router.post('/hide-restaurant', optionalProtect, hideRestaurant);

router.get('/restaurant-availability/:id', checkRestaurantAvailability);
router.get('/:id', optionalProtect, getProfileById);

// Update profile details - works with token OR with param ID
router.put('/:id', optionalProtect, updateProfile);
router.put('/', optionalProtect, updateProfile);

// Upload a single photo for profile image
router.post(
  '/upload-photo',
  protect,
  upload.fields([{ name: 'photo', maxCount: 1 }]),
  compressImage,
  uploadPhoto
);

module.exports = router;


