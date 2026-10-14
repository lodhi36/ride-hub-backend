const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  console.log('Connecting with URI:', uri.replace(/:([^:@]+)@/, ':****@'));
  await mongoose.connect(uri);
  
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Booking = mongoose.model('Booking', new mongoose.Schema({}, { strict: false }));
  
  const suppliers = await User.find({
    $or: [
      { role: { $in: ['supplier', 'seller_partner', 'restaurant', 'provider', 'store'] } },
      { partnerType: { $exists: true, $ne: '' } },
      { restaurantName: { $exists: true, $ne: '' } }
    ]
  }).lean();

  console.log(`=== FOUND ${suppliers.length} SUPPLIERS ===`);
  suppliers.forEach(s => {
    console.log(JSON.stringify({
      _id: s._id,
      name: s.name,
      restaurantName: s.restaurantName,
      role: s.role,
      partnerType: s.partnerType,
      isOnline: s.isOnline,
      restaurant_status: s.restaurant_status,
      phone: s.phone || s.phoneNumber,
    }));
  });

  const recent = await Booking.find().sort({ createdAt: -1 }).limit(5).lean();
  console.log(`=== RECENT 5 BOOKINGS ===`);
  recent.forEach(b => {
    console.log(JSON.stringify({
      bookingId: b.bookingId,
      customerId: b.customerId,
      restaurantId: b.restaurantId,
      providerId: b.providerId,
      status: b.status,
      categoryName: b.categoryName,
      createdAt: b.createdAt
    }));
  });

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
