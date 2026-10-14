const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const User = require('./src/models/User');

async function testAdmin() {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
        const admin = await User.findOne({ email: 'admin@admin.com' });
        if (!admin) {
            console.log("Admin user not found.");
            process.exit(1);
        }
        console.log("Admin user found:");
        console.log("isAdmin:", admin.isAdmin);
        console.log("Password hash:", admin.password);
        
        const isMatch = await bcrypt.compare('adminpassword123', admin.password);
        console.log("Does 'adminpassword123' match?", isMatch);

        // Also test the method on the schema
        const isMatchMethod = await admin.comparePassword('adminpassword123');
        console.log("Does method match?", isMatchMethod);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
testAdmin();
