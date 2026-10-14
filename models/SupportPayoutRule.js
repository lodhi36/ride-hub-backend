const mongoose = require('mongoose');

const SupportPayoutRuleSchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    unique: true,
  },
  amount: {
    type: Number,
    required: true,
    default: 15,
  },
  active: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('SupportPayoutRule', SupportPayoutRuleSchema);
