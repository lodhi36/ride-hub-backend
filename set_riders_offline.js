const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/datingapp';

async function setAllRidersOffline() {
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    // Filter riders by role or partnerId prefix DLV
    const filter = {
      $or: [
        { role: 'rider' },
        { role: 'delivery_partner' },
        { partnerId: { $regex: /^DLV/i } },
        { vehicleType: { $exists: true, $ne: null } }
      ]
    };

    const updateResult = await db.collection('users').updateMany(
      filter,
      {
        $set: {
          isOnline: false,
          rider_status: 'offline',
          status: 'offline',
          lastSeen: new Date(),
          updatedAt: new Date()
        }
      }
    );

    console.log(`Successfully updated ${updateResult.modifiedCount} riders to OFFLINE.`);

    // Verify all riders now
    const riders = await db.collection('users').find(filter).toArray();
    console.log('\n--- VERIFIED RIDERS STATUS ---');
    riders.forEach(r => {
      console.log(`Rider: ${r.name || r.fullName} | Phone: ${r.phoneNumber || r.phone} | isOnline: ${r.isOnline} | rider_status: ${r.rider_status}`);
    });

    process.exit(0);
  } catch (err) {
    console.error('Error setting riders offline:', err);
    process.exit(1);
  }
}

setAllRidersOffline();
