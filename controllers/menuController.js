const mongoose = require('mongoose');
const MenuItem = require('../models/MenuItem');
const RestaurantCategory = require('../models/RestaurantCategory');
const User = require('../models/User');

const DEFAULT_CATEGORIES_BY_TYPE = {
  RESTAURANT: ['Starters', 'Main Course', 'Breads', 'Beverages', 'Desserts'],
  BEAUTY: ['Hair Care', 'Skin Care', 'Facial & Cleanup', 'Makeup', 'Spa & Wellness'],
  GROCERY: ['Daily Essentials', 'Atta, Rice & Dals', 'Dairy & Eggs', 'Snacks & Beverages', 'Personal Care'],
  VEGETABLES: ['Fresh Vegetables', 'Green Leafy', 'Potatoes & Onions', 'Exotic Veggies', 'Seasonal Veg'],
  FRUITS: ['Fresh Fruits', 'Seasonal Fruits', 'Exotic Fruits', 'Citrus & Berries', 'Cut Fruits & Combos'],
  NAMKEEN: ['Sev & Bhujia', 'Mixture & Farsan', 'Chips & Wafers', 'Roasted Snacks', 'Mathri & Khakhra'],
  OIL_FOOD: ['Cooking Oil & Ghee', 'Mustard & Refined Oil', 'Flours & Grains', 'Spices & Masalas', 'Packaged Staples'],
  STATIONERY: ['Notebooks & Registers', 'Pens, Pencils & Art', 'Office Supplies', 'Files & Folders', 'School Essentials'],
  FASHION: ['Men', 'Women', 'Kids', 'Accessories', 'Footwear'],
  TOYS: ['Action Figures', 'Board Games', 'Educational Toys', 'Soft Toys', 'Outdoor & Sports'],
  BAKERY: ['Cakes & Pastries', 'Cookies & Biscuits', 'Breads & Buns', 'Sweets & Mithai', 'Snacks & Beverages'],
  ELECTRONICS: ['Mobile Accessories', 'Audio & Headphones', 'Cables & Chargers', 'Gadgets', 'Repairs'],
  SERVICES: ['Deep Cleaning', 'Kitchen & Bathroom', 'Home Repairs', 'Sanitization', 'Express Service'],
  PHARMACY: ['Medicines', 'First Aid', 'Personal Hygiene', 'Baby Care', 'Vitamins & Supplements'],
  OTHER: ['General Items', 'Featured', 'Best Sellers', 'New Arrivals'],
};

