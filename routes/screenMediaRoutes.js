const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const ScreenMedia = require('../models/ScreenMedia');
const { protect } = require('../middleware/authMiddleware');

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Memory storage for inspection and validation before writing to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
});

// Default screens configuration
const DEFAULT_SCREENS = [
  {
    screenId: 'SPLASH_SCREEN',
    screenName: 'Splash Screen',
    allowedMediaTypes: ['IMAGE', 'LOTTIE'],
    currentMediaType: 'IMAGE',
    title: 'Brand Launch Screen',
    description: 'First visual graphic displayed when app launches',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'ROLE_SELECTION',
    screenName: 'Role Selection Screen',
    allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
    currentMediaType: 'IMAGE',
    title: 'Welcome & Role Switcher',
    description: 'Header illustration for Customer / Rider / Store selection',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'CUSTOMER_HOME',
    screenName: 'Customer Home',
    allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
    currentMediaType: 'BOTH',
    title: 'Customer Home Hero Spotlight',
    description: 'Top promotional cards and interactive animations on customer feed',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'FOOD_BANNER',
    screenName: 'Food Screen Banner & Animation',
    allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
    currentMediaType: 'BOTH',
    title: 'Food & Dining Promotional Banner & Animation',
    description: 'Hero banners and animations shown in Food delivery & restaurant section',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'FASHION_BANNER',
    screenName: 'Fashion Screen Banner & Animation',
    allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
    currentMediaType: 'BOTH',
    title: 'Fashion & Apparel Hero Banner & Animation',
    description: 'Top festival/sale banner and animations on the Fashion screen',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'TOYS_BANNER',
    screenName: 'Toys Screen Banner & Animation',
    allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
    currentMediaType: 'BOTH',
    title: 'Toys & Kids Promotional Banner & Animation',
    description: 'Promotional hero banners and animations for Toys, Games & Kids section',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'VEGETABLES_BANNER',
    screenName: 'Vegetables Screen Banner & Animation',
    allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
    currentMediaType: 'BOTH',
    title: 'Fresh Vegetables & Fruits Banner & Animation',
    description: 'Farm fresh farm-to-door banners and animations for Vegetables & Fruits section',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'BEAUTY_BANNER',
    screenName: 'Beauty Screen Banner & Animation',
    allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
    currentMediaType: 'BOTH',
    title: 'Beauty & Personal Care Banner & Animation',
    description: 'Cosmetics, skincare and beauty essentials hero banner and animations',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'KIRANA_BANNER',
    screenName: 'Kirana / Grocery Banner & Animation',
    allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
    currentMediaType: 'BOTH',
    title: 'Kirana & Daily Grocery Hero Banner & Animation',
    description: 'Daily essentials, super-fast kirana deals banners and animations',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'CATEGORY_IMAGES',
    screenName: 'Category Images',
    allowedMediaTypes: ['IMAGE'],
    currentMediaType: 'IMAGE',
    title: 'Master Category Catalog Media',
    description: 'Icons and artwork for all catalog services (Food, Fashion, Groceries, etc.)',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'PRODUCT_PROMOTION',
    screenName: 'Product Promotion Banner',
    allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
    currentMediaType: 'BANNER',
    title: 'Product Deals Spotlight',
    description: 'Special offers and discount banners across checkout and product listings',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'RIDER_HOME',
    screenName: 'Rider Home Screen',
    allowedMediaTypes: ['IMAGE', 'BANNER'],
    currentMediaType: 'BANNER',
    title: 'Delivery Partner Dashboard Media',
    description: 'Incentive banners and announcement posters for delivery riders',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'SUPPLIER_HOME',
    screenName: 'Supplier Home Screen',
    allowedMediaTypes: ['IMAGE', 'BANNER'],
    currentMediaType: 'BANNER',
    title: 'Store & Merchant Portal Media',
    description: 'Promotional banners and merchant news for suppliers and restaurants',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'LIVE_TRACKING',
    screenName: 'Live Order Tracking Screen',
    allowedMediaTypes: [],
    currentMediaType: 'NONE',
    title: 'GPS Navigation & Status Screen',
    description: 'Critical live order screen with real-time GPS tracking and navigation.',
    isRestricted: true,
    restrictionReason: 'Media Upload Disabled: Live Order Tracking screen is strictly reserved for real-time Map, Rider GPS, Order Status, and navigation. Custom dynamic banners or lotties are forbidden.',
    isActive: false,
  },
];

