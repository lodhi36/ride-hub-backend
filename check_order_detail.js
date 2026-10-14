const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const Booking = require('./models/Booking');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const b = await Booking.findOne({ bookingId: 'ride_1791976292188_5614' }).lean();
  console.log({
    bookingId: b.bookingId,
    status: b.status,
    deliveryStatus: b.deliveryStatus,
    riderStatus: b.riderStatus,
    riderId: b.riderId,
    pendingRiderId: b.pendingRiderId,
    acceptedAt: b.acceptedAt,
    pickupAddress: b.pickupAddress,
    destinationAddress: b.destinationAddress,
    deliveryFee: b.deliveryFee,
    price: b.price
  });
  await mongoose.disconnect();
}

run().catch(console.error);
