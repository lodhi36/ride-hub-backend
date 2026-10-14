const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');

async function resetUserPassword() {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
        
        // 1. Delivery Partner (Rahul - 8989898989)
        const rider = await User.findOne({ phoneNumber: '8989898989' });
        if (rider) {
            rider.password = '123456';
            await rider.save();
            console.log(`[DELIVERY PARTNER] Name: ${rider.name} | Phone: ${rider.phoneNumber} | Password: 123456`);
        }

        // 2. Customer (Amit Sharma - 9876543210)
        const customer = await User.findOne({ phoneNumber: '9876543210' });
        if (customer) {
            customer.password = '123456';
            await customer.save();
            console.log(`[CUSTOMER] Name: ${customer.name} | Phone: ${customer.phoneNumber} | Password: 123456`);
        }

        // 3. Customer 2 (Sachin - 9999999999)
        const customer2 = await User.findOne({ phoneNumber: '9999999999' });
        if (customer2) {
            customer2.password = '123456';
            await customer2.save();
            console.log(`[CUSTOMER 2] Name: ${customer2.name} | Phone: ${customer2.phoneNumber} | Password: 123456`);
        }

        process.exit(0);
    } catch (e) {
        console.error("Error resetting password:", e);
        process.exit(1);
    }
}
resetUserPassword();
