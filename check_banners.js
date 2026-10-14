const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Banner = require('./models/Banner');
  const allBanners = await Banner.find({});
  console.log('ALL BANNERS IN DB (' + allBanners.length + '):');
  allBanners.forEach(b => {
    console.log(`ID: ${b._id} | Target: ${b.target} | Status: ${b.status} | URL: ${b.imageUrl}`);
  });
  process.exit(0);
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
