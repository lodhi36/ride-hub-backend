require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    const Booking = mongoose.model('Booking', new mongoose.Schema({}, { strict: false }));

    const suppUser = await User.findById('6a9e2a264ab525ab1d351943').lean();
    console.log('=== SUPPLIER USER IN DB ===');
    console.log('name:', suppUser?.name);
    console.log('restaurantName:', suppUser?.restaurantName);
    console.log('latitude:', suppUser?.latitude);
    console.log('longitude:', suppUser?.longitude);
    console.log('businessLatitude:', suppUser?.businessLatitude);
    console.log('businessLongitude:', suppUser?.businessLongitude);
    console.log('locationCoords:', suppUser?.locationCoords);
    console.log('address:', suppUser?.address);
    console.log('businessAddress:', suppUser?.businessAddress);
    console.log('fullAddress:', suppUser?.fullAddress);
    console.log('location:', suppUser?.location);

    const custUser = await User.findById('6a9e43224ab525ab1d3522f9').lean();
    console.log('\n=== CUSTOMER USER IN DB ===');
    console.log('name:', custUser?.name);
    console.log('latitude:', custUser?.latitude);
    console.log('longitude:', custUser?.longitude);
    console.log('address:', custUser?.address);
    console.log('fullAddress:', custUser?.fullAddress);

    const latestBookings = await Booking.find({}).sort({ createdAt: -1 }).limit(3).lean();
    console.log('\n=== LATEST 3 BOOKINGS ===');
    for (const b of latestBookings) {
      console.log('--- Booking:', b.bookingId || b._id, '---');
      console.log('pickupLatitude:', b.pickupLatitude);
      console.log('pickupLongitude:', b.pickupLongitude);
      console.log('pickupLocation:', b.pickupLocation);
      console.log('destinationLatitude:', b.destinationLatitude);
      console.log('destinationLongitude:', b.destinationLongitude);
      console.log('dropLocation:', b.dropLocation);
      console.log('pickupAddress:', b.pickupAddress);
      console.log('destinationAddress:', b.destinationAddress);
      
      // Calculate distance between pickup and destination
      const pLat = b.pickupLatitude || b.pickupLocation?.latitude;
      const pLon = b.pickupLongitude || b.pickupLocation?.longitude;
      const dLat = b.destinationLatitude || b.dropLocation?.latitude;
      const dLon = b.destinationLongitude || b.dropLocation?.longitude;
      if (pLat && pLon && dLat && dLon) {
        const R = 6371;
        const dLatR = (dLat - pLat) * Math.PI / 180;
        const dLonR = (dLon - pLon) * Math.PI / 180;
        const a = Math.sin(dLatR / 2) ** 2 + Math.cos(pLat * Math.PI / 180) * Math.cos(dLat * Math.PI / 180) * Math.sin(dLonR / 2) ** 2;
        const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        console.log(`Calculated Distance between Pickup & Drop: ${distKm.toFixed(3)} km (${Math.round(distKm * 1000)} meters)`);
      }
    }
  } catch (e) {
    console.error('Error:', e);
  } finally {
    process.exit(0);
  }
}
run();
