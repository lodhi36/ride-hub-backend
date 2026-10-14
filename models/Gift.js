const mongoose = require('mongoose');

const GiftSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  animationUrl: {
    type: String,
    required: true, // Lottie file URL or local path reference
  },
  coinCost: {
    type: Number,
    required: true,
  },
  iconUrl: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Gift', GiftSchema);
