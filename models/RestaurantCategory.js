const mongoose = require('mongoose');

const RestaurantCategorySchema = new mongoose.Schema({
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
}, { timestamps: true });

RestaurantCategorySchema.index({ restaurantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('RestaurantCategory', RestaurantCategorySchema);
