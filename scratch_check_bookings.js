const mongoose = require('mongoose');
require('dotenv').config();
const Booking = require('./models/Booking');

async function checkBookings() {
  try {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/datingapp';
    await mongoose.connect(uri);
    const bookings = await Booking.find({}).sort({ createdAt: -1 }).limit(10).lean();
    console.log("=== LATEST 10 BOOKINGS IN MONGODB ===");
    bookings.forEach(b => {
      console.log({
        id: b._id.toString(),
        bookingId: b.bookingId,
        customerName: b.customerName,
        customerId: b.customerId,
        restaurantName: b.restaurantName,
        providerId: b.providerId,
        status: b.status,
        price: b.price,
        createdAt: b.createdAt
      });
    });
    process.exit(0);
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

checkBookings();
