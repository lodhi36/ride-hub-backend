const mongoose = require('mongoose');

const WithdrawalSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  withdrawAmount: {
    type: Number,
    required: true,
  },
  balanceBefore: {
    type: Number,
    required: true,
  },
  balanceAfter: {
    type: Number,
    required: true,
  },
  bankDetails: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  userRole: {
    type: String,
    default: 'customer',
  },
  storeName: {
    type: String,
    default: null,
  },
  storeAddress: {
    type: String,
    default: null,
  },
  contactNumber: {
    type: String,
    default: null,
  },
  upiId: {
    type: String,
    default: null,
  },
  accountHolderName: {
    type: String,
    default: null,
  },
  approvedAt: {
    type: Date,
    default: null,
  },
  approvedBy: {
    type: String,
    default: null,
  },
  decisionReason: {
    type: String,
    default: null,
  },
  payoutStatus: {
    type: String,
    enum: ['unprocessed', 'processing', 'paid', 'failed'],
    default: 'unprocessed',
  },
  payoutRef: {
    type: String,
    default: null,
  },
  paymentMode: {
    type: String,
    default: 'UPI',
  },
  utrNumber: {
    type: String,
    default: null,
  },
  statementId: {
    type: String,
    default: null,
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('Withdrawal', WithdrawalSchema);
