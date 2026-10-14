const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const { upload, compressImage } = require('../middleware/uploadMiddleware');

// Public: Get all active/enabled categories created by Admin
router.get('/', async (req, res) => {
  try {
    const filter = req.query.all === 'true' ? {} : { $or: [{ isActive: true }, { isActive: { $exists: false } }] };
    const categories = await Category.find(filter).sort({ createdAt: -1 });

    res.json({ success: true, categories: categories || [], data: categories || [] });
  } catch (err) {
    res.status(200).json({ success: true, categories: [], data: [] });
  }
});

// Admin: Get ALL categories
router.get('/all', async (req, res) => {
  try {
    const categories = await Category.find({}).sort({ createdAt: -1 });
    res.json({ success: true, categories, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin: Add new category or update if name matches
router.post('/', upload.single('image'), compressImage, async (req, res) => {
  try {
    const { name, description, icon, iconColor, bgColor, startingPrice, estimatedTime, isActive } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Category Name is required' });
    }

    const trimmedName = name.trim();
    const existing = await Category.findOne({ name: trimmedName });

    let imageUrl = undefined;
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    const updateData = {
      name: trimmedName,
      description: description || '',
      icon: icon || 'sparkles-outline',
      iconColor: iconColor || '#2563EB',
      bgColor: bgColor || '#EFF6FF',
      startingPrice: Number(startingPrice) || 199,
      estimatedTime: estimatedTime || '30-45m',
      isActive: isActive !== undefined ? isActive : true,
    };

    if (req.body.subcategories) {
      try {
        const parsed = typeof req.body.subcategories === 'string' ? JSON.parse(req.body.subcategories) : req.body.subcategories;
        if (Array.isArray(parsed)) {
          updateData.subcategories = parsed
            .filter(s => s && s.name && String(s.name).trim())
            .map(s => ({
              name: String(s.name).trim(),
              price: Number(s.price) || 199,
              isActive: s.isActive !== false,
              description: s.description || '',
              icon: s.icon || 'sparkles-outline'
            }));
        }
      } catch (e) {
        console.error('Failed to parse subcategories JSON:', e.message);
      }
    }

    if (imageUrl) {
      updateData.image = imageUrl;
    } else if (req.body.image) {
      updateData.image = req.body.image;
    }

    const category = await Category.findOneAndUpdate(
      { name: trimmedName },
      updateData,
      { new: true, upsert: true }
    );

    const adminController = require('../controllers/adminController');
    const io = req.app.get('io') || global.io || (adminController.getIO ? adminController.getIO() : null);
    if (io) {
      const eventName = existing ? 'category_updated' : 'category_created';
      io.emit(eventName, category);
      io.emit('category_change', { type: eventName, category });
      io.emit('categories_updated', { type: eventName, category });
      console.log(`📡 [Socket Emit] ${eventName} broadcasted for category: ${category.name}`);
    }

    res.json({ success: true, category });
  } catch (err) {
    console.error('Error saving category:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
});

// Admin: Update / Toggle Category (Enable/Disable/Edit)
router.put('/:id', upload.single('image'), compressImage, async (req, res) => {
  try {
    const updateData = { ...req.body };
    
    // If updating isActive explicitly, it might be passed as a string from FormData
    if (updateData.isActive === 'true') updateData.isActive = true;
    if (updateData.isActive === 'false') updateData.isActive = false;

    if (req.body.subcategories) {
      try {
        const parsed = typeof req.body.subcategories === 'string' ? JSON.parse(req.body.subcategories) : req.body.subcategories;
        if (Array.isArray(parsed)) {
          updateData.subcategories = parsed
            .filter(s => s && s.name && String(s.name).trim())
            .map(s => ({
              name: String(s.name).trim(),
              price: Number(s.price) || 199,
              isActive: s.isActive !== false,
              description: s.description || '',
              icon: s.icon || 'sparkles-outline'
            }));
        }
      } catch (e) {
        console.error('Failed to parse subcategories JSON:', e.message);
      }
    }

    if (req.file) {
      updateData.image = `/uploads/${req.file.filename}`;
    } else if (req.body.image) {
      updateData.image = req.body.image;
    }

    const category = await Category.findByIdAndUpdate(req.params.id, updateData, { new: true });
    
    const adminController = require('../controllers/adminController');
    const io = req.app.get('io') || global.io || (adminController.getIO ? adminController.getIO() : null);
    if (io && category) {
      const eventName = req.body.isActive === true ? 'category_enabled' : req.body.isActive === false ? 'category_disabled' : 'category_updated';
      io.emit(eventName, category);
      io.emit('category_updated', category);
      io.emit('category_change', { type: eventName, category });
      io.emit('categories_updated', { type: eventName, category });
      console.log(`📡 [Socket Emit] ${eventName} broadcasted for category: ${category.name}`);
    }

    res.json({ success: true, category });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Admin: Delete category
router.delete('/:id', async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    
    const adminController = require('../controllers/adminController');
    const io = req.app.get('io') || global.io || (adminController.getIO ? adminController.getIO() : null);
    if (io) {
      const delPayload = { 
        _id: req.params.id, 
        id: req.params.id, 
        categoryId: req.params.id,
        name: category ? category.name : '',
        key: category ? category.name.toLowerCase().replace(/[^a-z0-9]/g, '_') : ''
      };
      io.emit('category_deleted', delPayload);
      io.emit('category_disabled', delPayload);
      io.emit('category_change', { type: 'category_deleted', categoryId: req.params.id, category });
      io.emit('categories_updated', { type: 'delete', categoryId: req.params.id, category });
      console.log(`📡 [Socket Emit] category_deleted broadcasted for category ID: ${req.params.id}`);
    }

    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});
// Get Fashion Category and Subcategories
router.get('/fashion', async (req, res) => {
  try {
    const category = await Category.findOne({ name: { $regex: 'fashion', $options: 'i' } });
    if (!category) {
      return res.status(404).json({ success: false, message: 'Fashion category not found' });
    }
    res.json({ success: true, category, subcategories: category.subcategories || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get Any Category and Subcategories by ID or Name (Food, Kirana, Beauty, Electronics, etc.)
router.get('/:id', async (req, res) => {
  try {
    const param = req.params.id;
    let category = null;
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(param)) {
      category = await Category.findById(param);
    }
    if (!category) {
      category = await Category.findOne({ name: { $regex: `^${param}$`, $options: 'i' } });
    }
    if (!category) {
      category = await Category.findOne({ name: { $regex: param, $options: 'i' } });
    }
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    const activeSubcategories = (category.subcategories || []).filter(s => s.isActive !== false);
    res.json({
      success: true,
      category,
      subcategories: activeSubcategories,
      allSubcategories: category.subcategories || [],
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin: Add Subcategory
router.post('/:id/subcategories', async (req, res) => {
  try {
    const { name, price, description, icon, isActive } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Subcategory name is required' });
    }
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    const newSub = {
      name: name.trim(),
      price: Number(price) || 199,
      description: description || '',
      icon: icon || 'sparkles-outline',
      isActive: isActive !== false,
    };
    category.subcategories.push(newSub);
    await category.save();

    const io = req.app.get('io') || global.io;
    if (io) {
      io.emit('category_updated', category);
      io.emit('subcategories_updated', { categoryId: category._id, subcategories: category.subcategories });
      io.emit('fashion_subcategories_updated', { subcategories: category.subcategories });
    }

    res.status(201).json({ success: true, category, subcategory: category.subcategories[category.subcategories.length - 1] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin: Update Subcategory
router.put('/:id/subcategories/:subId', async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    const sub = category.subcategories.id(req.params.subId);
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }
    if (req.body.name) sub.name = req.body.name.trim();
    if (req.body.price !== undefined) sub.price = Number(req.body.price);
    if (req.body.description !== undefined) sub.description = req.body.description;
    if (req.body.icon) sub.icon = req.body.icon;
    if (req.body.isActive !== undefined) sub.isActive = req.body.isActive;

    await category.save();

    const io = req.app.get('io') || global.io;
    if (io) {
      io.emit('category_updated', category);
      io.emit('subcategories_updated', { categoryId: category._id, subcategories: category.subcategories });
      io.emit('fashion_subcategories_updated', { subcategories: category.subcategories });
    }

    res.json({ success: true, category, subcategory: sub });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin: Delete Subcategory
router.delete('/:id/subcategories/:subId', async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    category.subcategories.pull({ _id: req.params.subId });
    await category.save();

    const io = req.app.get('io') || global.io;
    if (io) {
      io.emit('category_updated', category);
      io.emit('subcategories_updated', { categoryId: category._id, subcategories: category.subcategories });
      io.emit('fashion_subcategories_updated', { subcategories: category.subcategories });
    }

    res.json({ success: true, category, message: 'Subcategory deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
