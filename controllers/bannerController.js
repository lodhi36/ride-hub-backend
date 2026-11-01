const Banner = require('../models/Banner');
const ScreenMedia = require('../models/ScreenMedia');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const uploadDir = path.join(__dirname, '../uploads');

const normalizeTarget = (target) => {
  if (!target) return 'USER';
  const t = String(target).trim().toUpperCase();
  if (t === 'CUSTOMER' || t === 'USER' || t === 'CUSTOMERS' || t === 'USERS') return 'USER';
  if (t === 'RIDER' || t === 'RIDERS' || t === 'DELIVERY' || t === 'DELIVERY_PARTNER' || t === 'DRIVER') return 'RIDER';
  if (t === 'SUPPLIER' || t === 'SUPPLIERS' || t === 'RESTAURANT' || t === 'RESTAURANTS' || t === 'STORE' || t === 'STORES' || t === 'MERCHANT' || t === 'SELLER') return 'SUPPLIER';
  if (t === 'FASHION' || t === 'SUBCATEGORY' || t === 'SUBCATEGORIES') return 'FASHION';
  if (t === 'FOOD') return 'FOOD';
  if (t === 'TOYS' || t === 'TOY') return 'TOYS';
  if (t === 'VEGETABLES' || t === 'VEGETABLE' || t === 'VEG') return 'VEGETABLES';
  if (t === 'BEAUTY') return 'BEAUTY';
  if (t === 'KIRANA' || t === 'GROCERY') return 'KIRANA';
  if (t === 'SPLASH' || t === 'SPLASH_SCREEN') return 'SPLASH';
  if (t === 'ROLE_SELECTION' || t === 'ROLE') return 'ROLE_SELECTION';
  return t;
};

// Map ScreenMedia screenId to Banner target
const screenIdToTarget = (screenId) => {
  const sid = String(screenId || '').toUpperCase();
  if (sid === 'CUSTOMER_HOME') return 'USER';
  if (sid === 'FOOD_BANNER') return 'FOOD';
  if (sid === 'FASHION_BANNER') return 'FASHION';
  if (sid === 'TOYS_BANNER') return 'TOYS';
  if (sid === 'VEGETABLES_BANNER') return 'VEGETABLES';
  if (sid === 'BEAUTY_BANNER') return 'BEAUTY';
  if (sid === 'KIRANA_BANNER') return 'KIRANA';
  if (sid === 'RIDER_HOME') return 'RIDER';
  if (sid === 'SUPPLIER_HOME') return 'SUPPLIER';
  if (sid === 'SPLASH_SCREEN') return 'SPLASH';
  if (sid === 'ROLE_SELECTION') return 'ROLE_SELECTION';
  return sid;
};

// Map Banner target to ScreenMedia screenId
const targetToScreenId = (target) => {
  const t = normalizeTarget(target);
  if (t === 'USER') return 'CUSTOMER_HOME';
  if (t === 'FOOD') return 'FOOD_BANNER';
  if (t === 'FASHION') return 'FASHION_BANNER';
  if (t === 'TOYS') return 'TOYS_BANNER';
  if (t === 'VEGETABLES') return 'VEGETABLES_BANNER';
  if (t === 'BEAUTY') return 'BEAUTY_BANNER';
  if (t === 'KIRANA') return 'KIRANA_BANNER';
  if (t === 'RIDER') return 'RIDER_HOME';
  if (t === 'SUPPLIER') return 'SUPPLIER_HOME';
  if (t === 'SPLASH') return 'SPLASH_SCREEN';
  if (t === 'ROLE_SELECTION') return 'ROLE_SELECTION';
  return null;
};

// Auto-sync ScreenMedia images into Banner collection so all images appear in Admin
const syncScreenMediaToBanners = async () => {
  try {
    const screens = await ScreenMedia.find({}).lean();

    for (const scr of screens) {
      const target = screenIdToTarget(scr.screenId);
      if (!target) continue;

      // If screen has no image or currentMediaType is explicitly NONE / inactive
      if (
        scr.currentMediaType === 'NONE' ||
        scr.isActive === false ||
        (!scr.imageUrl && !scr.mediaUrl)
      ) {
        // Ensure no orphaned active banners exist in Banner collection for this screen target
        await Banner.deleteMany({ target: { $regex: new RegExp(`^${target}$`, 'i') } });
        continue;
      }

      const img = scr.imageUrl || scr.mediaUrl;
      if (!img || img.endsWith('.json') || img.endsWith('.lottie')) continue;

      // Verify image exists on disk before syncing
      const fn = path.basename(img);
      const existsOnDisk = fs.existsSync(path.join(uploadDir, fn));
      if (!img.startsWith('http') && !existsOnDisk) continue;

      const existing = await Banner.findOne({
        $or: [
          { imageUrl: img },
          { imageUrl: img.startsWith('/') ? img : `/${img}` }
        ]
      });

      if (!existing) {
        await Banner.create({
          imageUrl: img,
          target,
          status: scr.isActive !== false ? 'Active' : 'Inactive',
          order: 0,
          title: scr.title || scr.screenName || `${target} Banner`
        });
        console.log(`[BANNER_SYNC] Synced ${scr.screenId} image (${img}) into Banner collection`);
      }
    }
  } catch (err) {
    console.warn('[BANNER_SYNC] Note syncing screen media:', err.message);
  }
};

