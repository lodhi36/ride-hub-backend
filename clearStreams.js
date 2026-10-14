const mongoose = require('mongoose');
require('dotenv').config();
const LiveStream = require('./models/LiveStream');

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
        const res = await LiveStream.deleteMany({});
        console.log(`Cleared ${res.deletedCount} old live stream(s).`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
run();
