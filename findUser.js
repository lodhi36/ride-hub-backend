const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./src/models/User');

async function findUser() {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
        const users = await User.find({ email: { $regex: /jj@gmail/i } });
        console.log("FOUND USERS:");
        console.log(users);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
findUser();
