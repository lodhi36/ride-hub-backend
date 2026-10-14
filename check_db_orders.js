const mongoose = require('mongoose');
require('dotenv').config();
const Booking = require('./models/Booking');
const User = require('./models/User');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');
  const count = await Booking.countDocuments();
  console.log('Total bookings:', count);

  const bookings = await Booking.find({}).sort({ createdAt: -1 }).limit(15).lean();
  console.log('Latest 15 bookings:');
  bookings.forEach(b => {
    console.log({
      _id: b._id.toString(),
      bookingId: b.bookingId,
      status: b.status,
      userId: b.userId?.toString(),
      providerId: b.providerId?.toString(),
      restaurantId: b.restaurantId?.toString(),
      partnerId: b.partnerId?.toString(),
      customerName: b.customerName || b.userName,
      serviceName: b.serviceName,
      itemsCount: b.items?.length,
      createdAt: b.createdAt
    });
  });

  const users = await User.find({}).lean();
  console.log('Users in DB:');
  users.forEach(u => {
    console.log({
      id: u._id.toString(),
      phone: u.phone,
      name: u.name,
      role: u.role,
      restaurant_name: u.restaurant_name,
      partner_type: u.partner_type
    });
  });

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
