const express = require('express');
const { getSettings, updateSettings, getPublicSettings } = require('../controllers/settingsController');
const { protect } = require('../middleware/authMiddleware');
const AdminSettings = require('../models/AdminSettings');
const { upload, compressImage } = require('../middleware/uploadMiddleware');

const router = express.Router();

const DEFAULT_SPLASH_SCREEN = {
  backgroundColor: '#0066FF',
  splashImage: '',
  brandNamePrimary: 'RIDE',
  brandNameSecondary: 'HUB',
  brandTagline: 'EXPRESS ECOSYSTEM',
  superAppText: 'MULTI-ROLE UNIFIED SUPER APP',
  durationSeconds: 2.8,
  customer: {
    title: 'Order & Book',
    subtitle: 'Food • Groceries • Rides',
    image: '',
  },
  supplier: {
    title: 'Sell & Grow',
    subtitle: 'Store & Merchant Portal',
    image: '',
  },
  delivery: {
    title: 'Deliver & Earn',
    subtitle: 'Fast Fleet & Daily Payouts',
    image: '',
  },
};

// GET /api/settings/rain & /api/settings/rain-mode (Public for mobile apps & admin)
const handleGetRainMode = async (req, res) => {
  try {
    let settings = await AdminSettings.findOne();
    if (!settings) {
      settings = await AdminSettings.create({
        rainMode: {
          isActive: false,
          surgeFee: 10,
          title: 'Normal Weather',
          subtitle: 'Standard delivery operations in progress',
        },
      });
    }
    const rain = settings.rainMode || {
      isActive: false,
      surgeFee: 10,
      title: 'Normal Weather',
      subtitle: 'Standard delivery operations in progress',
    };
    res.json({ success: true, rainMode: rain, isRaining: Boolean(rain.isActive) });
  } catch (error) {
    res.status(200).json({
      success: true,
      rainMode: {
        isActive: false,
        surgeFee: 10,
        title: 'Normal Weather',
        subtitle: 'Standard delivery operations in progress',
      },
      isRaining: false,
    });
  }
};

router.get('/rain', handleGetRainMode);
router.get('/rain-mode', handleGetRainMode);

