require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const User = require('./src/models/User');
  const users = await User.find({});
  console.log("--- PASSWORDS IN DB ---");
  users.forEach(u => console.log(u.email + ' : ' + u.password));
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
