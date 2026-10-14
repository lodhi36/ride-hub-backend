const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');

async function removeDummyUsers() {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
        
        // Remove users with @test.com or @example.com emails which are typical for dummy data
        const result = await User.deleteMany({ email: { $regex: /@(test|example)\.com$/i } });
        
        console.log(`Successfully removed ${result.deletedCount} dummy user(s).`);
        process.exit(0);
    } catch (e) {
        console.error("Error removing dummy users:", e);
        process.exit(1);
    }
}

removeDummyUsers();
