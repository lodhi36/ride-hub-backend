require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Booking = require('./models/Booking');

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);

  const customer = await User.findById('6aa0b890ba2a908d4bc3fc00').lean();
  console.log('--- CUSTOMER USER ---');
  console.log(JSON.stringify({
    name: customer?.name,
    latitude: customer?.latitude,
    longitude: customer?.longitude,
    locationCoords: customer?.locationCoords,
    address: customer?.address,
    location: customer?.location
  }, null, 2));

  const rider = await User.findOne({ role: 'delivery_partner', isOnline: true }).lean();
  console.log('--- ONLINE RIDER ---');
  console.log(JSON.stringify({
    id: rider?._id,
    name: rider?.name,
    latitude: rider?.latitude,
    longitude: rider?.longitude,
    locationCoords: rider?.locationCoords,
    address: rider?.address,
    location: rider?.location
  }, null, 2));

  await mongoose.disconnect();
}
test().catch(console.error);
