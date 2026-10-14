const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  imageUrl: {
    type: String,
    required: [true, 'Please add a banner image URL'],
  },
  target: {
    type: String,
    enum: ['USER', 'RIDER', 'SUPPLIER', 'Customer', 'Rider', 'Supplier', 'Restaurant', 'User', 'FASHION', 'Fashion', 'SUBCATEGORY', 'Subcategory'],
    default: 'USER',
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Active',
  },
  order: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

module.exports = mongoose.model('Banner', bannerSchema);
