const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    image: {
      type: String,
      default: '',
    },
    icon: {
      type: String,
      default: 'sparkles-outline',
    },
    iconColor: {
      type: String,
      default: '#2563EB',
    },
    bgColor: {
      type: String,
      default: '#EFF6FF',
    },
    startingPrice: {
      type: Number,
      default: 199,
    },
    estimatedTime: {
      type: String,
      default: '30-45m',
    },
    rating: {
      type: Number,
      default: 4.9,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    subcategories: {
      type: [
        {
          name: { type: String, required: true },
          price: { type: Number, default: 199 },
          isActive: { type: Boolean, default: true },
          description: { type: String, default: '' },
          icon: { type: String, default: 'sparkles-outline' }
        }
      ],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Category', categorySchema);
