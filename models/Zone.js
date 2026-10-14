const mongoose = require('mongoose');

const ConfiguredAreaSchema = new mongoose.Schema(
  {
    areaId: { type: String, required: true },
    areaName: { type: String, required: true },
    polygonCoordinates: {
      type: [[Number]],
      required: true,
    },
    centerCoordinates: {
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
    },
    landmarks: { type: [String], default: [] },
  },
  { _id: false }
);

const ZoneSchema = new mongoose.Schema(
  {
    zoneId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    zoneName: {
      type: String,
      required: true,
      trim: true,
    },
    zoneGroup: {
      type: String,
      required: true,
      enum: ['OLD_BHOPAL', 'NEW_BHOPAL', 'BHEL'],
      trim: true,
      index: true,
    },
    tagline: {
      type: String,
      default: '',
    },
    centerCoordinates: {
      latitude: {
        type: Number,
        required: true,
      },
      longitude: {
        type: Number,
        required: true,
      },
    },
    polygonCoordinates: {
      type: [[Number]], // Array of [lat, lon] tuples
      required: true,
    },
    configuredAreas: {
      type: [ConfiguredAreaSchema],
      default: [],
    },
    coveredAreas: {
      type: [String],
      default: [],
    },
    serviceRadiusKm: {
      type: Number,
      default: 5.0,
    },
    description: {
      type: String,
      default: '',
    },
    landmarks: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// ONLY 3 MAIN ZONE GROUPS IN THE SYSTEM
const DEFAULT_BHOPAL_ZONES = [
  // ── 1. OLD BHOPAL ──────────────────────────────────────────
  {
    zoneId: 'old_bhopal',
    zoneName: 'Old Bhopal',
    zoneGroup: 'OLD_BHOPAL',
    tagline: 'Arwaliya • Shampur • Islamnagar • Peoples Mall • Lalghati • Bairagarh • VIP Road • Chirayu • Aishbagh • Ashoka Garden',
    centerCoordinates: { latitude: 23.2950, longitude: 77.3950 },
    // Outer boundary enclosing all Old Bhopal areas
    polygonCoordinates: [
      [23.3850, 77.3800], // North Arwaliya / Siyanpur
      [23.3850, 77.4550], // North Islamnagar / Bhanpur
      [23.2850, 77.4550], // Ashoka Garden / Semra
      [23.2200, 77.4350], // Aishbagh / Railway
      [23.2200, 77.3650], // New Market / VIP Road
      [23.2600, 77.3000], // Bairagarh / Chirayu
      [23.3300, 77.3000], // Lalghati / Gandhinagar
      [23.3850, 77.3800], // Close loop
    ],
    configuredAreas: [
      {
        areaId: 'arwaliya_shampur_islamnagar',
        areaName: 'Arwaliya, Shampur & Islamnagar',
        centerCoordinates: { latitude: 23.3550, longitude: 77.4150 },
        // Exact polygon covering Siyanpur, Islamnagar, Huzur Tehsil, Arwaliya, Berasia Road
        polygonCoordinates: [
          [23.3850, 77.3800],
          [23.3850, 77.4500],
          [23.3300, 77.4500],
          [23.3300, 77.3800],
          [23.3850, 77.3800],
        ],
        landmarks: ['Arwaliya Chauraha', 'Huzur Tehsil', 'Islamnagar Gate', 'Siyanpur', 'Berasia Road Stretch'],
      },
      {
        areaId: 'peoples_mall_karond',
        areaName: "People's Mall, Karond & Bhanpur",
        centerCoordinates: { latitude: 23.3050, longitude: 77.4150 },
        polygonCoordinates: [
          [23.3350, 77.3900],
          [23.3350, 77.4600],
          [23.2800, 77.4600],
          [23.2800, 77.3900],
          [23.3350, 77.3900],
        ],
        landmarks: ["People's Mall", 'Karond Mandi', 'Bhanpur Chauraha', 'Nishatpura Railway Colony'],
      },
      {
        areaId: 'lalghati_bairagarh_chirayu',
        areaName: 'Lalghati, Bairagarh & Chirayu',
        centerCoordinates: { latitude: 23.2850, longitude: 77.3400 },
        polygonCoordinates: [
          [23.3300, 77.3000],
          [23.3300, 77.3700],
          [23.2550, 77.3700],
          [23.2550, 77.3000],
          [23.3300, 77.3000],
        ],
        landmarks: ['Lalghati Square', 'Airport Road', 'Bairagarh Main Road', 'Chirayu Medical College & Hospital', 'Halalpura Bus Stand'],
      },
      {
        areaId: 'vip_road_kohefiza',
        areaName: 'VIP Road & Koh-e-Fiza',
        centerCoordinates: { latitude: 23.2550, longitude: 77.3750 },
        polygonCoordinates: [
          [23.2800, 77.3500],
          [23.2800, 77.3950],
          [23.2350, 77.3950],
          [23.2350, 77.3500],
          [23.2800, 77.3500],
        ],
        landmarks: ['VIP Road Lake View', 'Kamla Park', 'Koh-e-Fiza BDH', 'Polytechnic Square'],
      },
      {
        areaId: 'aishbagh_ashoka_garden',
        areaName: 'Aishbagh, Ashoka Garden & New Market',
        centerCoordinates: { latitude: 23.2550, longitude: 77.4200 },
        polygonCoordinates: [
          [23.2850, 77.3950],
          [23.2850, 77.4550],
          [23.2200, 77.4550],
          [23.2200, 77.3950],
          [23.2850, 77.3950],
        ],
        landmarks: ['Aishbagh Stadium', 'Ashoka Garden 80 Feet Road', 'Bhopal Junction Railway Station', 'New Market TT Nagar'],
      },
    ],
    coveredAreas: [
      'Arwaliya & Huzur Tehsil',
      'Shampur & Siyanpur',
      'Islamnagar',
      "People's Mall & Bhanpur",
      'Karond & Mandi',
      'Lalghati & Airport Road',
      'Bairagarh',
      'VIP Road & Koh-e-Fiza',
      'Chirayu Hospital Area',
      'Aishbagh',
      'Ashoka Garden & 80 Feet Road',
      'New Market & TT Nagar',
    ],
    serviceRadiusKm: 5.0,
    description: 'Old Bhopal Zone covering Arwaliya, Shampur, Islamnagar, Peoples Mall, Lalghati, Bairagarh, VIP Road, Chirayu, Aishbagh, and Ashoka Garden.',
    landmarks: ['Arwaliya', 'Islamnagar', 'Peoples Mall', 'Lalghati', 'Bairagarh', 'VIP Road', 'Chirayu', 'Aishbagh', 'Ashoka Garden'],
    isActive: true,
  },

  // ── 2. NEW BHOPAL ──────────────────────────────────────────
  {
    zoneId: 'new_bhopal',
    zoneName: 'New Bhopal',
    zoneGroup: 'NEW_BHOPAL',
    tagline: 'MP Nagar • Arera Colony • Shahpura • Bawadia Kalan • Kolar Road • Hoshangabad Road',
    centerCoordinates: { latitude: 23.2050, longitude: 77.4300 },
    polygonCoordinates: [
      [23.2550, 77.4100],
      [23.2550, 77.4950],
      [23.1350, 77.4950],
      [23.1300, 77.3800],
      [23.2100, 77.3800],
      [23.2550, 77.4100],
    ],
    configuredAreas: [
      {
        areaId: 'mp_nagar_arera',
        areaName: 'MP Nagar & Arera Colony',
        centerCoordinates: { latitude: 23.2300, longitude: 77.4300 },
        polygonCoordinates: [
          [23.2550, 77.4100],
          [23.2550, 77.4550],
          [23.2050, 77.4550],
          [23.2050, 77.4100],
          [23.2550, 77.4100],
        ],
        landmarks: ['DB City Mall', 'Bittan Market', '10 Number Market', 'Rani Kamlapati Station'],
      },
      {
        areaId: 'shahpura_bawadia',
        areaName: 'Shahpura & Bawadia Kalan',
        centerCoordinates: { latitude: 23.1850, longitude: 77.4250 },
        polygonCoordinates: [
          [23.2100, 77.4000],
          [23.2100, 77.4500],
          [23.1600, 77.4500],
          [23.1600, 77.4000],
          [23.2100, 77.4000],
        ],
        landmarks: ['Shahpura Lake', 'Bansal Hospital', 'Bawadia Kalan Flyover', 'Rohit Nagar'],
      },
      {
        areaId: 'kolar_road',
        areaName: 'Kolar Road',
        centerCoordinates: { latitude: 23.1600, longitude: 77.4000 },
        polygonCoordinates: [
          [23.1900, 77.3800],
          [23.1900, 77.4200],
          [23.1300, 77.4200],
          [23.1300, 77.3800],
          [23.1900, 77.3800],
        ],
        landmarks: ['Sarvadharma Colony', 'Nayapura', 'Danish Kunj', 'Mandakini Ground'],
      },
      {
        areaId: 'hoshangabad_misrod',
        areaName: 'Hoshangabad Road & Misrod',
        centerCoordinates: { latitude: 23.1700, longitude: 77.4650 },
        polygonCoordinates: [
          [23.2050, 77.4450],
          [23.2050, 77.4950],
          [23.1350, 77.4950],
          [23.1350, 77.4450],
          [23.2050, 77.4450],
        ],
        landmarks: ['Aashima Mall', 'Misrod Police Station', 'Ratanpur', 'Barkatullah University'],
      },
    ],
    coveredAreas: [
      'MP Nagar (Zone 1 & 2)',
      'Arera Colony (E1-E8)',
      'Shahpura & Chunabhatti',
      'Bawadia Kalan & Rohit Nagar',
      'Kolar Road (Sarvadharma & Nayapura)',
      'Hoshangabad Road & Misrod',
    ],
    serviceRadiusKm: 5.0,
    description: 'New Bhopal Zone covering MP Nagar, Arera Colony, Shahpura, Bawadia Kalan, Kolar Road, and Hoshangabad Road.',
    landmarks: ['DB City Mall', 'Bittan Market', 'Shahpura Lake', 'Bansal Hospital', 'Aashima Mall', 'Kolar Road'],
    isActive: true,
  },

  // ── 3. BHEL ────────────────────────────────────────────────
  {
    zoneId: 'bhel',
    zoneName: 'BHEL',
    zoneGroup: 'BHEL',
    tagline: 'BHEL Township • Govindpura • Piplani • Indrapuri • Awadhpuri',
    centerCoordinates: { latitude: 23.2420, longitude: 77.4800 },
    polygonCoordinates: [
      [23.2750, 77.4450],
      [23.2750, 77.5400],
      [23.2050, 77.5400],
      [23.2050, 77.4450],
      [23.2750, 77.4450],
    ],
    configuredAreas: [
      {
        areaId: 'bhel_govindpura',
        areaName: 'BHEL Township & Govindpura',
        centerCoordinates: { latitude: 23.2550, longitude: 77.4650 },
        polygonCoordinates: [
          [23.2750, 77.4450],
          [23.2750, 77.4950],
          [23.2350, 77.4950],
          [23.2350, 77.4450],
          [23.2750, 77.4450],
        ],
        landmarks: ['Jubilee Gate BHEL', 'Govindpura Industrial Area', 'Kasturba Hospital'],
      },
      {
        areaId: 'piplani_indrapuri',
        areaName: 'Piplani & Indrapuri',
        centerCoordinates: { latitude: 23.2450, longitude: 77.4850 },
        polygonCoordinates: [
          [23.2650, 77.4650],
          [23.2650, 77.5100],
          [23.2250, 77.5100],
          [23.2250, 77.4650],
          [23.2650, 77.4650],
        ],
        landmarks: ['Piplani Petrol Pump', 'Indrapuri Sector C', 'Sonagiri'],
      },
      {
        areaId: 'awadhpuri_khajuri',
        areaName: 'Awadhpuri & Khajuri Kalan',
        centerCoordinates: { latitude: 23.2300, longitude: 77.5150 },
        polygonCoordinates: [
          [23.2550, 77.4950],
          [23.2550, 77.5400],
          [23.2050, 77.5400],
          [23.2050, 77.4950],
          [23.2550, 77.4950],
        ],
        landmarks: ['Awadhpuri BDA Square', 'Amrawad Khurd', 'Khajuri Kalan'],
      },
    ],
    coveredAreas: [
      'BHEL Township & Factory Area',
      'Govindpura Industrial Area',
      'Piplani & Sector A/B/C',
      'Indrapuri & Sonagiri',
      'Awadhpuri & BDA Colony',
      'Khajuri Kalan & Amrawad',
    ],
    serviceRadiusKm: 5.0,
    description: 'BHEL Zone covering BHEL Township, Govindpura, Piplani, Indrapuri, and Awadhpuri.',
    landmarks: ['Jubilee Gate BHEL', 'Piplani Petrol Pump', 'Indrapuri Sector C', 'Awadhpuri BDA Square', 'Kasturba Hospital'],
    isActive: true,
  },
];

ZoneSchema.statics.seedDefaultZones = async function () {
  try {
    console.log('📍 Seeding the 3 Main Zone Groups (OLD_BHOPAL, NEW_BHOPAL, BHEL) with configured areas...');
    for (const zone of DEFAULT_BHOPAL_ZONES) {
      await this.findOneAndUpdate(
        { zoneId: zone.zoneId },
        { $set: zone },
        { upsert: true, new: true }
      );
    }
    // Strictly keep ONLY the 3 main zone groups
    const validIds = DEFAULT_BHOPAL_ZONES.map((z) => z.zoneId);
    const deleteResult = await this.deleteMany({ zoneId: { $nin: validIds } });
    if (deleteResult.deletedCount > 0) {
      console.log(`🧹 Removed ${deleteResult.deletedCount} deprecated standalone zones.`);
    }
    console.log(`✅ Only ${DEFAULT_BHOPAL_ZONES.length} Main Zone Groups active: OLD_BHOPAL, NEW_BHOPAL, BHEL.`);
  } catch (err) {
    console.error('⚠️ Failed to seed Bhopal zones:', err.message);
  }
};

module.exports = mongoose.model('Zone', ZoneSchema);
module.exports.DEFAULT_BHOPAL_ZONES = DEFAULT_BHOPAL_ZONES;
