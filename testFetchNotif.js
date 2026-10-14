const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const dbUri = process.env.MONGO_URI || "mongodb+srv://sa:sachin@cluster0.ygqjec2.mongodb.net/datingapp?retryWrites=true&w=majority&appName=Cluster0";

async function testFetch() {
  try {
    await mongoose.connect(dbUri);
    const AdminNotification = require('./models/AdminNotification');
    const Notification = require('./models/Notification');

    let notifications = await AdminNotification.find().sort({ createdAt: -1 });
    console.log("AdminNotification items count:", notifications.length);

    if (notifications.length === 0) {
      const userNotifs = await Notification.find({ isAdminNotification: true }).sort({ createdAt: -1 });
      console.log("Fallback userNotifs count:", userNotifs.length);
    } else {
      console.log("History items:", notifications.map(n => ({ id: n._id, title: n.title, text: n.text, sentTo: n.sentTo })));
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

testFetch();
