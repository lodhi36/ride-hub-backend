require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const suppliers = await User.find({
    role: { $in: ['supplier', 'seller_partner', 'provider', 'restaurant', 'store', 'partner'] }
  });
  console.log('Suppliers count:', suppliers.length);
  suppliers.forEach(s => {
    console.log('SUPPLIER:', JSON.stringify({
      id: s._id,
      name: s.fullName || s.name || s.restaurantName,
      role: s.role,
      isOnline: s.isOnline,
      restaurant_status: s.restaurant_status,
      businessLatitude: s.businessLatitude,
      businessLongitude: s.businessLongitude,
      latitude: s.latitude,
      longitude: s.longitude
    }));
  });

  const riders = await User.find({
    role: { $in: ['rider', 'driver', 'delivery_partner'] }
  });
  console.log('Riders count:', riders.length);
  riders.forEach(r => {
    console.log('RIDER:', JSON.stringify({
      id: r._id,
      name: r.fullName || r.name,
      role: r.role,
      isOnline: r.isOnline,
      latitude: r.latitude,
      longitude: r.longitude
    }));
  });

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
