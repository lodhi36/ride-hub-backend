const mongoose = require('mongoose');

const screenMediaSchema = new mongoose.Schema(
  {
    screenId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      enum: [
        'SPLASH_SCREEN',
        'ROLE_SELECTION',
        'CUSTOMER_HOME',
        'FOOD_BANNER',
        'FASHION_BANNER',
        'TOYS_BANNER',
        'VEGETABLES_BANNER',
        'BEAUTY_BANNER',
        'KIRANA_BANNER',
        'CATEGORY_IMAGES',
        'PRODUCT_PROMOTION',
        'RIDER_HOME',
        'SUPPLIER_HOME',
        'LIVE_TRACKING', // Restricted: Always disabled/blocked
      ],
    },
    screenName: {
      type: String,
      required: true,
    },
    allowedMediaTypes: {
      type: [String],
      enum: ['IMAGE', 'BANNER', 'LOTTIE'],
      default: ['IMAGE', 'BANNER', 'LOTTIE'],
    },
    currentMediaType: {
      type: String,
      enum: ['IMAGE', 'BANNER', 'LOTTIE', 'BOTH', 'NONE'],
      default: 'IMAGE',
    },
    displayMode: {
      type: String,
      enum: ['IMAGE', 'LOTTIE', 'BOTH', 'NONE'],
      default: 'BOTH',
    },
    mediaUrl: {
      type: String,
      default: '',
    },
    imageUrl: {
      type: String,
      default: '',
    },
    lottieUrl: {
      type: String,
      default: '',
    },
    version: {
      type: Number,
      default: 1,
    },
    title: {
      type: String,
      default: '',
    },
    description: {
      type: String,
      default: '',
    },
    categoryId: {
      type: String,
      default: '',
    },
    lottieConfig: {
      speed: { type: Number, default: 1.0 },
      loop: { type: Boolean, default: true },
      autoplay: { type: Boolean, default: true },
      rawJson: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isRestricted: {
      type: Boolean,
      default: false,
    },
    restrictionReason: {
      type: String,
      default: '',
    },
    publishedAt: {
      type: Date,
      default: Date.now,
    },
    updatedBy: {
      type: String,
      default: 'admin',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ScreenMedia', screenMediaSchema);