// POST & PUT /api/settings/rain & /api/settings/rain-mode (Toggle or update rain mode)
const handleUpdateRainMode = async (req, res) => {
  try {
    let settings = await AdminSettings.findOne();
    if (!settings) {
      settings = await AdminSettings.create({});
    }
    const { isActive, surgeFee, title, subtitle } = req.body;
    if (!settings.rainMode) {
      settings.rainMode = {
        isActive: true,
        surgeFee: 10,
        title: 'Rainy Weather in your area',
        subtitle: 'Rider weather incentive active • Safe deliveries in progress',
      };
    }
    if (isActive !== undefined) settings.rainMode.isActive = Boolean(isActive);
    if (surgeFee !== undefined) settings.rainMode.surgeFee = Number(surgeFee);
    if (title !== undefined) settings.rainMode.title = title;
    if (subtitle !== undefined) settings.rainMode.subtitle = subtitle;

    await settings.save();

    // Broadcast live socket event so mobile devices react immediately
    const io = req.app.get('io') || global.io;
    if (io) {
      io.emit('rain_mode_updated', settings.rainMode);
      console.log('🌧️ [Socket Emit] rain_mode_updated:', settings.rainMode);
    }

    res.json({ success: true, message: 'Rain mode updated successfully', rainMode: settings.rainMode });
  } catch (error) {
    console.error('Error updating rain settings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

router.post('/rain', handleUpdateRainMode);
router.put('/rain', handleUpdateRainMode);
router.post('/rain-mode', handleUpdateRainMode);
router.put('/rain-mode', handleUpdateRainMode);

// GET /api/settings/splash (Public for mobile app & admin preview)
router.get('/splash', async (req, res) => {
  try {
    let settings = await AdminSettings.findOne();
    if (!settings) {
      settings = await AdminSettings.create({ splashScreen: DEFAULT_SPLASH_SCREEN });
    }
    const splash = (settings && settings.splashScreen) ? settings.splashScreen : DEFAULT_SPLASH_SCREEN;
    res.json({ success: true, splashScreen: splash });
  } catch (error) {
    res.status(200).json({ success: true, splashScreen: DEFAULT_SPLASH_SCREEN });
  }
});

// POST & PUT /api/settings/splash (Admin customization with full-screen image upload)
const splashUpload = upload.fields([
  { name: 'splashImage', maxCount: 1 },
  { name: 'image', maxCount: 1 },
  { name: 'customerImage', maxCount: 1 },
  { name: 'supplierImage', maxCount: 1 },
  { name: 'deliveryImage', maxCount: 1 },
]);

router.all('/splash', splashUpload, compressImage, async (req, res, next) => {
  if (req.method !== 'POST' && req.method !== 'PUT') return next();
  try {
    let settings = await AdminSettings.findOne();
    if (!settings) {
      settings = await AdminSettings.create({});
    }

    const currentSplash = settings.splashScreen ? settings.splashScreen.toObject() : { ...DEFAULT_SPLASH_SCREEN };
    const b = req.body || {};

    const updatedSplash = {
      backgroundColor: b.backgroundColor || currentSplash.backgroundColor || '#0066FF',
      splashImage: b.splashImage || currentSplash.splashImage || '',
      brandNamePrimary: b.brandNamePrimary || currentSplash.brandNamePrimary || 'RIDE',
      brandNameSecondary: b.brandNameSecondary || currentSplash.brandNameSecondary || 'HUB',
      brandTagline: b.brandTagline || currentSplash.brandTagline || 'EXPRESS ECOSYSTEM',
      superAppText: b.superAppText || currentSplash.superAppText || 'MULTI-ROLE UNIFIED SUPER APP',
      durationSeconds: Number(b.durationSeconds) || currentSplash.durationSeconds || 2.8,
      customer: {
        title: b.customerTitle !== undefined ? b.customerTitle : (currentSplash.customer?.title || 'Order & Book'),
        subtitle: b.customerSubtitle !== undefined ? b.customerSubtitle : (currentSplash.customer?.subtitle || 'Food • Groceries • Rides'),
        image: currentSplash.customer?.image || '',
      },
      supplier: {
        title: b.supplierTitle !== undefined ? b.supplierTitle : (currentSplash.supplier?.title || 'Sell & Grow'),
        subtitle: b.supplierSubtitle !== undefined ? b.supplierSubtitle : (currentSplash.supplier?.subtitle || 'Store & Merchant Portal'),
        image: currentSplash.supplier?.image || '',
      },
      delivery: {
        title: b.deliveryTitle !== undefined ? b.deliveryTitle : (currentSplash.delivery?.title || 'Deliver & Earn'),
        subtitle: b.deliverySubtitle !== undefined ? b.deliverySubtitle : (currentSplash.delivery?.subtitle || 'Fast Fleet & Daily Payouts'),
        image: currentSplash.delivery?.image || '',
      },
    };

    // Process files if uploaded
    if (req.files) {
      if (req.files.splashImage && req.files.splashImage[0]) {
        updatedSplash.splashImage = `/uploads/${req.files.splashImage[0].filename}`;
      } else if (req.files.image && req.files.image[0]) {
        updatedSplash.splashImage = `/uploads/${req.files.image[0].filename}`;
      }
      if (req.files.customerImage && req.files.customerImage[0]) {
        updatedSplash.customer.image = `/uploads/${req.files.customerImage[0].filename}`;
      }
      if (req.files.supplierImage && req.files.supplierImage[0]) {
        updatedSplash.supplier.image = `/uploads/${req.files.supplierImage[0].filename}`;
      }
      if (req.files.deliveryImage && req.files.deliveryImage[0]) {
        updatedSplash.delivery.image = `/uploads/${req.files.deliveryImage[0].filename}`;
      }
    }

    // Direct image URL overrides if provided
    if (b.splashImageUrl !== undefined) updatedSplash.splashImage = b.splashImageUrl;
    if (b.customerImageUrl !== undefined) updatedSplash.customer.image = b.customerImageUrl;
    if (b.supplierImageUrl !== undefined) updatedSplash.supplier.image = b.supplierImageUrl;
    if (b.deliveryImageUrl !== undefined) updatedSplash.delivery.image = b.deliveryImageUrl;

    settings.splashScreen = updatedSplash;
    await settings.save();

    // Broadcast socket event
    const io = req.app.get('io');
    if (io) {
      io.emit('splash_screen_updated', updatedSplash);
      console.log('📡 [Socket Emit] splash_screen_updated');
    }

    res.json({ success: true, message: 'Splash screen settings updated successfully', splashScreen: updatedSplash });
  } catch (error) {
    console.error('Error updating splash settings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/settings/diamond-animation (Public for customer mobile app)
router.get(['/diamond-animation', '/diamond-lottie'], async (req, res) => {
  try {
    let settings = await AdminSettings.findOne();
    if (!settings) {
      settings = await AdminSettings.create({});
    }
    const diamond = settings.diamondAnimation || {
      isActive: true,
      animationUrl: '',
      animationName: 'Default Shopping Animation',
      speed: 0.9,
    };
    res.json({ success: true, diamondAnimation: diamond });
  } catch (error) {
    res.status(200).json({
      success: true,
      diamondAnimation: {
        isActive: true,
        animationUrl: '',
        animationName: 'Default Shopping Animation',
        speed: 0.9,
      },
    });
  }
});

// POST /api/settings/diamond-animation (Admin control)
const lottieUpload = upload.single('lottieFile');
router.post(['/diamond-animation', '/diamond-lottie'], lottieUpload, async (req, res) => {
  try {
    let settings = await AdminSettings.findOne();
    if (!settings) {
      settings = await AdminSettings.create({});
    }
    const current = settings.diamondAnimation ? settings.diamondAnimation.toObject() : {};
    const b = req.body || {};

    let fileUrl = b.animationUrl || current.animationUrl || '';
    if (req.file) {
      fileUrl = `/uploads/${req.file.filename}`;
    }

    const updated = {
      isActive: b.isActive !== undefined ? Boolean(b.isActive === true || b.isActive === 'true') : (current.isActive !== undefined ? current.isActive : true),
      animationUrl: fileUrl,
      animationName: b.animationName || current.animationName || 'Custom Diamond Animation',
      speed: Number(b.speed) || current.speed || 0.9,
      updatedAt: new Date(),
    };

    settings.diamondAnimation = updated;
    await settings.save();

    const io = req.app.get('io') || global.io;
    if (io) {
      io.emit('diamond_animation_updated', updated);
    }

    res.json({ success: true, message: 'Diamond animation updated successfully', diamondAnimation: updated });
  } catch (error) {
    console.error('Error updating diamond animation:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/', protect, getSettings);
router.put('/', protect, updateSettings);
router.get('/public', protect, getPublicSettings);

module.exports = router;
