const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const dbUri = process.env.MONGO_URI || "mongodb+srv://sa:sachin@cluster0.ygqjec2.mongodb.net/datingapp?retryWrites=true&w=majority&appName=Cluster0";

async function checkHistory() {
  try {
    await mongoose.connect(dbUri);
    console.log('Connected to MongoDB');

    const AdminNotification = require('./models/AdminNotification');

    let list = await AdminNotification.find().sort({ createdAt: -1 });
    console.log(`Found ${list.length} notifications in AdminNotification collection:`);
    console.log(JSON.stringify(list, null, 2));

    if (list.length === 0) {
      console.log('No history found. Inserting a test notification...');
      const test = await AdminNotification.create({
        title: 'Welcome to MatchAdmin',
        text: 'Test admin notification created to verify history display.',
        target: 'all_users',
        sentTo: 1
      });
      console.log('Created test notification:', test);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkHistory();
