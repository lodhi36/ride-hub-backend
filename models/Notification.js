const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false, // Optional — admin notifications have no sender
    default: null,
  },
  type: {
    type: String,
    default: 'admin',
  },
  text: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    default: null, // Admin notifications can have a title
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  isAdminNotification: {
    type: Boolean,
    default: false,
  },
  orderId: {
    type: String,
    default: null,
    index: true,
  },
  bookingId: {
    type: String,
    default: null,
    index: true,
  },
  statusKey: {
    type: String,
    default: null,
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('Notification', NotificationSchema);

