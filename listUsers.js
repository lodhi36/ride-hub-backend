const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./src/models/User');

async function listUsers() {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
        const users = await User.find().select('username email name isAdmin');
        console.log("USERS IN MONGODB:");
        console.table(users.map(u => ({
            id: u._id.toString(),
            name: u.name,
            username: u.username,
            email: u.email,
            isAdmin: u.isAdmin
        })));
        process.exit(0);
    } catch (e) {
        console.error("Error fetching users:", e);
        process.exit(1);
    }
}

listUsers();
