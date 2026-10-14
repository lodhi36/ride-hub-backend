const mongoose = require('mongoose');

async function run() {
  const uri = 'mongodb+srv://sac:sa@cluster0.4y6prsz.mongodb.net/datingapp?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri);
  const Booking = mongoose.model('Booking', new mongoose.Schema({}, { strict: false }));
  
  const b = await Booking.findOne({ bookingId: 'ride_1791002502755' }).lean();
  console.log('=== BOOKING ride_1791002502755 ===');
  console.log(JSON.stringify(b, null, 2));

  const latest5 = await Booking.find().sort({ createdAt: -1 }).limit(5).lean();
  console.log('=== LATEST 5 BOOKINGS ===');
  latest5.forEach(bk => {
    console.log({
      bookingId: bk.bookingId,
      status: bk.status,
      restaurantId: bk.restaurantId,
      providerId: bk.providerId,
      supplierId: bk.supplierId,
      categoryName: bk.categoryName,
      restaurantName: bk.restaurantName,
      createdAt: bk.createdAt
    });
  });

  process.exit(0);
}

run().catch(console.error);
