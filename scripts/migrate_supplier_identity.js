const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const User = require('../models/User');
const Booking = require('../models/Booking');

async function migrate() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI not found in environment');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('Connected to MongoDB successfully.');

  // 1. Migrate Supplier User records
  const suppliers = await User.find({
    $or: [
      { role: { $in: ['supplier', 'seller_partner'] } },
      { partnerType: { $exists: true, $ne: null } },
      { restaurantName: { $exists: true, $ne: '' } },
    ]
  });

  console.log(`Found ${suppliers.length} supplier/partner user records in DB.`);
  let userUpdatedCount = 0;

  for (const s of suppliers) {
    const canonicalId = s._id.toString();
    const needsUpdate = !s.supplierId || s.supplierId !== canonicalId || !s.ownerUserId;

    if (needsUpdate) {
      await User.updateOne(
        { _id: s._id },
        {
          $set: {
            supplierId: canonicalId,
            ownerUserId: canonicalId,
          }
        }
      );
      userUpdatedCount++;
      console.log(`Updated User ${canonicalId} (${s.name || s.restaurantName}) -> supplierId=${canonicalId}`);
    }
  }

  console.log(`Migrated ${userUpdatedCount} supplier user records.`);

  // 2. Migrate existing Bookings to ensure canonical supplierId is populated
  const bookings = await Booking.find({
    $or: [
      { supplierId: null },
      { supplierId: { $exists: false } },
      { supplierId: '' },
    ]
  });

  console.log(`Found ${bookings.length} bookings with missing supplierId.`);
  let bookingUpdatedCount = 0;

  for (const b of bookings) {
    const resolvedStoreId = b.restaurantId || b.providerId || b.partnerId || (b.pickupLocation && b.pickupLocation.supplierId);
    if (resolvedStoreId) {
      const canonicalStoreId = String(resolvedStoreId);
      await Booking.updateOne(
        { _id: b._id },
        {
          $set: {
            supplierId: canonicalStoreId,
            'pickupLocation.supplierId': canonicalStoreId,
          }
        }
      );
      bookingUpdatedCount++;
      console.log(`Updated Booking ${b.bookingId} -> supplierId=${canonicalStoreId}`);
    }
  }

  console.log(`Migrated ${bookingUpdatedCount} booking records.`);
  console.log('Migration completed successfully!');
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
