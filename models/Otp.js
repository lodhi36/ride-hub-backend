const mongoose = require('mongoose');

const OtpSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      enum: ['signup', 'login'],
      required: true,
    },
    role: {
      type: String,
      enum: ['customer', 'supplier', 'rider'],
      default: 'customer',
    },
    attempts: {
      type: Number,
      default: 0,
    },
    resendAfter: {
      type: Date,
      default: () => new Date(Date.now() + 45 * 1000), // 45s cooldown
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // Automatic TTL expiration
    },
    verified: {
      type: Boolean,
      default: false,
    },
    verificationToken: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for quick active lookup
OtpSchema.index({ phoneNumber: 1, purpose: 1, role: 1, verified: 1 });

module.exports = mongoose.model('Otp', OtpSchema);
