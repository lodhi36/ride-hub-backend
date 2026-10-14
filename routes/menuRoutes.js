const express = require('express');
const router = express.Router();
const { protect, protectOrRestaurant } = require('../middleware/authMiddleware');
const {
  getCategories,
  addCategory,
  deleteCategory,
  getMenuItems,
  addMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getSuggestions,
  validateMenuItem,
} = require('../controllers/menuController');

// Category Routes (Explicit routes first)
router.get('/categories/:restaurantId?', getCategories);
router.post('/categories', protectOrRestaurant, addCategory);
router.delete('/categories/:id', protectOrRestaurant, deleteCategory);

// Suggestions & Validation (Explicit routes before param wildcards)
router.get('/suggestions/:restaurantId', getSuggestions);
router.post('/validate-item', validateMenuItem);

// Menu Item Routes
router.get('/:restaurantId?', getMenuItems);
router.post('/', protectOrRestaurant, addMenuItem);
router.put('/:id', protectOrRestaurant, updateMenuItem);
router.delete('/:id', protectOrRestaurant, deleteMenuItem);

module.exports = router;
