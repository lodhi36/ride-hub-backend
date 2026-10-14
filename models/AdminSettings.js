const mongoose = require('mongoose');

const AdminSettingsSchema = new mongoose.Schema({
  appName: { type: String, default: 'DatingApp Admin' },
  supportEmail: { type: String, default: 'support@datingapp.com' },
  logo: { type: String, default: '' },
  termsAndConditions: { type: String, default: '' },
  privacyPolicy: { type: String, default: '' },
  banners: [{
    imageUrl: String,
    link: String,
    isActive: { type: Boolean, default: true }
  }],
  notices: [{
    title: String,
    content: String,
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
  }],
  // ── Rain Mode & Weather Surge ──────────────────────────────
  rainMode: {
    isActive: { type: Boolean, default: true },
    surgeFee: { type: Number, default: 20 },
    title: { type: String, default: 'Rainy Weather in your area' },
    subtitle: { type: String, default: 'Rider weather incentive active • Safe deliveries in progress' },
  },
  // ── Gift & Withdrawal Settings ──────────────────────────────
  minWithdrawAmount: {
    type: Number,
    default: 10, // Minimum ₹10 to withdraw (configurable by admin)
  },
  platformCommissionPercent: {
    type: Number,
    default: 4, // 4% admin commission on payouts
  },
  // ── Customizable Splash Screen Settings ───────────────────────
  splashScreen: {
    backgroundColor: { type: String, default: '#EA580C' },
    splashImage: { type: String, default: '' },
    brandNamePrimary: { type: String, default: 'RIDE' },
    brandNameSecondary: { type: String, default: 'HUB' },
    brandTagline: { type: String, default: 'EXPRESS ECOSYSTEM' },
    superAppText: { type: String, default: 'MULTI-ROLE UNIFIED SUPER APP' },
    durationSeconds: { type: Number, default: 2.8 },
    customer: {
      title: { type: String, default: 'Order & Book' },
      subtitle: { type: String, default: 'Food • Groceries • Rides' },
      image: { type: String, default: '' },
    },
    supplier: {
      title: { type: String, default: 'Sell & Grow' },
      subtitle: { type: String, default: 'Store & Merchant Portal' },
      image: { type: String, default: '' },
    },
    delivery: {
      title: { type: String, default: 'Deliver & Earn' },
      subtitle: { type: String, default: 'Fast Fleet & Daily Payouts' },
      image: { type: String, default: '' },
    },
  },
  // ── Diamond / Hero Lottie Animation Settings ─────────────────
  diamondAnimation: {
    isActive: { type: Boolean, default: true },
    animationUrl: { type: String, default: '' },
    animationName: { type: String, default: 'Default Shopping Animation' },
    speed: { type: Number, default: 0.9 },
    updatedAt: { type: Date, default: Date.now },
  },
}, { timestamps: true });

module.exports = mongoose.model('AdminSettings', AdminSettingsSchema);
