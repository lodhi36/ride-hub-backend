const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
  restaurantId: {
    type: String,
    required: true,
    index: true,
  },
  userName: {
    type: String,
    default: 'Customer',
    trim: true,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  comment: {
    type: String,
    default: '',
    trim: true,
  },
  userPhoto: {
    type: String,
    default: '',
  },
  image: {
    type: String,
    default: '',
  },
  photos: [{
    type: String,
  }],
  source: {
    type: String,
    default: 'ROYAL_PANEL',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Review', ReviewSchema);
