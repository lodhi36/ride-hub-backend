const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    index: true,
    default: null,
  },
  isCustomName: {
    type: Boolean,
    default: false,
  },
  isCustomPhoto: {
    type: Boolean,
    default: false,
  },
  email: {
    type: String,
    required: false,
    sparse: true,
    lowercase: true,
    trim: true,
  },
  username: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  password: {
    type: String,
    required: false,
    default: '',
  },
  phoneNumber: {
    type: String,
    sparse: true,
    trim: true,
    index: true,
  },
  refreshToken: {
    type: String,
    default: null,
  },
  // Profile Setup fields
  name: {
    type: String,
    default: '',
  },
  age: {
    type: Number,
    default: null,
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', ''],
    default: '',
  },
  lookingFor: {
    type: String,
    enum: ['Male', 'Female', ''],
    default: '',
  },
  bio: {
    type: String,
    default: '',
  },
  hobbies: {
    type: [String],
    default: [],
  },
  location: {
    type: String,
    default: '',
  },
  country: {
    type: String,
    default: '',
  },
  state: {
    type: String,
    default: '',
  },
  city: {
    type: String,
    default: '',
  },
  viewsCount: {
    type: Number,
    default: 0,
  },
  likesCount: {
    type: Number,
    default: 0,
  },
  profilePicture: {
    type: String,
    default: '',
  },
  photos: {
    type: [String],
    default: [], // Max 6 photos
  },
  isProfileComplete: {
    type: Boolean,
    default: false,
  },
  // Online Status & Push Notifications
  restaurant_status: {
    type: String,
    enum: ['online', 'offline'],
    default: 'offline',
  },
  rider_status: {
    type: String,
    enum: ['online', 'offline'],
    default: 'offline',
  },
  isOnline: {
    type: Boolean,
    default: false,
  },
  isAvailable: {
    type: Boolean,
    default: false,
  },
  lastSeen: {
    type: Date,
    default: Date.now,
  },
  pushToken: {
    type: String,
    default: '',
  },
  // Settings
  theme: {
    type: String,
    enum: ['light', 'dark'],
    default: 'light',
  },
  notificationsEnabled: {
    type: Boolean,
    default: true,
  },
  privacyProfileVisible: {
    type: Boolean,
    default: true,
  },
  // ── Face Verification & Biometric Multi-Role Auth ────────
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending',
  },
  verificationDate: {
    type: Date,
    default: null,
  },
  verificationAttempts: {
    type: Number,
    default: 0,
  },
  verifiedFaceImage: {
    type: String,
    default: '',
  },
  faceSignature: {
    type: String,
    default: '',
    index: true,
  },
  biometricId: {
    type: String,
    default: '',
    index: true,
  },
  faceConsentGranted: {
    type: Boolean,
    default: true,
  },
  faceRegisteredAt: {
    type: Date,
    default: null,
  },
  // ── Wallet, Live Streaming & Gifts ─────────────────────────
  coins: {
    type: Number,
    default: 0,
  },
  totalEarnedCoins: {
    type: Number,
    default: 0,
  },
  walletBalance: {
    type: Number,
    default: 0,
  },
  totalEarnings: {
    type: Number,
    default: 0,
  },
  availableBalance: {
    type: Number,
    default: 0,
  },
  totalWithdrawn: {
    type: Number,
    default: 0,
  },
  totalGiftsReceived: {
    type: Number,
    default: 0,
  },
  earningsBreakdown: {
    voiceCalls: { type: Number, default: 0 },
    videoCalls: { type: Number, default: 0 },
    liveTokens: { type: Number, default: 0 },
    lockedMedia: { type: Number, default: 0 },
  },
  // ── Account Deletion ───────────────────────────────────────
  deletionScheduledAt: {
    type: Date,
    default: null,
  },
  // ── Blocked Users ──────────────────────────────────────────
  blockedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  // ── Saved & Hidden Restaurants ────────────────────────────
  savedRestaurants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  hiddenRestaurants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  // ── Admin Flag ─────────────────────────────────────────────
  isAdmin: {
    type: Boolean,
    default: false,
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'customer', 'supplier', 'seller_partner', 'delivery_partner', 'rider', 'provider'],
    default: 'user',
  },
  isSuspended: {
    type: Boolean,
    default: false,
  },
  businessCategoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
    index: true,
  },
  businessCategoryName: {
    type: String,
    default: '',
  },
  businessType: {
    type: String,
    default: '',
  },
  business_type: {
    type: String,
    default: '',
  },
  categoryName: {
    type: String,
    default: '',
  },
  partnerType: {
    type: String,
    enum: ['RESTAURANT', 'BEAUTY', 'FASHION', 'GROCERY', 'VEGETABLES', 'FRUITS', 'NAMKEEN', 'OIL_FOOD', 'STATIONERY', 'TOYS', 'BAKERY', 'ELECTRONICS', 'SERVICES', 'PHARMACY', 'STORE', 'OTHER'],
    default: 'RESTAURANT',
  },
  // Canonical Supplier Identifier (Requirement 1)
  supplierId: {
    type: String,
    sparse: true,
    index: true,
    trim: true,
  },
  ownerUserId: {
    type: String,
    sparse: true,
    index: true,
    trim: true,
  },
  // Restaurant Partner Production Fields
  partnerId: {
    type: String,
    sparse: true,
    unique: true,
    trim: true,
  },
  ownerName: {
    type: String,
    default: '',
  },
  restaurantName: {
    type: String,
    default: '',
  },
  fullAddress: {
    type: String,
    default: '',
  },
  address: {
    type: String,
    default: '',
  },
  pincode: {
    type: String,
    default: '',
  },
  gstNumber: {
    type: String,
    default: '',
  },
  gstDocument: {
    type: String,
    default: '',
  },
  fssaiNumber: {
    type: String,
    default: '',
  },
  fssaiDocument: {
    type: String,
    default: '',
  },
  panNumber: {
    type: String,
    default: '',
  },
  panDocument: {
    type: String,
    default: '',
  },
  coverImage: {
    type: String,
    default: '',
  },
  // ── Supplier Store Photos & YouTube Video (Customer-Facing Media) ──
  supplierPhotos: {
    type: [String],
    default: [],
  },
  youtubeVideoUrl: {
    type: String,
    default: '',
    trim: true,
  },
  openingTime: {
    type: String,
    default: '10:00 AM',
  },
  closingTime: {
    type: String,
    default: '11:00 PM',
  },
  workingDays: {
    type: [String],
    default: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
  holidays: {
    type: [String],
    default: [],
  },
  latitude: {
    type: Number,
    default: null,
  },
  longitude: {
    type: Number,
    default: null,
  },
  businessLatitude: {
    type: Number,
    default: null,
  },
  businessLongitude: {
    type: Number,
    default: null,
  },
  businessAddress: {
    type: String,
    default: '',
  },
  currentDeviceLocation: {
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 },
    address: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
  },
  businessLocation: {
    type: String,
    default: '',
  },
  liveLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] },
  },
  isMobileVerified: {
    type: Boolean,
    default: false,
  },
  // Delivery Partner / Rider Fields
  vehicleType: {
    type: String,
    default: 'Bike',
  },
  vehicleNumber: {
    type: String,
    default: '',
  },
  drivingLicense: {
    type: String,
    default: '',
  },
  upiId: {
    type: String,
    default: '',
  },
  approvalStatus: {
    type: String,
    enum: [
      'PENDING_TERMS',
      'PENDING_DOCUMENTS',
      'PENDING_VERIFICATION',
      'APPROVED',
      'REJECTED',
      'ADDITIONAL_DOCS_REQUESTED',
      'PENDING',
    ],
    default: 'APPROVED',
  },
  rejectionReason: {
    type: String,
    default: '',
  },
  additionalDocsNote: {
    type: String,
    default: '',
  },
  termsConsent: {
    accepted: {
      type: Boolean,
      default: false,
    },
    version: {
      type: String,
      default: '1.0',
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    signedName: {
      type: String,
      default: '',
    },
    ipAddress: {
      type: String,
      default: '',
    },
    clausesAccepted: {
      type: [String],
      default: [],
    },
    role: {
      type: String,
      default: '',
    },
  },
  locationTracking: {
    isLive: {
      type: Boolean,
      default: false,
    },
    lastLocationUpdate: {
      type: Date,
      default: null,
    },
    coordinates: {
      type: [Number],
      default: [0, 0],
    },
    accuracy: {
      type: Number,
      default: 0,
    },
    address: {
      type: String,
      default: '',
    },
    heading: {
      type: Number,
      default: 0,
    },
    speed: {
      type: Number,
      default: 0,
    },
  },
  // Rider Service Zone Selection Fields
  zone: {
    type: String,
    default: '',
  },
  selectedZone: {
    type: String,
    default: '',
  },
  zoneId: {
    type: String,
    default: '',
  },
  zoneGroup: {
    type: String,
    default: '',
  },
  zoneLatitude: {
    type: Number,
    default: null,
  },
  zoneLongitude: {
    type: Number,
    default: null,
  },
  zoneDistanceKm: {
    type: Number,
    default: null,
  },
  selectedZonePolygon: {
    type: [[Number]],
    default: [],
  },
  zoneSelectedAt: {
    type: Date,
    default: null,
  },
  // ── Network & Device Security Audit Fields ──
  lastLoginIp: {
    type: String,
    default: '',
  },
  ipVersion: {
    type: String,
    default: '',
  },
  registrationIp: {
    type: String,
    default: '',
  },
  lastLoginAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true
});

