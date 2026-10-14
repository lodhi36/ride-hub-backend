const mongoose = require('mongoose');

const SupportLedgerSchema = new mongoose.Schema({
  agentId: {
    type: String,
    required: true,
    index: true,
  },
  caseId: {
    type: String,
    index: true,
  },
  caseNumber: {
    type: String,
    default: '',
  },
  orderRef: {
    type: String,
    default: '',
  },
  category: {
    type: String,
    default: 'other',
  },
  amount: {
    type: Number,
    required: true,
  },
  type: {
    type: String,
    enum: ['case_payout', 'adjustment', 'bonus', 'withdrawal'],
    default: 'case_payout',
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'paid', 'rejected'],
    default: 'approved',
  },
  description: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('SupportLedger', SupportLedgerSchema);
