const mongoose = require('mongoose');

const LiveStreamSchema = new mongoose.Schema({
  hostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  status: {
    type: String,
    enum: ['live', 'ended'],
    default: 'live',
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  endedAt: {
    type: Date,
  },
  metrics: {
    totalViewers: { type: Number, default: 0 },
    peakViewers: { type: Number, default: 0 },
    totalGifts: { type: Number, default: 0 },
    totalLikes: { type: Number, default: 0 },
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('LiveStream', LiveStreamSchema);
