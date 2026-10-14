require('dotenv').config();
const mongoose = require('mongoose');
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function check() {
  await mongoose.connect(MONGO_URI);
  const Booking = mongoose.model('Booking', new mongoose.Schema({}, { strict: false }));
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

  const suppliers = await User.find({ role: 'supplier' }).select('_id name username restaurantName role restaurant_status isOnline phoneNumber').lean();
  console.log('--- SUPPLIERS ---');
  console.log(JSON.stringify(suppliers, null, 2));

  const recentBookings = await Booking.find().sort({ createdAt: -1 }).limit(10).select('bookingId customerId customerName status categoryName restaurantId partnerId providerId createdAt').lean();
  console.log('--- RECENT BOOKINGS ---');
  console.log(JSON.stringify(recentBookings, null, 2));

  await mongoose.disconnect();
}

check().catch(console.error);
