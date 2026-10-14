const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');

async function listDBUsers() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('MongoDB Connected');

    const users = await User.find({});
    console.log(`\n--- ALL USER DOCUMENTS IN DB (${users.length}) ---`);
    users.forEach((u, idx) => {
      console.log(`${idx + 1}. ID: ${u._id} | Name: ${u.name} | Phone: ${u.phoneNumber} | Email: ${u.email} | Username: ${u.username} | Role: ${u.role} | PartnerType: ${u.partnerType} | Vehicle: ${u.vehicleType}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error listing users:', error);
    process.exit(1);
  }
}

listDBUsers();
