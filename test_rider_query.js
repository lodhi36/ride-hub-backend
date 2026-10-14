const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const Booking = require('./models/Booking');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const rId = '6acafe003f6184db3b1378c1';
  const queryConditions = [
    { riderId: rId },
    { providerId: rId },
    { assignedRiderId: rId },
    { 'assignedRider.id': rId },
    { 'assignedRider.riderId': rId },
    { 'acceptedBy.riderId': rId },
    { riderPhone: '9039978452' }
  ];
  const list = await Booking.find({ $or: queryConditions }).sort({ createdAt: -1 }).limit(5).lean();
  console.log(`Found ${list.length} bookings for rider:`);
  list.forEach(b => {
    console.log({
      id: b.bookingId,
      status: b.status,
      deliveryStatus: b.deliveryStatus,
      riderStatus: b.riderStatus,
      riderId: b.riderId
    });
  });
  await mongoose.disconnect();
}

run().catch(console.error);
