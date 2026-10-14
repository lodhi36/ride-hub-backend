const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (_) {}
const mongoose = require('mongoose');
require('dotenv').config();
const Booking = require('./models/Booking');

async function t() {
  const start = Date.now();
  console.log('Connecting...');
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 20000,
  });
  console.log('Connected in', Date.now() - start, 'ms');
  const b = await Booking.find({}).limit(5).lean();
  console.log('Found', b.length, 'bookings in', Date.now() - start, 'ms');
  
  const suppBookings = await Booking.find({
    $or: [
      { providerId: '6a9e2a264ab525ab1d351943' },
      { restaurantId: '6a9e2a264ab525ab1d351943' },
      { partnerId: '6a9e2a264ab525ab1d351943' }
    ]
  }).lean();
  console.log('Found supplier bookings:', suppBookings.length);
  suppBookings.slice(0, 5).forEach(sb => {
    console.log('Booking:', {
      bookingId: sb.bookingId,
      status: sb.status,
      customerName: sb.customerName || sb.userName,
      serviceName: sb.serviceName,
      createdAt: sb.createdAt
    });
  });
  process.exit(0);
}
t().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
