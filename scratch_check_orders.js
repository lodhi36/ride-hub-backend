const mongoose = require('mongoose');
require('dotenv').config({ path: __dirname + '/.env' });

const uri = process.env.MONGO_URI;

async function check() {
  await mongoose.connect(uri);
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Booking = mongoose.model('Booking', new mongoose.Schema({}, { strict: false }));
  const Restaurant = mongoose.model('Restaurant', new mongoose.Schema({}, { strict: false }));

  console.log('=== User 6a9e43224ab525ab1d3522f9 ===');
  const u1 = await User.findById('6a9e43224ab525ab1d3522f9').lean();
  console.log(u1);

  console.log('=== User 6a9e2a264ab525ab1d351943 ===');
  const u2 = await User.findById('6a9e2a264ab525ab1d351943').lean();
  console.log(u2);

  const bookings = await Booking.find({}).sort({ createdAt: -1 }).limit(5).lean();
  console.log('=== Top 5 Bookings in DB ===');
  bookings.forEach(b => {
    console.log({
      _id: b._id,
      rideId: b.rideId,
      bookingType: b.bookingType,
      supplierId: b.supplierId,
      partnerId: b.partnerId,
      restaurantId: b.restaurantId,
      targetId: b.targetId,
      driverId: b.driverId,
      userId: b.userId,
      status: b.status,
      items: b.items,
      createdAt: b.createdAt
    });
  });

  process.exit(0);
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});
