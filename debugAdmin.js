const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./src/models/User');

dotenv.config();

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected');

    const adminEmail = 'admin@admin.com';
    const existingAdmin = await User.findOne({ email: adminEmail });

    if (existingAdmin) {
      console.log('Admin user already exists');
      process.exit();
    }

    const adminUser = new User({
      email: adminEmail,
      username: 'admin',
      password: 'adminpassword123',
      name: 'Super Admin',
      isAdmin: true,
      isProfileComplete: true
    });

    const saved = await adminUser.save();
    console.log('Admin user SAVED:', saved);
    process.exit();
  } catch (error) {
    console.error('Error creating admin:', error);
    process.exit(1);
  }
};

createAdmin();
