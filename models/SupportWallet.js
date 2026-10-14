const mongoose = require('mongoose');

const SupportTransactionSchema = new mongoose.Schema(
  {
    txId: {
      type: String,
      default: () => 'STX_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    },
    type: {
      type: String,
      enum: ['credit', 'debit', 'payout', 'fee_deduction', 'adjustment'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'cancelled'],
      default: 'completed',
    },
    referenceId: {
      type: String,
      default: '',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const SupportUpiRequestSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      default: () => 'UPI_REQ_' + Date.now(),
    },
    upiId: {
      type: String,
      required: true,
      trim: true,
    },
    holderName: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending_approval', 'approved', 'rejected'],
      default: 'pending_approval',
    },
    rejectionReason: {
      type: String,
      default: '',
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

const SupportWithdrawalSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      unique: true,
      default: () => 'SWD_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000),
      index: true,
    },
    agentId: {
      type: String,
      required: true,
      index: true,
    },
    agentName: {
      type: String,
      default: 'Support Agent',
    },
    amount: {
      type: Number,
      required: true,
    },
    charges: {
      type: Number,
      default: 0,
    },
    netPayable: {
      type: Number,
      required: true,
    },
    upiId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'processed'],
      default: 'pending',
      index: true,
    },
    transactionId: {
      type: String,
      default: '',
    },
    rejectionReason: {
      type: String,
      default: '',
    },
    approvedBy: {
      type: String,
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

const SupportWalletSchema = new mongoose.Schema(
  {
    agentId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    agentName: {
      type: String,
      default: 'Support Agent',
    },
    agentEmail: {
      type: String,
      default: '',
    },
    balance: {
      type: Number,
      default: 0,
    },
    totalEarned: {
      type: Number,
      default: 0,
    },
    totalWithdrawn: {
      type: Number,
      default: 0,
    },
    activeUpiId: {
      type: String,
      default: '',
    },
    activeUpiHolder: {
      type: String,
      default: '',
    },
    upiStatus: {
      type: String,
      enum: ['none', 'pending_approval', 'approved', 'rejected'],
      default: 'none',
    },
    upiRequests: [SupportUpiRequestSchema],
    withdrawals: [SupportWithdrawalSchema],
    transactions: [SupportTransactionSchema],
  },
  { timestamps: true }
);

module.exports = {
  SupportWallet: mongoose.model('SupportWallet', SupportWalletSchema),
  SupportWithdrawal: mongoose.model('SupportWithdrawal', SupportWithdrawalSchema),
};