// Helper: Ensure defaults are seeded
const ensureScreensSeeded = async () => {
  try {
    for (const s of DEFAULT_SCREENS) {
      const exists = await ScreenMedia.findOne({ screenId: s.screenId });
      if (!exists) {
        await ScreenMedia.create(s);
      } else if (s.screenId === 'LIVE_TRACKING') {
        // Enforce restriction on LIVE_TRACKING always
        exists.isRestricted = true;
        exists.restrictionReason = s.restrictionReason;
        exists.allowedMediaTypes = [];
        exists.isActive = false;
        await exists.save();
      } else {
        // Ensure new allowed types (IMAGE, LOTTIE) are enabled for existing records
        let modified = false;
        if (s.allowedMediaTypes && (!exists.allowedMediaTypes || exists.allowedMediaTypes.length < s.allowedMediaTypes.length)) {
          exists.allowedMediaTypes = s.allowedMediaTypes;
          modified = true;
        }
        if (!exists.screenName || exists.screenName !== s.screenName) {
          exists.screenName = s.screenName;
          modified = true;
        }
        if (modified) await exists.save();
      }
    }
  } catch (err) {
    console.error('[ScreenMedia] Seed error:', err.message);
  }
};

// Screen ID Normalizer to handle spaces, lowercase, hyphens and aliases (e.g., 'FASHION BANNER' -> 'FASHION_BANNER')
const normalizeScreenId = (rawId) => {
  if (!rawId) return '';
  let id = decodeURIComponent(String(rawId)).trim().toUpperCase().replace(/[\s\-]+/g, '_');
  const aliasMap = {
    'FOOD': 'FOOD_BANNER',
    'FOOD_SCREEN': 'FOOD_BANNER',
    'FASHION': 'FASHION_BANNER',
    'FASHION_SCREEN': 'FASHION_BANNER',
    'TOY': 'TOYS_BANNER',
    'TOYS': 'TOYS_BANNER',
    'TOYS_SCREEN': 'TOYS_BANNER',
    'VEGETABLE': 'VEGETABLES_BANNER',
    'VEGETABLES': 'VEGETABLES_BANNER',
    'VEG': 'VEGETABLES_BANNER',
    'VEG_BANNER': 'VEGETABLES_BANNER',
    'BEAUTY': 'BEAUTY_BANNER',
    'BEAUTY_SCREEN': 'BEAUTY_BANNER',
    'KIRANA': 'KIRANA_BANNER',
    'GROCERY': 'KIRANA_BANNER',
    'GROCERY_BANNER': 'KIRANA_BANNER',
    'HOME': 'CUSTOMER_HOME',
    'CUSTOMER': 'CUSTOMER_HOME',
    'USER': 'CUSTOMER_HOME',
    'SPLASH': 'SPLASH_SCREEN',
    'ROLE': 'ROLE_SELECTION',
    'CATEGORY': 'CATEGORY_IMAGES',
    'CATEGORIES': 'CATEGORY_IMAGES',
    'CATEGORY_IMAGE': 'CATEGORY_IMAGES',
    'PROMOTION': 'PRODUCT_PROMOTION',
    'PRODUCT': 'PRODUCT_PROMOTION',
    'RIDER': 'RIDER_HOME',
    'SUPPLIER': 'SUPPLIER_HOME',
    'STORE': 'SUPPLIER_HOME',
    'RESTAURANT': 'SUPPLIER_HOME',
    'TRACKING': 'LIVE_TRACKING',
    'LIVE_TRACKING_SCREEN': 'LIVE_TRACKING',
    'LIVE_ORDER_TRACKING': 'LIVE_TRACKING',
  };
  return aliasMap[id] || id;
};

