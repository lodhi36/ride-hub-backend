const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const dbUri = process.env.MONGO_URI || "mongodb+srv://sa:sachin@cluster0.ygqjec2.mongodb.net/datingapp?retryWrites=true&w=majority&appName=Cluster0";

async function setSimpleAdmin() {
  try {
    await mongoose.connect(dbUri);
    console.log('Connected to MongoDB');

    const User = require('./models/User');

    // Find any existing admin or admin@admin.com or username admin
    let admin = await User.findOne({ $or: [{ email: 'admin@admin.com' }, { username: 'admin' }, { isAdmin: true }] });

    if (admin) {
      console.log('Found existing admin:', admin.email);
      admin.email = 'admin@admin.com';
      admin.username = 'admin';
      admin.password = '123456';
      admin.isAdmin = true;
      admin.role = 'admin';
      admin.isProfileComplete = true;
      await admin.save();
      console.log('Updated existing admin user!');
    } else {
      console.log('No admin found, creating new admin...');
      admin = await User.create({
        email: 'admin@admin.com',
        username: 'admin',
        password: '123456',
        name: 'Admin',
        isAdmin: true,
        role: 'admin',
        isProfileComplete: true
      });
      console.log('Created new admin user!');
    }

    const isMatch = await admin.comparePassword('123456');
    console.log('Password verification test (123456):', isMatch);

    console.log('\n=======================================');
    console.log('✅ Admin credentials successfully set:');
    console.log('   Email / Username: admin@admin.com OR admin');
    console.log('   Password:         123456');
    console.log('=======================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Error setting admin:', error);
    process.exit(1);
  }
}

setSimpleAdmin();