// @desc    Get custom categories for a supplier / restaurant
// @route   GET /api/menu/categories/:restaurantId
// @access  Public / Private
const getCategories = async (req, res) => {
  try {
    const restaurantId =
      req.params.restaurantId || req.query.restaurantId || (req.user ? (req.user._id || req.user.id) : null);

    if (!restaurantId || restaurantId === 'undefined' || restaurantId === 'null') {
      return res.json({ success: true, count: 0, categories: [] });
    }

    let partnerType = 'RESTAURANT';
    if (mongoose.Types.ObjectId.isValid(restaurantId)) {
      const targetUser = await User.findById(restaurantId);
      if (targetUser) {
        const bt = (targetUser.business_type || targetUser.businessType || '').toLowerCase().trim();
        const rawCat = `${targetUser.partnerType || ''} ${targetUser.businessCategoryName || ''} ${targetUser.categoryName || ''} ${bt}`.toLowerCase();
        
        if (bt === 'beauty' || rawCat.includes('beauty') || rawCat.includes('salon') || rawCat.includes('cosmetic') || rawCat.includes('spa')) {
          partnerType = 'BEAUTY';
        } else if (bt === 'grocery' || rawCat.includes('grocery') || rawCat.includes('kirana') || rawCat.includes('mart') || rawCat.includes('supermarket')) {
          partnerType = 'GROCERY';
        } else if (bt === 'vegetables' || (rawCat.includes('veg') && !rawCat.includes('fruit')) || rawCat.includes('sabji')) {
          partnerType = 'VEGETABLES';
        } else if (bt === 'fruits' || rawCat.includes('fruit') || rawCat.includes('fal')) {
          partnerType = 'FRUITS';
        } else if (bt === 'namkeen' || rawCat.includes('namkeen') || rawCat.includes('snack')) {
          partnerType = 'NAMKEEN';
        } else if (bt === 'oil_food' || rawCat.includes('oil') || rawCat.includes('food product')) {
          partnerType = 'OIL_FOOD';
        } else if (bt === 'stationery' || rawCat.includes('stationery') || rawCat.includes('stationary') || rawCat.includes('book') || rawCat.includes('pen') || rawCat.includes('office')) {
          partnerType = 'STATIONERY';
        } else if (bt === 'fashion' || rawCat.includes('fashion') || rawCat.includes('cloth') || rawCat.includes('garment') || rawCat.includes('apparel')) {
          partnerType = 'FASHION';
        } else if (rawCat.includes('toy') || rawCat.includes('game') || rawCat.includes('kids') || rawCat.includes('baby')) {
          partnerType = 'TOYS';
        } else if (rawCat.includes('bakery') || rawCat.includes('cake') || rawCat.includes('sweet') || rawCat.includes('mithai')) {
          partnerType = 'BAKERY';
        } else if (rawCat.includes('electr') || rawCat.includes('gadget') || rawCat.includes('appliances')) {
          partnerType = 'ELECTRONICS';
        } else if (rawCat.includes('clean') || rawCat.includes('service')) {
          partnerType = 'SERVICES';
        } else if (rawCat.includes('pharm') || rawCat.includes('medic')) {
          partnerType = 'PHARMACY';
        } else if (bt === 'restaurant' || rawCat.includes('food') || rawCat.includes('restaurant') || rawCat.includes('cafe') || rawCat.includes('kitchen')) {
          partnerType = 'RESTAURANT';
        } else if (targetUser.partnerType) {
          partnerType = targetUser.partnerType.toUpperCase();
        } else {
          partnerType = 'OTHER';
        }
      }
    }

    let categories = await RestaurantCategory.find({ restaurantId }).sort({ createdAt: 1 });

    // If no custom categories exist yet, populate sensible defaults for this supplier's category
    if (categories.length === 0) {
      const defaults = DEFAULT_CATEGORIES_BY_TYPE[partnerType] || DEFAULT_CATEGORIES_BY_TYPE.OTHER;
      const defaultDocs = defaults.map((catName) => ({
        restaurantId,
        name: catName,
      }));
      try {
        categories = await RestaurantCategory.insertMany(defaultDocs);
      } catch (e) {
        categories = await RestaurantCategory.find({ restaurantId });
      }
    }

    // Include any distinct categories that exist on MenuItems for this supplier
    try {
      const itemCats = await MenuItem.distinct('category', { restaurantId });
      const existingNames = new Set(categories.map((c) => (c.name || '').toLowerCase()));
      for (const ic of itemCats) {
        if (ic && typeof ic === 'string' && ic.trim() && !existingNames.has(ic.trim().toLowerCase())) {
          try {
            const addedCat = await RestaurantCategory.create({ restaurantId, name: ic.trim() });
            categories.push(addedCat);
            existingNames.add(ic.trim().toLowerCase());
          } catch (e) {}
        }
      }
    } catch (e) {}

    res.json({ success: true, count: categories.length, categories });
  } catch (error) {
    console.error('[GET CATEGORIES ERROR]', error);
    res.json({ success: true, count: 0, categories: [] });
  }
};

