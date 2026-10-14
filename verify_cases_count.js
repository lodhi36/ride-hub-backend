const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const count = await mongoose.connection.db.collection('supportcases').countDocuments();
  console.log('Verified: supportcases in MongoDB =', count);
  process.exit(0);
});
