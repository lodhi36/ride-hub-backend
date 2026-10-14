const mongoose = require('mongoose');

const LiveGiftSchema = new mongoose.Schema({
  streamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LiveStream',
    required: true,
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  giftId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Gift',
    required: true,
  },
  coinValue: {
    type: Number,
    required: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('LiveGift', LiveGiftSchema);
