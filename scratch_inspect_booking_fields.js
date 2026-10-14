const mongoose = require('mongoose');
require('dotenv').config({ path: __dirname + '/.env' });

const uri = process.env.MONGO_URI;

async function check() {
  await mongoose.connect(uri);
  const Booking = mongoose.model('Booking', new mongoose.Schema({}, { strict: false }));

  const docs = await Booking.find({
    $or: [
      { supplierId: '6a9e2a264ab525ab1d351943' },
      { restaurantId: '6a9e2a264ab525ab1d351943' },
      { partnerId: '6a9e2a264ab525ab1d351943' },
      { providerId: '6a9e2a264ab525ab1d351943' },
    ]
  }).sort({ createdAt: -1 }).limit(5).lean();

  console.log(`Found ${docs.length} bookings for supplier 6a9e2a264ab525ab1d351943:`);
  docs.forEach((b, i) => {
    console.log(`\n--- Booking ${i + 1} ---`);
    console.log({
      _id: b._id,
      bookingId: b.bookingId,
      rideId: b.rideId,
      status: b.status,
      customerName: b.customerName,
      restaurantName: b.restaurantName,
      supplierCategory: b.supplierCategory,
      categoryName: b.categoryName,
      price: b.price,
      subtotal: b.subtotal,
      hasCartItems: Boolean(b.cartItems),
      createdAt: b.createdAt
    });
  });

  process.exit(0);
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});
