const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.Mixed,
  },
  type: {
    type: String,
    required: true,
  },
  amount: {
    type: Number, // Monetary amount in INR
    required: true,
  },
  currency: {
    type: String,
    default: 'INR',
  },
  coinsAdded: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['completed', 'pending', 'failed'],
    default: 'completed',
  },
  description: {
    type: String,
  },
  razorpayPaymentId: {
    type: String,
    sparse: true,
    unique: true,
  },
  relatedLiveRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LiveRequest',
    default: null,
  },
  // Reference fields for gift transactions
  relatedGiftName: {
    type: String,
    default: '',
  },
  relatedUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Transaction', TransactionSchema);