// @desc    Add new category for a supplier / restaurant
// @route   POST /api/menu/categories
// @access  Private / Supplier / Restaurant
const addCategory = async (req, res) => {
  try {
    const restaurantId = req.user ? (req.user._id || req.user.id) : req.body.restaurantId;
    const { name } = req.body;

    if (!restaurantId || !name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Supplier ID and Category Name are required.' });
    }

    const cleanName = name.trim();

    // Check if category already exists for this supplier (case-insensitive)
    const existing = await RestaurantCategory.findOne({
      restaurantId,
      name: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    });
    if (existing) {
      return res.status(200).json({ success: true, category: existing, message: 'Category already exists.' });
    }

    const newCat = new RestaurantCategory({
      restaurantId,
      name: cleanName,
    });

    await newCat.save();
    console.log(`[CATEGORY ADD] Created category "${cleanName}" for supplier ${restaurantId}`);

    const io = req.app.get('io');
    if (io) {
      io.emit('MENU_CATEGORY_UPDATED', { restaurantId, category: newCat, action: 'add' });
      io.emit('MENU_UPDATED', { restaurantId, action: 'category_add', category: newCat });
      io.emit('RESTAURANT_UPDATED', { restaurantId, action: 'category_add' });
    }

    res.status(201).json({ success: true, category: newCat, message: 'Category created successfully' });
  } catch (error) {
    console.error('[ADD CATEGORY ERROR]', error);
    res.status(500).json({ success: false, message: 'Failed to create category: ' + error.message });
  }
};

// @desc    Delete category
// @route   DELETE /api/menu/categories/:id
// @access  Private
const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const cat = await RestaurantCategory.findByIdAndDelete(id);

    const io = req.app.get('io');
    if (io && cat) {
      io.emit('MENU_CATEGORY_UPDATED', { restaurantId: cat.restaurantId, categoryId: id, action: 'delete' });
      io.emit('MENU_UPDATED', { restaurantId: cat.restaurantId, action: 'category_delete' });
    }

    res.json({ success: true, message: 'Category deleted' });
  } catch (error) {
    console.error('[DELETE CATEGORY ERROR]', error);
    res.status(500).json({ success: false, message: 'Failed to delete category' });
  }
};

// @desc    Get all menu / catalog items for a supplier / restaurant
// @route   GET /api/menu/:restaurantId
// @access  Public / Private
const getMenuItems = async (req, res) => {
  try {
    const restaurantId =
      req.params.restaurantId || req.query.restaurantId || (req.user ? (req.user._id || req.user.id) : null);

    if (!restaurantId || restaurantId === 'undefined' || restaurantId === 'null') {
      return res.json({ success: true, count: 0, items: [] });
    }

    const isCustomerReq = req.query.forCustomer === 'true' || req.query.role === 'customer' || (req.user && req.user.role === 'customer');

    // Authoritative Restaurant Online Status check
    let isStoreOnline = true;
    if (restaurantId) {
      let storeUser = null;
      if (mongoose.Types.ObjectId.isValid(restaurantId)) {
        storeUser = await User.findById(restaurantId).lean();
      }
      if (!storeUser) {
        storeUser = await User.findOne({
          $or: [
            { supplierId: restaurantId },
            { partnerId: restaurantId },
            { phoneNumber: restaurantId },
          ]
        }).lean();
      }
      if (storeUser) {
        isStoreOnline = Boolean(storeUser.restaurant_status === 'online' || storeUser.isOnline === true);
      }
    }

    const filter = { restaurantId };
    if (isCustomerReq) {
      filter.isAvailable = { $ne: false };
    }
    if (req.query.demographic && req.query.demographic !== 'ALL' && req.query.demographic !== 'All') {
      filter.$or = [
        { demographic: req.query.demographic },
        { demographic: 'All' },
        { demographic: 'Unisex' },
        { demographic: { $exists: false } },
      ];
    }
    if (req.query.category && req.query.category !== 'All' && req.query.category !== 'all') {
      filter.category = { $regex: new RegExp(req.query.category.trim(), 'i') };
    }

    const items = await MenuItem.find(filter).sort({ createdAt: -1 });
    res.json({
      success: true,
      count: items.length,
      items,
      isRestaurantOnline: isStoreOnline,
      restaurant_status: isStoreOnline ? 'online' : 'offline',
      message: isStoreOnline ? undefined : 'Restaurant is currently offline/closed. Browsing menu only.'
    });
  } catch (error) {
    console.error('[GET MENU ERROR]', error);
    res.json({ success: true, count: 0, items: [] });
  }
};

