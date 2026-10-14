const mongoose = require('mongoose');
const User = require('./models/User');

mongoose.connect('mongodb://localhost:27017/dating_app').then(async () => {
  const users = await User.find({}).select('name username phoneNumber role partnerType restaurantName isOnline approvalStatus').lean();
  console.log(`Found ${users.length} users:`);
  users.forEach(u => console.log(u));
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
