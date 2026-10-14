const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/datingapp';

async function clearQueries() {
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    const collections = await db.listCollections().toArray();
    console.log('Available collections:', collections.map(c => c.name));

    // Support query/case/ticket/report collections
    const queryCollectionNames = [
      'supportcases',
      'support_cases',
      'cases',
      'tickets',
      'supporttickets',
      'support_tickets',
      'queries',
      'supportqueries',
      'reports',
      'complaints',
      'supportchats',
      'support_chats',
      'supportmessages',
      'support_messages'
    ];

    let totalDeleted = 0;

    for (const colName of queryCollectionNames) {
      if (collections.some(c => c.name.toLowerCase() === colName)) {
        const count = await db.collection(colName).countDocuments({});
        if (count > 0) {
          const res = await db.collection(colName).deleteMany({});
          console.log(`🧹 Cleared ${res.deletedCount} items from collection: ${colName}`);
          totalDeleted += res.deletedCount;
        } else {
          console.log(`ℹ️ Collection ${colName} is already empty (0 items).`);
        }
      }
    }

    // Also check if any model has support queries
    for (const col of collections) {
      if (!queryCollectionNames.includes(col.name.toLowerCase()) && 
          (col.name.toLowerCase().includes('support') || col.name.toLowerCase().includes('query') || col.name.toLowerCase().includes('case') || col.name.toLowerCase().includes('ticket'))) {
        const count = await db.collection(col.name).countDocuments({});
        console.log(`Found matching collection: ${col.name} with ${count} items`);
        if (count > 0) {
          const res = await db.collection(col.name).deleteMany({});
          console.log(`🧹 Cleared ${res.deletedCount} items from collection: ${col.name}`);
          totalDeleted += res.deletedCount;
        }
      }
    }

    console.log(`\n🎉 Total Support Queries/Cases/Tickets cleared from MongoDB: ${totalDeleted}`);
    process.exit(0);
  } catch (err) {
    console.error('Error clearing queries:', err);
    process.exit(1);
  }
}

clearQueries();
