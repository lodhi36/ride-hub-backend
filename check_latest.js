const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const Booking = require('./models/Booking');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const bookings = await Booking.find().sort({ createdAt: -1 }).limit(5).lean();
  console.log(`Found ${bookings.length} bookings:`);
  for (const b of bookings) {
    console.log({
      id: b.bookingId,
      status: b.status,
      category: b.serviceName || b.categoryName,
      customer: b.customerId,
      rider: b.riderId,
      store: b.restaurantId,
      pickup: b.pickupAddress,
      destination: b.destinationAddress,
      price: b.price,
      deliveryFee: b.deliveryFee,
      createdAt: b.createdAt
    });
  }
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
