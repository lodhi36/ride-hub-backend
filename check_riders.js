const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const User = require('./models/User');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const riders = await User.find({ role: 'rider' }).lean();
  console.log(`Total riders found: ${riders.length}`);
  for (const r of riders) {
    console.log({
      id: r._id,
      name: r.name,
      phone: r.phone,
      isOnline: r.isOnline,
      dutyStatus: r.dutyStatus,
      location: r.location,
      currentBookingId: r.currentBookingId,
      vehicle: r.vehicleDetails || r.vehicleType
    });
  }
  await mongoose.disconnect();
}

run().catch(console.error);
