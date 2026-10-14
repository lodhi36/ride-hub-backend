const mongoose = require('mongoose');

const LiveRequestSchema = new mongoose.Schema({
  broadcasterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  viewerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  viewerName: {
    type: String,
    required: true,
  },
  viewerAvatar: {
    type: String,
    default: '',
  },
  isPriority: {
    type: Boolean,
    default: false,
  },
  plan: {
    price: { type: Number, required: true },
    durationMinutes: { type: Number, required: true },
  },
  status: {
    type: String,
    enum: ['pending_payment', 'pending_acceptance', 'accepted', 'rejected', 'completed', 'cancelled'],
    default: 'pending_acceptance',
  },
  paymentId: {
    type: String,
    sparse: true,
    unique: true,
  },
  orderId: {
    type: String,
    sparse: true,
  },
  paidAmount: {
    type: Number,
    default: 0,
  },
  paymentTime: {
    type: Date,
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('LiveRequest', LiveRequestSchema);