exports.uploadBanner = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }

    // Check file type
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const mimetype = (req.file.mimetype || '').toLowerCase();
    const isImage = mimetype.startsWith('image/') || /jpeg|jpg|png|webp|jfif|avif|heic|heif|gif|bmp|svg/i.test(ext) || /jpeg|jpg|png|webp|jfif|avif|heic|heif|gif|bmp|svg/i.test(mimetype);
    if (!isImage) {
      return res.status(400).json({ success: false, message: 'Only image formats (JPG, PNG, WEBP, JFIF, HEIC, etc.) are allowed' });
    }

    const rawTarget = req.body.target || 'USER';
    const target = normalizeTarget(rawTarget);

    // Target query matcher (supports 'USER'/'SUPPLIER'/'FASHION'/'FOOD'/'TOYS'/'VEGETABLES'/'BEAUTY'/'KIRANA' and legacy)
    const targetMatches = target === 'USER' 
      ? ['USER', 'Customer', 'User'] 
      : target === 'SUPPLIER' 
      ? ['SUPPLIER', 'Supplier', 'Restaurant'] 
      : target === 'FASHION'
      ? ['FASHION', 'Fashion', 'SUBCATEGORY', 'Subcategory']
      : target === 'FOOD'
      ? ['FOOD', 'Food']
      : target === 'TOYS'
      ? ['TOYS', 'Toys', 'TOY', 'Toy']
      : target === 'VEGETABLES'
      ? ['VEGETABLES', 'Vegetables', 'VEG', 'Veg']
      : target === 'BEAUTY'
      ? ['BEAUTY', 'Beauty']
      : target === 'KIRANA'
      ? ['KIRANA', 'Kirana', 'GROCERY', 'Grocery']
      : target === 'RIDER'
      ? ['RIDER', 'Rider']
      : [target];

    // Check max 15 banners per target
    const count = await Banner.countDocuments({ target: { $in: targetMatches } });
    if (count >= 15) {
      return res.status(400).json({ success: false, message: `Maximum 15 banners allowed for ${target}` });
    }

    // Ensure uploads folder exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const filename = `banner-${target.toLowerCase()}-${uniqueSuffix}.webp`;
    const outputPath = path.join(uploadDir, filename);

    // Automatically optimize and compress with Sharp (max 1200px width, WebP quality 85)
    await sharp(req.file.buffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 85, effort: 4 })
      .toFile(outputPath);

    const imageUrl = `/uploads/${filename}`;
    
    const banner = await Banner.create({
      imageUrl,
      target,
      status: 'Active',
      order: req.body.order !== undefined ? Number(req.body.order) : count
    });

    console.log(`[BANNER_UPLOADED] target: ${target}, url: ${imageUrl}, order: ${banner.order}`);

    // If target maps to ScreenMedia, update ScreenMedia as well
    const screenId = targetToScreenId(target);
    if (screenId) {
      try {
        let scr = await ScreenMedia.findOne({ screenId });
        if (scr) {
          scr.imageUrl = imageUrl;
          scr.mediaUrl = imageUrl;
          scr.isActive = true;
          scr.publishedAt = new Date();
          await scr.save();
        }
      } catch (scrErr) {
        console.warn('[BANNER_UPLOAD] Note updating screen media:', scrErr.message);
      }
    }

    const io = req.app.get('io') || global.io;
    if (io) {
      io.emit('banner_created', banner);
      io.emit('banner_updated', banner);
      io.emit('banner_change', { type: 'create', banner });
      if (screenId) io.emit(`screen_media_${screenId.toLowerCase()}`, { screenId, imageUrl });
    }

    res.status(201).json({ success: true, data: banner });
  } catch (error) {
    console.error('Error in uploadBanner:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let isInitialMediaSynced = false;

exports.getBanners = async (req, res) => {
  try {
    // Auto-sync ScreenMedia images once on initial request in background
    if (!isInitialMediaSynced) {
      isInitialMediaSynced = true;
      syncScreenMediaToBanners().catch(() => {});
    }

    const query = {};
    if (req.query.target && req.query.target.toUpperCase() !== 'ALL') {
      const norm = normalizeTarget(req.query.target);
      if (norm === 'USER') {
        query.$or = [{ target: { $in: ['USER', 'Customer', 'User', 'CUSTOMER'] } }, { target: { $exists: false } }, { target: null }, { target: '' }];
      } else if (norm === 'SUPPLIER') {
        query.target = { $in: ['SUPPLIER', 'Supplier', 'Restaurant', 'RESTAURANT', 'Store', 'STORE', 'Merchant', 'MERCHANT'] };
      } else if (norm === 'RIDER') {
        query.target = { $in: ['RIDER', 'Rider', 'DELIVERY', 'Delivery'] };
      } else if (norm === 'FASHION') {
        query.target = { $in: ['FASHION', 'Fashion', 'SUBCATEGORY', 'Subcategory'] };
      } else if (norm === 'FOOD') {
        query.target = { $in: ['FOOD', 'Food'] };
      } else if (norm === 'TOYS') {
        query.target = { $in: ['TOYS', 'Toys', 'TOY', 'Toy'] };
      } else if (norm === 'VEGETABLES') {
        query.target = { $in: ['VEGETABLES', 'Vegetables', 'VEG', 'Veg'] };
      } else if (norm === 'BEAUTY') {
        query.target = { $in: ['BEAUTY', 'Beauty'] };
      } else if (norm === 'KIRANA') {
        query.target = { $in: ['KIRANA', 'Kirana', 'GROCERY', 'Grocery'] };
      } else {
        query.target = norm;
      }
    }
    if (req.query.status) {
      query.status = req.query.status;
    }

    let banners = await Banner.find(query).sort({ order: 1, createdAt: -1 });

    res.status(200).json({ success: true, data: banners || [] });
  } catch (error) {
    console.error('Error in getBanners:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateBanner = async (req, res) => {
  try {
    const banner = await Banner.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!banner) return res.status(404).json({ success: false, message: 'Banner not found' });
    
    // If status changed, synchronize with ScreenMedia
    if (req.body.status && banner.imageUrl) {
      try {
        await ScreenMedia.updateMany(
          { $or: [{ imageUrl: banner.imageUrl }, { mediaUrl: banner.imageUrl }] },
          { isActive: req.body.status === 'Active' }
        );
      } catch (_) {}
    }

    const io = req.app.get('io') || global.io;
    if (io) {
      io.emit('banner_updated', banner);
      io.emit('banner_change', { type: 'update', banner });
    }

    res.status(200).json({ success: true, data: banner });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteBanner = async (req, res) => {
  try {
    const banner = await Banner.findByIdAndDelete(req.params.id);
    if (!banner) return res.status(404).json({ success: false, message: 'Banner not found' });
    
    // Clear in ScreenMedia if mapped
    if (banner.imageUrl) {
      try {
        await ScreenMedia.updateMany(
          { $or: [{ imageUrl: banner.imageUrl }, { mediaUrl: banner.imageUrl }] },
          { imageUrl: '', mediaUrl: '', isActive: false }
        );
      } catch (_) {}

      // Attempt to delete physical file safely if no other banners share this image
      try {
        const remainingCount = await Banner.countDocuments({ imageUrl: banner.imageUrl });
        if (remainingCount === 0) {
          const filePath = path.join(uploadDir, path.basename(banner.imageUrl));
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[FILE_DELETED] Removed unreferenced file ${filePath}`);
          }
        }
      } catch (fErr) {
        console.warn('[FILE_DELETE] Note unlinking file:', fErr.message);
      }
    }

    const io = req.app.get('io') || global.io;
    if (io) {
      const bannerId = String(banner._id || req.params.id);
      io.emit('banner_deleted', { id: bannerId, _id: bannerId, target: banner.target });
      io.emit('banner_updated', { id: bannerId, _id: bannerId, target: banner.target });
      io.emit('banner_change', { type: 'delete', id: bannerId, target: banner.target });
      io.emit('BANNERS_UPDATED', { target: banner.target });
      const sid = targetToScreenId(banner.target);
      if (sid) io.emit(`screen_media_${sid.toLowerCase()}`, { screenId: sid, imageUrl: '' });
    }

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
