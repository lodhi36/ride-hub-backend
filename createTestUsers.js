const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');

async function createTestUsers() {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
        
        // Remove old test users if they exist
        await User.deleteMany({ email: { $in: ['device1@test.com', 'device2@test.com'] } });

        const user1 = new User({
            username: 'device1',
            email: 'device1@test.com',
            password: 'password123',
            name: 'Device One',
            firstName: 'Device',
            lastName: 'One',
            gender: 'Male',
            dob: new Date('1990-01-01')
        });

        const user2 = new User({
            username: 'device2',
            email: 'device2@test.com',
            password: 'password123',
            name: 'Device Two',
            firstName: 'Device',
            lastName: 'Two',
            gender: 'Female',
            dob: new Date('1992-01-01')
        });

        await user1.save();
        await user2.save();

        console.log("Created Test Users Successfully!");
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
createTestUsers();
