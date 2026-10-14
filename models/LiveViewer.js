const mongoose = require('mongoose');

const LiveViewerSchema = new mongoose.Schema({
  streamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LiveStream',
    required: true,
  },
  viewerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
  leftAt: {
    type: Date,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('LiveViewer', LiveViewerSchema);
