const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const dbUri = "mongodb+srv://sa:sachin@cluster0.ygqjec2.mongodb.net/datingapp?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(dbUri).then(async () => {
  const User = require('./models/User');
  let admin = await User.findOne({ isAdmin: true });
  
  if (admin) {
    console.log("Admin exists. Email:", admin.email);
    console.log("Updating password to '12345678' for convenience...");
    admin.password = '12345678'; // Let pre-save hook hash it
    await admin.save();
    console.log("Password updated successfully.");
  } else {
    console.log("No admin found. Creating default admin...");
    admin = await User.create({
      email: 'admin@admin.com',
      username: 'admin',
      password: 'password123',
      isAdmin: true,
      role: 'admin',
      isProfileComplete: true
    });
    console.log("Created admin. Email: admin@admin.com, Password: password123");
  }
  process.exit(0);
}).catch(err => {
  console.error("DB Error:", err);
  process.exit(1);
});
