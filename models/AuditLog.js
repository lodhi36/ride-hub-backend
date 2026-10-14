const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema(
  {
    logId: {
      type: String,
      unique: true,
      default: () => 'LOG_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      index: true,
    },
    userId: {
      type: String,
      default: null,
      index: true,
    },
    userRole: {
      type: String,
      enum: ['admin', 'support_admin', 'support_agent', 'system', 'customer', 'driver', 'supplier', 'rider'],
      default: 'system',
      index: true,
    },
    userName: {
      type: String,
      default: 'System',
    },
    userEmail: {
      type: String,
      default: '',
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ['auth', 'order', 'cancellation', 'refund', 'payout', 'upi', 'zone', 'permission', 'system'],
      default: 'system',
      index: true,
    },
    targetType: {
      type: String,
      default: 'general',
    },
    targetId: {
      type: String,
      default: '',
      index: true,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
      default: '',
    },
    userAgent: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

AuditLogSchema.statics.logAction = async function ({
  userId,
  userRole,
  userName,
  userEmail,
  action,
  category = 'system',
  targetType = 'general',
  targetId = '',
  details = {},
  ipAddress = '',
  userAgent = '',
}) {
  try {
    return await this.create({
      userId,
      userRole,
      userName,
      userEmail,
      action,
      category,
      targetType,
      targetId,
      details,
      ipAddress,
      userAgent,
    });
  } catch (err) {
    console.error('⚠️ [AuditLog Error]:', err.message);
    return null;
  }
};

module.exports = mongoose.model('AuditLog', AuditLogSchema);
