const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://datingapp:datingapp%40123@cluster0.k2hhy.mongodb.net/datingapp?retryWrites=true&w=majority&appName=Cluster0');
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const riders = await User.find({ role: { $in: ['rider', 'delivery', 'RIDER', 'DELIVERY'] } }).limit(5).lean();
  console.log('Riders found:', riders.map(r => ({ id: r._id, name: r.name || r.username, phone: r.phoneNumber, role: r.role })));
  process.exit(0);
}

check().catch(e => { console.error(e); process.exit(1); });
