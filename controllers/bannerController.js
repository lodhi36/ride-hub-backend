const Banner = require('../models/Banner');
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
  return t;
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

    // Check max 5 banners per target
    const count = await Banner.countDocuments({ target: { $in: targetMatches } });
    if (count >= 5) {
      return res.status(400).json({ success: false, message: `Maximum 5 banners allowed for ${target}` });
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

    const io = req.app.get('io') || global.io;
    if (io) {
      io.emit('banner_created', banner);
      io.emit('banner_updated', banner);
      io.emit('banner_change', { type: 'create', banner });
    }

    res.status(201).json({ success: true, data: banner });
  } catch (error) {
    console.error('Error in uploadBanner:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getBanners = async (req, res) => {
  try {
    const query = {};
    if (req.query.target) {
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

    const banners = await Banner.find(query).sort({ order: 1, createdAt: -1 });
    res.status(200).json({ success: true, data: banners });
  } catch (error) {
    console.error('Error in getBanners:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateBanner = async (req, res) => {
  try {
    const banner = await Banner.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!banner) return res.status(404).json({ success: false, message: 'Banner not found' });
    
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
    
    // Attempt to delete file
    const filePath = path.join(uploadDir, path.basename(banner.imageUrl));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const io = req.app.get('io') || global.io;
    if (io) {
      io.emit('banner_deleted', { id: req.params.id, target: banner.target });
      io.emit('banner_updated', { id: req.params.id, target: banner.target });
      io.emit('banner_change', { type: 'delete', id: req.params.id });
    }

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
