const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('./models/User');
  const Notification = require('./models/Notification');

  const customers = await User.find({ role: 'customer' });
  console.log(`=== CUSTOMERS AND THEIR NOTIFICATION COUNTS ===`);
  for (const c of customers) {
    const notifs = await Notification.find({ receiver: c._id }).sort({ createdAt: -1 });
    console.log(`\nCustomer: ${c.name} (${c._id}) -> ${notifs.length} notifications:`);
    notifs.forEach(n => console.log(`  - [${n.createdAt.toISOString()}] [${n.type}] ${n.title || ''}: ${n.text}`));
  }
  process.exit(0);
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
