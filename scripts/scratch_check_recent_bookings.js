require('dotenv').config();
const mongoose = require('mongoose');

async function checkBookings() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const Booking = require('../models/Booking');
  const recent = await Booking.find({}).sort({ createdAt: -1 }).limit(10).lean();
  console.log(`Found ${recent.length} recent bookings:`);
  recent.forEach(b => {
    console.log(`- ID: ${b.bookingId || b._id}, status: ${b.status}, cust: ${b.customerId}, resto: ${b.restaurantId}, rider: ${b.riderId}, price: ${b.price}, service: ${b.serviceName || b.categoryName}, createdAt: ${b.createdAt}`);
  });
  await mongoose.disconnect();
}
checkBookings();
