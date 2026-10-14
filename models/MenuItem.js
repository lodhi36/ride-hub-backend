const mongoose = require('mongoose');

const MenuItemSchema = new mongoose.Schema({
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  mrp: {
    type: Number,
    min: 0,
  },
  category: {
    type: String,
    default: 'Main Course',
    trim: true,
  },
  description: {
    type: String,
    default: '',
    trim: true,
  },
  image: {
    type: String,
    default: '',
  },
  images: [{
    type: String,
  }],
  isVeg: {
    type: Boolean,
    default: true,
  },
  isAvailable: {
    type: Boolean,
    default: true,
  },
  // ── Refundable / Non-Refundable Policy (Set by Supplier) ───
  isRefundable: {
    type: Boolean,
    default: false,
  },
  refundPolicy: {
    type: String,
    default: '',
    trim: true,
  },
  // ── Demographic / Audience (Women, Men, Kids, All) ───
  demographic: {
    type: String,
    enum: ['Men', 'Women', 'Kids', 'Unisex', 'All'],
    default: 'All',
  },
  brand: {
    type: String,
    default: '',
    trim: true,
  },
  rating: {
    type: Number,
    default: 4.3,
  },
  reviewsCount: {
    type: Number,
    default: 24,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('MenuItem', MenuItemSchema);