// GET /api/screen-media — Get all screen configurations
router.get('/', async (req, res) => {
  try {
    await ensureScreensSeeded();
    const screens = await ScreenMedia.find({}).sort({ isRestricted: 1, createdAt: 1 });
    res.json({ success: true, screens });
  } catch (error) {
    console.error('Error fetching screen media list:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/screen-media/:screenId — Get configuration for a single screen
router.get('/:screenId', async (req, res) => {
  try {
    await ensureScreensSeeded();
    const sid = normalizeScreenId(req.params.screenId);
    let screen = await ScreenMedia.findOne({ screenId: sid });
    if (!screen) {
      const defaultDef = DEFAULT_SCREENS.find((s) => s.screenId === sid);
      if (defaultDef) {
        screen = await ScreenMedia.create(defaultDef);
      } else {
        return res.status(404).json({ success: false, message: `Screen configuration '${sid}' not found` });
      }
    }
    res.json({ success: true, screen });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/screen-media/:screenId/upload — Upload media for a screen
router.post('/:screenId/upload', upload.single('mediaFile'), async (req, res) => {
  try {
    const sid = normalizeScreenId(req.params.screenId);

    // ─────────────────────────────────────────────────────────────
    // CRITICAL REQUIREMENT: Live Order Tracking screen is strictly restricted!
    // ─────────────────────────────────────────────────────────────
    if (sid === 'LIVE_TRACKING') {
      return res.status(403).json({
        success: false,
        message: 'Media Upload Disabled: Live Order Tracking screen is strictly protected. Decorative media, banners, and Lottie animations are prohibited to ensure critical GPS and live operations remain intact.',
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please provide a file to upload' });
    }

    let screen = await ScreenMedia.findOne({ screenId: sid });
    if (!screen) {
      const defaultDef = DEFAULT_SCREENS.find((s) => s.screenId === sid);
      screen = await ScreenMedia.create(defaultDef || {
        screenId: sid,
        screenName: req.body.screenName || sid.replace(/_/g, ' '),
        allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
        currentMediaType: 'BOTH',
        displayMode: 'BOTH',
        isActive: true,
      });
    }

    const originalName = req.file.originalname || '';
    const ext = path.extname(originalName).toLowerCase();
    const mimetype = (req.file.mimetype || '').toLowerCase();

    const isLottie = ext === '.json' || ext === '.lottie' || mimetype.includes('json');
    const isImage = /jpeg|jpg|png|webp|jfif|avif|heic|gif|bmp/i.test(ext) || mimetype.startsWith('image/');

    if (!isLottie && !isImage) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file format. Supported: PNG, JPG, JPEG, WEBP, AVIF, JSON (Lottie), and .lottie files.',
      });
    }

    let lottieConfig = screen.lottieConfig || { speed: 1.0, loop: true, autoplay: true, rawJson: null };
    let mediaType = isLottie ? 'LOTTIE' : 'IMAGE';

    // Validate Lottie JSON structure if file is JSON
    if (ext === '.json' || mimetype.includes('json')) {
      try {
        const jsonContent = JSON.parse(req.file.buffer.toString('utf8'));
        if (typeof jsonContent !== 'object' || jsonContent === null) {
          throw new Error('Root JSON structure must be an object');
        }
        lottieConfig.rawJson = jsonContent;
      } catch (jsonErr) {
        return res.status(400).json({
          success: false,
          message: `Invalid Lottie JSON: ${jsonErr.message}. Please upload a valid Lottie animation file.`,
        });
      }
    }

    // Save file to disk
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const filename = `screen-${sid.toLowerCase()}-${uniqueSuffix}${ext}`;
    const destinationPath = path.join(uploadDir, filename);
    fs.writeFileSync(destinationPath, req.file.buffer);

    const mediaUrl = `/uploads/${filename}`;
    const nextVersion = (screen.version || 1) + 1;

    if (mediaType === 'IMAGE') {
      screen.imageUrl = mediaUrl;
      screen.mediaUrl = mediaUrl;
      if (screen.lottieUrl) {
        screen.currentMediaType = 'BOTH';
      } else {
        screen.currentMediaType = 'IMAGE';
      }
    } else if (mediaType === 'LOTTIE') {
      screen.lottieUrl = mediaUrl;
      if (!screen.imageUrl) {
        screen.mediaUrl = mediaUrl;
      }
      if (screen.imageUrl) {
        screen.currentMediaType = 'BOTH';
      } else {
        screen.currentMediaType = 'LOTTIE';
      }
    }

    screen.version = nextVersion;
    screen.publishedAt = new Date();
    screen.isActive = true;

    if (req.body.displayMode) screen.displayMode = req.body.displayMode;
    if (req.body.title) screen.title = req.body.title.trim();
    if (req.body.description) screen.description = req.body.description.trim();

    // Update Lottie controls if passed in body
    if (req.body.speed !== undefined) lottieConfig.speed = Math.max(0.2, Math.min(3.0, Number(req.body.speed) || 1.0));
    if (req.body.loop !== undefined) lottieConfig.loop = String(req.body.loop) === 'true';
    if (req.body.autoplay !== undefined) lottieConfig.autoplay = String(req.body.autoplay) === 'true';
    screen.lottieConfig = lottieConfig;

    await screen.save();

    // If uploading for SPLASH_SCREEN, synchronize with AdminSettings as well
    if (sid === 'SPLASH_SCREEN' && mediaType === 'IMAGE') {
      try {
        const AdminSettings = require('../models/AdminSettings');
        let settings = await AdminSettings.findOne();
        if (!settings) settings = await AdminSettings.create({});
        if (!settings.splashScreen) settings.splashScreen = {};
        settings.splashScreen.splashImage = mediaUrl;
        settings.splashScreen.updatedAt = new Date();
        await settings.save();
        const io = req.app.get('io') || global.io;
        if (io) io.emit('splash_screen_updated', settings.splashScreen);
      } catch (err) {
        console.warn('Splash sync note:', err.message);
      }
    }

    // Broadcast socket event for real-time live synchronization
    const io = req.app.get('io') || global.io;
    if (io) {
      io.emit('screen_media_updated', screen);
      io.emit(`screen_media_${sid.toLowerCase()}`, screen);
      console.log(`📡 [Socket Emit] screen_media_updated for ${sid}`);
    }

    res.json({
      success: true,
      message: `Media uploaded and published live for ${screen.screenName}!`,
      screen,
    });
  } catch (error) {
    console.error('Error in screen media upload:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/screen-media/:screenId — Update configuration / controls (speed, loop, isActive, etc.)
router.put('/:screenId', async (req, res) => {
  try {
    await ensureScreensSeeded();
    const sid = normalizeScreenId(req.params.screenId);

    if (sid === 'LIVE_TRACKING') {
      return res.status(403).json({
        success: false,
        message: 'Media configuration is disabled for Live Order Tracking screen.',
      });
    }

    let screen = await ScreenMedia.findOne({ screenId: sid });
    if (!screen) {
      const defaultDef = DEFAULT_SCREENS.find((s) => s.screenId === sid);
      screen = await ScreenMedia.create(defaultDef || {
        screenId: sid,
        screenName: sid.replace(/_/g, ' '),
        allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
        currentMediaType: 'BOTH',
        displayMode: 'BOTH',
        isActive: true,
      });
    }

    const b = req.body || {};

    if (b.isActive !== undefined) screen.isActive = Boolean(b.isActive);
    if (b.title !== undefined) screen.title = b.title;
    if (b.description !== undefined) screen.description = b.description;
    if (b.currentMediaType !== undefined) screen.currentMediaType = b.currentMediaType;
    if (b.displayMode !== undefined) screen.displayMode = b.displayMode;

    if (b.lottieConfig) {
      screen.lottieConfig = {
        speed: b.lottieConfig.speed !== undefined ? Number(b.lottieConfig.speed) : screen.lottieConfig?.speed || 1.0,
        loop: b.lottieConfig.loop !== undefined ? Boolean(b.lottieConfig.loop) : screen.lottieConfig?.loop !== false,
        autoplay: b.lottieConfig.autoplay !== undefined ? Boolean(b.lottieConfig.autoplay) : screen.lottieConfig?.autoplay !== false,
        rawJson: screen.lottieConfig?.rawJson || null,
      };
    }

    screen.publishedAt = new Date();
    screen.version = (screen.version || 1) + 1;
    await screen.save();

    const io = req.app.get('io') || global.io;
    if (io) {
      io.emit('screen_media_updated', screen);
      io.emit(`screen_media_${sid.toLowerCase()}`, screen);
    }

    res.json({ success: true, message: 'Screen configuration updated successfully', screen });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/screen-media/target/:targetKey — Direct lookup by category or screen nickname
router.get('/target/:targetKey', async (req, res) => {
  try {
    await ensureScreensSeeded();
    const sid = normalizeScreenId(req.params.targetKey);
    let screen = await ScreenMedia.findOne({ screenId: sid });
    if (!screen) {
      const defaultDef = DEFAULT_SCREENS.find((s) => s.screenId === sid);
      if (defaultDef) {
        screen = await ScreenMedia.create(defaultDef);
      } else {
        return res.status(404).json({ success: false, message: `Screen media for '${sid}' not found` });
      }
    }
    res.json({ success: true, screen });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/screen-media/:screenId — Reset/Remove media for screen (supports ?type=IMAGE|LOTTIE|ALL)
router.delete('/:screenId', async (req, res) => {
  try {
    await ensureScreensSeeded();
    const sid = normalizeScreenId(req.params.screenId);

    if (sid === 'LIVE_TRACKING') {
      return res.status(403).json({
        success: false,
        message: 'Live Order Tracking screen is already restricted.',
      });
    }

    let screen = await ScreenMedia.findOne({ screenId: sid });
    if (!screen) {
      const defaultDef = DEFAULT_SCREENS.find((s) => s.screenId === sid);
      screen = await ScreenMedia.create(defaultDef || {
        screenId: sid,
        screenName: sid.replace(/_/g, ' '),
        allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
        currentMediaType: 'NONE',
        displayMode: 'BOTH',
        isActive: true,
      });
    }

    const targetType = String(req.query.type || req.query.mediaType || 'ALL').toUpperCase();

    if (targetType === 'IMAGE') {
      if (screen.imageUrl) {
        const oldPath = path.join(uploadDir, path.basename(screen.imageUrl));
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (_) {}
        }
      }
      screen.imageUrl = '';
      if (screen.mediaUrl === screen.imageUrl) {
        screen.mediaUrl = screen.lottieUrl || '';
      }
      screen.currentMediaType = screen.lottieUrl ? 'LOTTIE' : 'NONE';
    } else if (targetType === 'LOTTIE') {
      if (screen.lottieUrl) {
        const oldPath = path.join(uploadDir, path.basename(screen.lottieUrl));
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (_) {}
        }
      }
      screen.lottieUrl = '';
      if (screen.lottieConfig) {
        screen.lottieConfig.rawJson = null;
      }
      if (screen.mediaUrl === screen.lottieUrl) {
        screen.mediaUrl = screen.imageUrl || '';
      }
      screen.currentMediaType = screen.imageUrl ? 'IMAGE' : 'NONE';
    } else {
      // Remove ALL
      const filesToDelete = [screen.imageUrl, screen.lottieUrl, screen.mediaUrl].filter(Boolean);
      filesToDelete.forEach((f) => {
        const oldPath = path.join(uploadDir, path.basename(f));
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (_) {}
        }
      });
      screen.imageUrl = '';
      screen.lottieUrl = '';
      screen.mediaUrl = '';
      screen.currentMediaType = 'NONE';
      if (screen.lottieConfig) screen.lottieConfig.rawJson = null;
    }

    screen.version = (screen.version || 1) + 1;
    screen.publishedAt = new Date();
    await screen.save();

    const io = req.app.get('io') || global.io;
    if (io) {
      io.emit('screen_media_updated', screen);
      io.emit(`screen_media_${sid.toLowerCase()}`, screen);
    }

    res.json({ success: true, message: `Media removed successfully for ${screen.screenName}`, screen });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.ensureScreensSeeded = ensureScreensSeeded;

module.exports = router;
