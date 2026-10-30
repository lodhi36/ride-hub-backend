// backend 3/models/AIChatLog.js
const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
  sender: {
    type: String,
    enum: ['user', 'agent', 'system'],
    required: true,
  },
  text: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  feedback: {
    type: String,
    enum: ['thumbs_up', 'thumbs_down', 'none'],
    default: 'none',
  },
  actionSuggested: {
    type: String,
    default: null, // e.g. 'CANCEL_REQUEST', 'TRANSFER_SUPPORT'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
});

const AIChatLogSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  userRole: {
    type: String,
    enum: ['customer', 'supplier', 'rider', 'admin', 'user'],
    required: true,
    index: true,
  },
  userName: {
    type: String,
    default: '',
  },
  sessionId: {
    type: String,
    required: true,
    index: true,
  },
  messages: [ChatMessageSchema],
  dailyMessageCount: {
    type: Number,
    default: 1,
  },
  lastMessageDate: {
    type: String, // YYYY-MM-DD
    default: () => new Date().toISOString().split('T')[0],
    index: true,
  },
}, {
  timestamps: true,
});

AIChatLogSchema.index({ userId: 1, lastMessageDate: 1 });

module.exports = mongoose.model('AIChatLog', AIChatLogSchema);
