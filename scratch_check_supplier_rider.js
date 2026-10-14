const mongoose = require('mongoose');
require('dotenv').config({ path: __dirname + '/.env' });

async function check() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  
  const supplier = await User.findById('6a9e2a264ab525ab1d351943').lean();
  console.log('=== SUPPLIER (Kk) ===');
  console.log(JSON.stringify(supplier, null, 2));

  const rider = await User.findById('6aa0b890ba2a908d4bc3fc00').lean();
  console.log('\n=== RIDER (Rahul) ===');
  console.log(JSON.stringify(rider, null, 2));

  process.exit(0);
}

check().catch(e => { console.error(e); process.exit(1); });
