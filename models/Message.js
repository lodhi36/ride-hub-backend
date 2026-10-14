const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  text: {
    type: String,
    required: false,
    default: '',
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'audio', 'gift', 'call'],
    default: 'text',
  },
  mediaUrl: {
    type: String,
    required: false,
  },
  // Gift specific fields
  giftId: {
    type: String,
    required: false,
  },
  giftName: {
    type: String,
    required: false,
  },
  giftPrice: {
    type: Number,
    required: false,
  },
  giftImage: {
    type: String,
    required: false,
  },
  // Call specific fields
  callType: {
    type: String,
    enum: ['voice', 'video'],
    required: false,
  },
  callStatus: {
    type: String,
    enum: ['missed', 'rejected', 'completed'],
    required: false,
  },
  callDuration: {
    type: Number,
    required: false,
    default: 0,
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'seen'],
    default: 'sent',
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Message', MessageSchema);
