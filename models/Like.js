const mongoose = require('mongoose');

const LikeSchema = new mongoose.Schema({
  liker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  likee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  status: {
    type: String,
    enum: ['like', 'dislike'],
    required: true,
  }
}, {
  timestamps: true
});

// Avoid duplicate likes
LikeSchema.index({ liker: 1, likee: 1 }, { unique: true });

module.exports = mongoose.model('Like', LikeSchema);
