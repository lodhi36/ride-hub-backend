const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');

async function checkRestos() {
  try {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/datingapp';
    await mongoose.connect(uri);
    const users = await User.find({
      $or: [
        { role: { $in: ['supplier', 'seller_partner', 'provider', 'restaurant', 'Supplier', 'Seller', 'Restaurant'] } },
        { restaurantName: { $exists: true, $nin: ['', null] } }
      ]
    }).select('name restaurantName phone phoneNumber role latitude longitude locationCoords address fullAddress location');

    console.log("=== RESTAURANTS IN MONGODB ===");
    users.forEach(u => {
      console.log({
        id: u._id.toString(),
        name: u.name || u.restaurantName,
        role: u.role,
        latitude: u.latitude,
        longitude: u.longitude,
        locationCoords: u.locationCoords,
        address: u.fullAddress || u.address || u.location
      });
    });
    process.exit(0);
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

checkRestos();
