const mongoose = require('mongoose');
const User = require('./src/models/User');

const dbUri = "mongodb+srv://sa:sachin@cluster0.ygqjec2.mongodb.net/datingapp?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(dbUri).then(async () => {
  console.log('Connected to DB');
  const admins = await User.find({ isAdmin: true }).select('email username _id role isAdmin');
  console.log('Admins:', admins);
  
  if (admins.length > 0) {
    const bcrypt = require('bcryptjs');
    const admin = await User.findById(admins[0]._id);
    
    admin.password = await bcrypt.hash('12345678', 10);
    await admin.save();
    console.log(`Password reset for ${admin.email} to '12345678'`);
  } else {
    // Create an admin if none exists
    const bcrypt = require('bcryptjs');
    const admin = await User.create({
      email: 'admin@admin.com',
      username: 'admin',
      password: await bcrypt.hash('12345678', 10),
      isAdmin: true,
      role: 'admin',
      isProfileComplete: true
    });
    console.log("Created admin:", admin.email, 'password: 12345678');
  }
  process.exit();
}).catch(e => {
  console.error(e);
  process.exit(1);
});
