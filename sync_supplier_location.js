require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    const Booking = mongoose.model('Booking', new mongoose.Schema({}, { strict: false }));

    const cust = await User.findById('6a9e43224ab525ab1d3522f9').lean();
    console.log('Customer GPS:', cust.latitude, cust.longitude, cust.address);

    const realLat = cust.latitude || 23.3442344;
    const realLon = cust.longitude || 77.4071535;
    const realAddr = 'Arwaliya, Islamnagar, Huzur Tahsil, Bhopal';

    const updatedSupp = await User.findByIdAndUpdate(
      '6a9e2a264ab525ab1d351943',
      {
        $set: {
          latitude: realLat,
          longitude: realLon,
          businessLatitude: realLat,
          businessLongitude: realLon,
          locationCoords: { latitude: realLat, longitude: realLon },
          address: realAddr,
          businessAddress: realAddr,
          fullAddress: realAddr,
          location: realAddr,
          businessLocation: realAddr,
          currentDeviceLocation: {
            latitude: realLat,
            longitude: realLon,
            address: realAddr,
            timestamp: new Date()
          }
        }
      },
      { new: true }
    );

    console.log('=== UPDATED SUPPLIER IN DB ===');
    console.log('id:', updatedSupp._id);
    console.log('name:', updatedSupp.name);
    console.log('businessLatitude:', updatedSupp.businessLatitude);
    console.log('businessLongitude:', updatedSupp.businessLongitude);
    console.log('businessAddress:', updatedSupp.businessAddress);

    // Also update existing active bookings for this supplier so current order tracking immediately reflects real spot!
    const updatedBookings = await Booking.updateMany(
      {
        $or: [
          { restaurantId: '6a9e2a264ab525ab1d351943' },
          { providerId: '6a9e2a264ab525ab1d351943' }
        ],
        status: { $in: ['PENDING_RESTAURANT', 'RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'ACCEPTED'] }
      },
      {
        $set: {
          pickupLatitude: realLat,
          pickupLongitude: realLon,
          restaurantLatitude: realLat,
          restaurantLongitude: realLon,
          pickupAddress: realAddr,
          supplierBusinessLatitude: realLat,
          supplierBusinessLongitude: realLon,
          supplierBusinessAddress: realAddr,
          'pickupLocation.latitude': realLat,
          'pickupLocation.longitude': realLon,
          'pickupLocation.address': realAddr,
        }
      }
    );
    console.log('Updated active bookings:', updatedBookings.modifiedCount);
  } catch (e) {
    console.error('Error:', e);
  } finally {
    process.exit(0);
  }
}
run();
