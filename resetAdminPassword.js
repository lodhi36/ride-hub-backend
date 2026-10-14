const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./src/models/User');

dotenv.config();

const resetAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected');

    const adminEmail = 'admin@admin.com';
    let admin = await User.findOne({ email: adminEmail });

    if (!admin) {
      console.log('Admin not found, creating new...');
      admin = new User({
        email: adminEmail,
        username: 'admin',
        password: 'adminpassword123',
        name: 'Super Admin',
        isAdmin: true,
        role: 'admin',
        isProfileComplete: true
      });
    } else {
      console.log('Admin found, updating password...');
      admin.password = 'adminpassword123';
      admin.isAdmin = true;
      admin.role = 'admin';
    }

    await admin.save();
    console.log('Admin password forcefully updated to: adminpassword123');

    // Test comparison immediately
    const isMatch = await admin.comparePassword('adminpassword123');
    console.log('Does password match after save? ' + isMatch);

    process.exit();
  } catch (error) {
    console.error('Error resetting admin:', error);
    process.exit(1);
  }
};

resetAdmin();
