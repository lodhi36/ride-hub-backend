const mongoose = require('mongoose');

async function checkLatestBookings() {
  await mongoose.connect('mongodb+srv://sac:sa@cluster0.4y6prsz.mongodb.net/datingapp?retryWrites=true&w=majority&appName=Cluster0');
  const Booking = mongoose.model('Booking', new mongoose.Schema({}, { strict: false }));
  
  const bookings = await Booking.find().sort({ createdAt: -1 }).limit(5).lean();
  console.log('=== LATEST 5 BOOKINGS IN DB ===');
  bookings.forEach(b => {
    console.log({
      bookingId: b.bookingId,
      status: b.status,
      restaurantName: b.restaurantName,
      supplierId: b.supplierId || b.restaurantId,
      pickupLatitude: b.pickupLatitude,
      pickupLongitude: b.pickupLongitude,
      supplierBusinessLatitude: b.supplierBusinessLatitude,
      supplierBusinessLongitude: b.supplierBusinessLongitude,
      pickupLocation: b.pickupLocation,
      customerLatitude: b.customerLatitude,
      customerLongitude: b.customerLongitude,
      dropLocation: b.dropLocation,
      createdAt: b.createdAt
    });
  });
  process.exit(0);
}

checkLatestBookings().catch(console.error);
