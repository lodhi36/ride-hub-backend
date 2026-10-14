const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (_) {}
const mongoose = require('mongoose');
const User = require('./models/User');

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(uri);
  const users = await User.find({}).select('name email phoneNumber role partnerType latitude longitude isOnline rider_status isAvailable').lean();
  console.log('--- ALL USERS IN ATLAS ---');
  for (const u of users) {
    console.log(`[USER] ID: ${u._id}, Name: ${u.name}, Phone: ${u.phoneNumber}, Role: ${u.role}, Status: ${u.rider_status || (u.isOnline ? 'online' : 'offline')}, Lat: ${u.latitude}, Lon: ${u.longitude}`);
  }
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
