const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const Booking = require('../models/Booking');

async function testQuery() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected');
  const uStr = '6a9e2a264ab525ab1d351943';
  console.log('Querying supplierId:', uStr);
  const t0 = Date.now();
  const res = await Booking.find({ supplierId: uStr }).limit(10).lean();
  console.log('Query took ms:', Date.now() - t0, 'results count:', res.length);
  await mongoose.disconnect();
}
testQuery().catch(console.error);
