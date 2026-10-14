const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  messageId: { type: String, default: () => 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7) },
  senderId: { type: String, required: true },
  senderRole: { type: String, enum: ['agent', 'admin', 'rider', 'customer', 'restaurant', 'supplier', 'system'], required: true },
  senderName: { type: String, default: 'Support' },
  text: { type: String, required: true },
  attachments: [{ type: String }],
  isInternal: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  isRead: { type: Boolean, default: false },
});

const ActivitySchema = new mongoose.Schema({
  activityId: { type: String, default: () => 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7) },
  type: {
    type: String,
    enum: ['request', 'note', 'message', 'call', 'status_change', 'assignment', 'transfer', 'system', 'attachment', 'money_action'],
    required: true,
  },
  isInternal: { type: Boolean, default: false },
  targetRole: { type: String, enum: ['rider', 'customer', 'restaurant', 'supplier', 'agent', 'all'], default: 'agent' },
  body: { type: String, default: '' },
  agentId: { type: String, default: null },
  agentName: { type: String, default: 'System' },
  agentCode: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
});

const RequestSnapshotSchema = new mongoose.Schema({
  requestId: { type: String, default: () => 'REQ-' + Math.floor(1000 + Math.random() * 9000) },
  orderRef: { type: String, default: '' },
  bookingId: { type: String, default: '' },
  category: { type: String, default: 'other' },
  requesterRole: { type: String, enum: ['rider', 'customer', 'restaurant', 'supplier', 'agent'], default: 'rider' },
  requesterRef: { type: String, default: '' },
  requesterName: { type: String, default: '' },
  requesterPhone: { type: String, default: '' },
  description: { type: String, default: '' },
  gpsLat: { type: Number, default: null },
  gpsLng: { type: Number, default: null },
  orderStatus: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

const SupportCaseSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    unique: true,
    required: true,
    default: () => 'TKT-' + Math.floor(100000 + Math.random() * 900000),
    index: true,
  },
  caseNumber: {
    type: String,
    default: function() { return this.ticketId || ('CASE-' + Math.floor(100000 + Math.random() * 900000)); },
    index: true,
  },
  orderRef: {
    type: String,
    default: '',
    index: true,
  },
  bookingId: {
    type: String,
    default: '',
    index: true,
  },
  category: {
    type: String,
    default: 'other',
  },
  issueCategory: {
    type: String,
    default: 'General Support',
  },
  issueTitle: {
    type: String,
    default: 'Support Ticket',
  },
  description: {
    type: String,
    default: '',
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'medium', 'high', 'urgent', 'critical', 'LOW', 'NORMAL', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'],
    default: 'normal',
  },
  status: {
    type: String,
    default: 'OPEN',
    index: true,
  },
  requesterRole: {
    type: String,
    enum: ['rider', 'customer', 'restaurant', 'supplier', 'agent'],
    default: 'rider',
    index: true,
  },
  requesterRef: {
    type: String,
    default: '',
  },
  requesterId: {
    type: String,
    default: '',
    index: true,
  },
  requesterName: {
    type: String,
    default: 'User',
  },
  requesterPhone: {
    type: String,
    default: '',
  },
  requesterPhoto: {
    type: String,
    default: null,
  },

  // Linked Order & Party Details (Authoritative from MongoDB)
  storeCategory: {
    type: String,
    default: 'Food',
  },
  categoryName: {
    type: String,
    default: 'Food',
  },
  restaurantId: {
    type: String,
    default: null,
  },
  restaurantName: {
    type: String,
    default: '',
  },
  restaurantPhone: {
    type: String,
    default: '',
  },
  customerId: {
    type: String,
    default: null,
  },
  customerName: {
    type: String,
    default: '',
  },
  customerPhone: {
    type: String,
    default: '',
  },
  riderId: {
    type: String,
    default: null,
  },
  riderName: {
    type: String,
    default: '',
  },
  riderPhone: {
    type: String,
    default: '',
  },
  orderStatusAtCreation: {
    type: String,
    default: '',
  },
  orderAmount: {
    type: Number,
    default: 0,
  },
  deliveryAddress: {
    type: String,
    default: '',
  },
  storeAddress: {
    type: String,
    default: '',
  },
  gpsLat: {
    type: Number,
    default: null,
  },
  gpsLng: {
    type: Number,
    default: null,
  },

  // Assignment & Agent Details
  assignedAgentId: {
    type: String,
    default: null,
    index: true,
  },
  assignedAgentName: {
    type: String,
    default: null,
  },
  assignedAgentCode: {
    type: String,
    default: null,
  },
  summary: {
    type: String,
    default: '',
  },
  resolutionReason: {
    type: String,
    default: '',
  },
  payoutAmount: {
    type: Number,
    default: 2,
  },
  requestFee: {
    type: Number,
    default: 2,
  },
  claimReward: {
    type: Number,
    default: 2,
  },
  openedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  assignedAt: {
    type: Date,
    default: null,
  },
  firstResponseAt: {
    type: Date,
    default: null,
  },
  resolvedAt: {
    type: Date,
    default: null,
  },
  closedAt: {
    type: Date,
    default: null,
  },

  // Real-time Chat Conversation Thread
  messages: [MessageSchema],
  requests: [RequestSnapshotSchema],
  activities: [ActivitySchema],
  attachments: [{
    kind: { type: String, default: 'photo' },
    storagePath: { type: String, default: '' },
    url: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  }],

  // Transfer Order Audit Data
  transferDetails: {
    isTransferred: { type: Boolean, default: false },
    originalRiderId: { type: String, default: null },
    originalRiderName: { type: String, default: null },
    transferredAt: { type: Date, default: null },
    reason: { type: String, default: '' },
    penaltyAmount: { type: Number, default: 0 },
    newRiderId: { type: String, default: null },
  },
}, {
  timestamps: true,
});

// Auto-sync ticketId and caseNumber
SupportCaseSchema.pre('save', function(next) {
  if (!this.ticketId) {
    this.ticketId = this.caseNumber || ('TKT-' + Math.floor(100000 + Math.random() * 900000));
  }
  if (!this.caseNumber) {
    this.caseNumber = this.ticketId;
  }
  next();
});

module.exports = mongoose.model('SupportCase', SupportCaseSchema);
