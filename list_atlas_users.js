require('dotenv').config({ path: 'C:/Users/pc/Downloads/datin/datin/backend 3/.env' });
const mongoose = require('mongoose');
const User = require('C:/Users/pc/Downloads/datin/datin/backend 3/models/User');

const uri = process.env.MONGODB_URI;

mongoose.connect(uri).then(async () => {
  const users = await User.find({}).select('name username phoneNumber role partnerType restaurantName isOnline approvalStatus').lean();
  console.log(`Found ${users.length} users:`);
  users.forEach(u => console.log(JSON.stringify(u)));
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
