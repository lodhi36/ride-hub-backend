const mongoose = require('mongoose');
require('dotenv').config();

async function getUsers() {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
        const User = mongoose.connection.collection('users');
        const users = await User.find({}).limit(5).toArray();
        console.log("Found Users:");
        users.forEach(u => {
            console.log(`Email: ${u.email}`);
            console.log(`Phone: ${u.phone}`);
            console.log(`Name: ${u.name || u.firstName}`);
        });
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
getUsers();