UserSchema.index({ firebaseUid: 1, role: 1 }, { sparse: true });
UserSchema.index({ phoneNumber: 1, role: 1 }, { unique: true, sparse: true });
UserSchema.index({ username: 1, role: 1 }, { unique: true, sparse: true });

// Sync role, isAdmin and partnerType before saving
UserSchema.pre('save', function(next) {
  if (this.isAdmin) {
    this.role = 'admin';
  } else if (this.role === 'admin') {
    this.isAdmin = true;
  } else if (['customer', 'supplier', 'seller_partner', 'delivery_partner', 'rider', 'provider'].includes(this.role)) {
    this.isAdmin = false;
  } else {
    this.role = 'user';
    this.isAdmin = false;
  }

  // Derive and persist partnerType for suppliers / seller partners
  if (['supplier', 'seller_partner'].includes(this.role)) {
    if (!this.businessType && this.business_type) this.businessType = this.business_type;
    if (!this.business_type && this.businessType) this.business_type = this.businessType;

    const bType = (this.business_type || this.businessType || '').toLowerCase().trim();
    const rawCat = (this.businessCategoryName || this.categoryName || bType || '').toLowerCase();

    if (bType === 'beauty' || rawCat.includes('beauty') || rawCat.includes('salon') || rawCat.includes('cosmetic') || rawCat.includes('spa') || rawCat.includes('makeup')) {
      this.partnerType = 'BEAUTY';
    } else if (bType === 'grocery' || rawCat.includes('grocery') || rawCat.includes('kirana') || rawCat.includes('mart') || rawCat.includes('supermarket') || rawCat.includes('daily')) {
      this.partnerType = 'GROCERY';
    } else if (bType === 'vegetables' || rawCat.includes('veg') || rawCat.includes('sabji')) {
      this.partnerType = 'VEGETABLES';
    } else if (bType === 'fruits' || rawCat.includes('fruit') || rawCat.includes('fal')) {
      this.partnerType = 'FRUITS';
    } else if (bType === 'namkeen' || rawCat.includes('namkeen') || rawCat.includes('snack')) {
      this.partnerType = 'NAMKEEN';
    } else if (bType === 'oil_food' || rawCat.includes('oil') || rawCat.includes('food product')) {
      this.partnerType = 'OIL_FOOD';
    } else if (bType === 'stationery' || rawCat.includes('stationery') || rawCat.includes('stationary') || rawCat.includes('book') || rawCat.includes('pen') || rawCat.includes('office')) {
      this.partnerType = 'STATIONERY';
    } else if (bType === 'fashion' || rawCat.includes('fashion') || rawCat.includes('cloth') || rawCat.includes('apparel') || rawCat.includes('wear') || rawCat.includes('garment')) {
      this.partnerType = 'FASHION';
    } else if (bType === 'toys' || rawCat.includes('toy') || rawCat.includes('game') || rawCat.includes('kids') || rawCat.includes('baby')) {
      this.partnerType = 'TOYS';
    } else if (bType === 'restaurant' || rawCat.includes('food') || rawCat.includes('restaurant') || rawCat.includes('cafe') || rawCat.includes('hotel') || rawCat.includes('dhaba') || rawCat.includes('kitchen') || rawCat.includes('dine')) {
      this.partnerType = 'RESTAURANT';
    } else if (!this.partnerType) {
      this.partnerType = 'RESTAURANT';
    }

    if (!this.supplierId && this._id) {
      this.supplierId = this._id.toString();
    }
    if (!this.ownerUserId && this._id) {
      this.ownerUserId = this._id.toString();
    }
  }

  next();
});

// Hash password before saving if present and modified
UserSchema.pre('save', async function(next) {
  if (!this.password || !this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Compare password method
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
