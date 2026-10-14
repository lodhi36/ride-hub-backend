const mongoose = require('mongoose');

const AdminNotificationSchema = new mongoose.Schema({
  title: {
    type: String,
    default: 'Admin Notification',
  },
  text: {
    type: String,
    required: true,
  },
  target: {
    type: String,
    enum: ['all_users', 'customer', 'customers', 'user', 'users', 'rider', 'riders', 'supplier', 'suppliers', 'store', 'restaurant', 'active', 'premium', 'specific'],
    default: 'all_users',
  },
  sentTo: {
    type: Number,
    default: 0,
  },
  image: {
    type: String,
    default: null,
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('AdminNotification', AdminNotificationSchema);