// @desc    Add new catalog / menu item
// @route   POST /api/menu
// @access  Private / Supplier / Restaurant
const addMenuItem = async (req, res) => {
  try {
    const restaurantId = req.user ? (req.user._id || req.user.id) : req.body.restaurantId;
    const { name, price, mrp, category, description, image, isVeg, isAvailable, isRefundable, refundPolicy, demographic, brand, rating, reviewsCount } = req.body;

    if (!restaurantId || !name || price === undefined) {
      return res.status(400).json({ success: false, message: 'Supplier ID, item name, and price are required.' });
    }

    const cleanCategory = category && category.trim() ? category.trim() : 'Main Course';

    // Auto-ensure the category exists in RestaurantCategory so it immediately appears in top categories list!
    try {
      const existingCat = await RestaurantCategory.findOne({
        restaurantId,
        name: { $regex: new RegExp(`^${cleanCategory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      });
      if (!existingCat) {
        const autoCat = await RestaurantCategory.create({
          restaurantId,
          name: cleanCategory,
        });
        const io = req.app.get('io');
        if (io) {
          io.emit('MENU_CATEGORY_UPDATED', { restaurantId, category: autoCat, action: 'add' });
        }
      }
    } catch (catErr) {
      console.log('[AUTO CATEGORY NOTICE]', catErr.message);
    }

    const newItem = new MenuItem({
      restaurantId,
      name: name.trim(),
      price: Number(price),
      mrp: mrp !== undefined && mrp !== '' ? Number(mrp) : undefined,
      category: cleanCategory,
      demographic: demographic && ['Men', 'Women', 'Kids', 'Unisex', 'All'].includes(demographic) ? demographic : 'All',
      brand: brand ? String(brand).trim() : '',
      rating: rating !== undefined ? Number(rating) : 4.3,
      reviewsCount: reviewsCount !== undefined ? Number(reviewsCount) : 24,
      description: description ? description.trim() : '',
      image: image || '',
      isVeg: isVeg !== undefined ? isVeg : true,
      isAvailable: isAvailable !== undefined ? isAvailable : true,
      isRefundable: Boolean(isRefundable),
      refundPolicy: refundPolicy ? refundPolicy.trim() : '',
    });

    await newItem.save();
    console.log(`[MENU ADD] Created item "${newItem.name}" in category "${cleanCategory}" for restaurant ${restaurantId}`);

    const io = req.app.get('io');
    if (io) {
      io.emit('MENU_ITEM_CREATED', { restaurantId, item: newItem });
      io.emit('menu_item_added', { restaurantId, item: newItem });
      io.emit('MENU_UPDATED', { restaurantId, action: 'item_add', item: newItem });
      io.emit('RESTAURANT_UPDATED', { restaurantId, action: 'item_add' });
    }

    res.status(201).json({ success: true, item: newItem, message: 'Menu item added successfully' });
  } catch (error) {
    console.error('[ADD MENU ERROR]', error);
    res.status(500).json({ success: false, message: 'Failed to add menu item: ' + error.message });
  }
};

// @desc    Update menu item
// @route   PUT /api/menu/:id
// @access  Private
const updateMenuItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await MenuItem.findById(id);

    if (!item) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    const wasAvailable = item.isAvailable;
    const fieldsToUpdate = ['name', 'price', 'mrp', 'category', 'demographic', 'brand', 'rating', 'reviewsCount', 'description', 'image', 'isVeg', 'isAvailable', 'isRefundable', 'refundPolicy'];
    fieldsToUpdate.forEach((field) => {
      if (req.body[field] !== undefined) {
        item[field] = req.body[field];
      }
    });

    await item.save();

    const io = req.app.get('io');
    if (io) {
      io.emit('MENU_ITEM_UPDATED', { restaurantId: item.restaurantId, item });
      if (req.body.isAvailable !== undefined && wasAvailable !== item.isAvailable) {
        io.emit('MENU_ITEM_AVAILABILITY_UPDATED', {
          restaurantId: item.restaurantId,
          itemId: item._id,
          isAvailable: item.isAvailable,
        });
      }
    }

    res.json({ success: true, item, message: 'Menu item updated' });
  } catch (error) {
    console.error('[UPDATE MENU ERROR]', error);
    res.status(500).json({ success: false, message: 'Failed to update menu item' });
  }
};

// @desc    Delete menu item
// @route   DELETE /api/menu/:id
// @access  Private
const deleteMenuItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await MenuItem.findByIdAndDelete(id);

    if (!item) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('MENU_ITEM_DELETED', { restaurantId: item.restaurantId, itemId: id });
    }

    res.json({ success: true, message: 'Menu item deleted successfully' });
  } catch (error) {
    console.error('[DELETE MENU ERROR]', error);
    res.status(500).json({ success: false, message: 'Failed to delete menu item' });
  }
};

// @desc    Get real-time meal completion suggestions for a restaurant's cart
// @route   GET /api/menu/suggestions/:restaurantId
// @access  Public
const getSuggestions = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { excludeItemIds } = req.query;

    if (!restaurantId || restaurantId === 'undefined' || restaurantId === 'null') {
      return res.json({ success: true, count: 0, suggestions: [] });
    }

    // Only include real items that are in-stock / available
    const filter = {
      restaurantId,
      isAvailable: true,
    };

    // Exclude items already present in the customer's cart
    if (excludeItemIds) {
      const excludeList = excludeItemIds.split(',').map((s) => s.trim()).filter(Boolean);
      if (excludeList.length > 0) {
        filter._id = { $nin: excludeList };
      }
    }

    // Fetch real menu items directly from MongoDB
    const items = await MenuItem.find(filter).lean();

    // Prioritize complementary meal additions (beverages, starters, breads, desserts, sides)
    const complementaryKeywords = [
      'beverage',
      'drink',
      'shake',
      'juice',
      'coffee',
      'tea',
      'starter',
      'bread',
      'roti',
      'naan',
      'dessert',
      'sweet',
      'side',
      'fries',
      'soup',
      'manchurian',
      'garlic bread',
    ];

    const sorted = items.sort((a, b) => {
      const aText = `${a.category || ''} ${a.name || ''}`.toLowerCase();
      const bText = `${b.category || ''} ${b.name || ''}`.toLowerCase();
      const aComp = complementaryKeywords.some((k) => aText.includes(k));
      const bComp = complementaryKeywords.some((k) => bText.includes(k));
      if (aComp && !bComp) return -1;
      if (!aComp && bComp) return 1;
      return 0;
    });

    res.json({ success: true, count: sorted.length, suggestions: sorted });
  } catch (error) {
    console.error('[GET SUGGESTIONS ERROR]', error);
    res.status(500).json({ success: false, message: 'Failed to fetch cart suggestions' });
  }
};

// @desc    Validate menu item availability & latest price before adding to cart
// @route   POST /api/menu/validate-item
// @access  Public
const validateMenuItem = async (req, res) => {
  try {
    const { restaurantId, itemId } = req.body;

    if (!restaurantId || !itemId) {
      return res.status(400).json({
        success: false,
        isAvailable: false,
        message: 'restaurantId and itemId are required.',
      });
    }

    const item = await MenuItem.findOne({
      _id: itemId,
      restaurantId,
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        isAvailable: false,
        message: 'This item is no longer available in this restaurant.',
      });
    }

    if (item.isAvailable === false) {
      return res.status(200).json({
        success: false,
        isAvailable: false,
        message: 'This item is currently unavailable.',
      });
    }

    return res.status(200).json({
      success: true,
      isAvailable: true,
      item: {
        _id: item._id,
        restaurantId: item.restaurantId,
        name: item.name,
        price: item.price,
        category: item.category,
        description: item.description,
        image: item.image,
        isVeg: item.isVeg,
        isAvailable: item.isAvailable,
      },
    });
  } catch (error) {
    console.error('[VALIDATE ITEM ERROR]', error);
    res.status(500).json({ success: false, isAvailable: false, message: 'Failed to validate item' });
  }
};

module.exports = {
  getCategories,
  addCategory,
  deleteCategory,
  getMenuItems,
  addMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getSuggestions,
  validateMenuItem,
};
