const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/datingapp';

async function inspectUsers() {
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;
    const users = await db.collection('users').find({}).toArray();
    
    console.log('ID | Name | Phone | role | isOnline | rider_status | restaurant_status | partnerId | restaurantName');
    console.log('---------------------------------------------------------------------------------------------------');
    users.forEach(u => {
      console.log(`${u._id} | ${u.name || u.fullName || 'N/A'} | ${u.phoneNumber || u.phone || 'N/A'} | role: ${u.role} | online: ${u.isOnline} | rider_st: ${u.rider_status} | resto_st: ${u.restaurant_status} | partnerId: ${u.partnerId || '-'} | store: ${u.restaurantName || '-'}`);
    });

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
inspectUsers();
