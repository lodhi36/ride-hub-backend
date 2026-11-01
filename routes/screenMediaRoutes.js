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
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB limit for rich animations
});

// Helper: Extract inner animation.json from a .lottie (zip) file
const extractJsonFromDotLottie = (buffer) => {
  let offset = 0;
  const zlib = require('zlib');
  while (offset < buffer.length - 30) {
    if (buffer.readUInt32LE(offset) === 0x04034b50) {
      const compressionMethod = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const fileNameLen = buffer.readUInt16LE(offset + 26);
      const extraFieldLen = buffer.readUInt16LE(offset + 28);
      const fileName = buffer.toString('utf8', offset + 30, offset + 30 + fileNameLen);
      const fileDataOffset = offset + 30 + fileNameLen + extraFieldLen;
      const fileData = buffer.subarray(fileDataOffset, fileDataOffset + compressedSize);

      if (fileName.endsWith('.json') && !fileName.toLowerCase().includes('manifest')) {
        let uncompressed = null;
        if (compressionMethod === 0) {
          uncompressed = fileData;
        } else if (compressionMethod === 8) {
          uncompressed = zlib.inflateRawSync(fileData);
        }
        if (uncompressed) {
          const json = JSON.parse(uncompressed.toString('utf8'));
          return json;
        }
      }
      offset = fileDataOffset + compressedSize;
    } else {
      offset++;
    }
  }
  return null;
};

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
    allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
    currentMediaType: 'BOTH',
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
    allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
    currentMediaType: 'BOTH',
    title: 'Delivery Partner Dashboard Media',
    description: 'Incentive banners and announcement posters for delivery riders',
    isRestricted: false,
    isActive: true,
  },
  {
    screenId: 'SUPPLIER_HOME',
    screenName: 'Supplier Home Screen',
    allowedMediaTypes: ['IMAGE', 'BANNER', 'LOTTIE'],
    currentMediaType: 'BOTH',
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

// Helper: Ensure defaults are seeded (cached in memory for ultra-fast response)
let isSeeded = false;
const ensureScreensSeeded = async (force = false) => {
  if (isSeeded && !force) return;
  try {
    const existing = await ScreenMedia.find({}, { screenId: 1 }).lean();
    const existingSet = new Set(existing.map((e) => e.screenId));
    const toInsert = DEFAULT_SCREENS.filter((s) => !existingSet.has(s.screenId));
    if (toInsert.length > 0) {
      await ScreenMedia.insertMany(toInsert, { ordered: false }).catch(() => {});
    }
    isSeeded = true;
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
    const screens = await ScreenMedia.find({}, { 'lottieConfig.rawJson': 0 }).sort({ isRestricted: 1, createdAt: 1 }).lean();
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
    let screen = await ScreenMedia.findOne({ screenId: sid }, { 'lottieConfig.rawJson': 0 });
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

    let screen = await ScreenMedia.findOne({ screenId: sid }, { 'lottieConfig.rawJson': 0 });
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

    // Check if buffer is a zip (.lottie) archive by magic bytes (PK / 0x04034b50)
    const isZipArchive = req.file.buffer && req.file.buffer.length > 4 && req.file.buffer.readUInt32LE(0) === 0x04034b50;
    const isLottie = ext === '.json' || ext === '.lottie' || mimetype.includes('json') || isZipArchive;
    const isImage = !isLottie && (/jpeg|jpg|png|webp|jfif|avif|heic|gif|bmp/i.test(ext) || mimetype.startsWith('image/'));

    if (!isLottie && !isImage) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file format. Supported: PNG, JPG, JPEG, WEBP, AVIF, JSON (Lottie), and .lottie files.',
      });
    }

    let lottieConfig = screen.lottieConfig || { speed: 1.0, loop: true, autoplay: true, rawJson: null };
    let mediaType = isLottie ? 'LOTTIE' : 'IMAGE';
    let fileBufferToSave = req.file.buffer;
    let fileExtToSave = ext;

    if (isLottie) {
      fileExtToSave = '.json';
      if (isZipArchive || ext === '.lottie') {
        // Extract animation JSON from .lottie zip archive
        try {
          const extractedJson = extractJsonFromDotLottie(req.file.buffer);
          if (!extractedJson) {
            throw new Error('No animation JSON found inside .lottie package');
          }
          fileBufferToSave = Buffer.from(JSON.stringify(extractedJson), 'utf8');
        } catch (unzipErr) {
          return res.status(400).json({
            success: false,
            message: `Invalid .lottie file: ${unzipErr.message}. Please upload a valid Lottie animation.`,
          });
        }
      } else {
        // Validate JSON structure
        try {
          const jsonContent = JSON.parse(req.file.buffer.toString('utf8'));
          if (typeof jsonContent !== 'object' || jsonContent === null) {
            throw new Error('Root JSON structure must be an object');
          }
        } catch (jsonErr) {
          return res.status(400).json({
            success: false,
            message: `Invalid Lottie JSON: ${jsonErr.message}. Please upload a valid Lottie animation file.`,
          });
        }
      }
      // CRITICAL: Never store massive multi-megabyte JSON in MongoDB document!
      // The animation is saved to disk as a static JSON file in uploads/ and fetched by clients via lottieUrl.
      lottieConfig.rawJson = null;
    }

    // Save file to disk
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const filename = `screen-${sid.toLowerCase()}-${uniqueSuffix}${fileExtToSave}`;
    const destinationPath = path.join(uploadDir, filename);
    fs.writeFileSync(destinationPath, fileBufferToSave);

    const mediaUrl = `/uploads/${filename}`;
    const nextVersion = (screen.version || 1) + 1;
    const oldImageUrl = screen.imageUrl;

    if (mediaType === 'IMAGE') {
      // Remove previous image file from disk to prevent storage leaks and guarantee fresh replace
      if (oldImageUrl && oldImageUrl !== mediaUrl) {
        try {
          const oldFile = path.basename(oldImageUrl.split('?')[0]);
          const oldPath = path.join(uploadDir, oldFile);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        } catch (_) {}
      }
      screen.imageUrl = mediaUrl;
      screen.mediaUrl = mediaUrl;
      if (screen.lottieUrl) {
        screen.currentMediaType = 'BOTH';
      } else {
        screen.currentMediaType = 'IMAGE';
      }
    } else if (mediaType === 'LOTTIE') {
      const oldLottieUrl = screen.lottieUrl;
      if (oldLottieUrl && oldLottieUrl !== mediaUrl) {
        try {
          const oldFile = path.basename(oldLottieUrl.split('?')[0]);
          const oldPath = path.join(uploadDir, oldFile);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        } catch (_) {}
      }
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

    // Synchronize uploaded image with Banner collection so all images appear in Admin Banners / Media manager
    if (mediaType === 'IMAGE') {
      try {
        const Banner = require('../models/Banner');
        const targetMap = {
          'CUSTOMER_HOME': 'USER',
          'FOOD_BANNER': 'FOOD',
          'FASHION_BANNER': 'FASHION',
          'TOYS_BANNER': 'TOYS',
          'VEGETABLES_BANNER': 'VEGETABLES',
          'BEAUTY_BANNER': 'BEAUTY',
          'KIRANA_BANNER': 'KIRANA',
          'RIDER_HOME': 'RIDER',
          'SUPPLIER_HOME': 'SUPPLIER',
          'SPLASH_SCREEN': 'SPLASH',
          'ROLE_SELECTION': 'ROLE_SELECTION',
        };
        const bannerTarget = targetMap[sid] || 'USER';

        let banner = await Banner.findOne({
          $or: [
            { imageUrl: mediaUrl },
            { imageUrl: mediaUrl.startsWith('/') ? mediaUrl : `/${mediaUrl}` }
          ]
        });

        if (!banner) {
          banner = await Banner.create({
            imageUrl: mediaUrl,
            target: bannerTarget,
            status: 'Active',
            order: 0,
            title: screen.title || `${screen.screenName || bannerTarget} Spotlight`,
          });
        } else {
          banner.status = 'Active';
          banner.target = bannerTarget;
          await banner.save();
        }

        const io = req.app.get('io') || global.io;
        if (io) {
          io.emit('banner_created', banner);
          io.emit('banner_updated', banner);
          io.emit('banner_change', { type: 'create', banner });
        }
      } catch (err) {
        console.warn('Banner sync note:', err.message);
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

    let screen = await ScreenMedia.findOne({ screenId: sid }, { 'lottieConfig.rawJson': 0 });
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
    let screen = await ScreenMedia.findOne({ screenId: sid }, { 'lottieConfig.rawJson': 0 });
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

    let screen = await ScreenMedia.findOne({ screenId: sid }, { 'lottieConfig.rawJson': 0 });
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

    // Also remove matching Banner from Banner collection and emit socket for real-time deletion
    if (targetType === 'IMAGE' || targetType === 'ALL') {
      try {
        const Banner = require('../models/Banner');
        const imgToDelete = screen.imageUrl || screen.mediaUrl;
        if (imgToDelete) {
          const oldBanners = await Banner.find({
            $or: [
              { imageUrl: imgToDelete },
              { imageUrl: imgToDelete.startsWith('/') ? imgToDelete : `/${imgToDelete}` }
            ]
          }).lean();

          await Banner.deleteMany({
            $or: [
              { imageUrl: imgToDelete },
              { imageUrl: imgToDelete.startsWith('/') ? imgToDelete : `/${imgToDelete}` }
            ]
          });

          const io = req.app.get('io') || global.io;
          if (io && oldBanners.length > 0) {
            oldBanners.forEach((b) => {
              io.emit('banner_deleted', b._id);
              io.emit('banner_change', { type: 'delete', id: b._id, banner: b });
            });
            console.log(`📡 [Socket Emit] banner_deleted broadcasted for ${oldBanners.length} banners`);
          }
        }
      } catch (bErr) {
        console.warn('Note deleting linked banner:', bErr.message);
      }
    }

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
