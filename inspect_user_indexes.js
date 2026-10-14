const mongoose = require('./node_modules/mongoose');
const path = require('path');
require('./node_modules/dotenv').config({ path: path.join(__dirname, '.env') });

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  console.log('Connecting to Mongo...');
  await mongoose.connect(uri);
  console.log('Connected to MongoDB Atlas.');

  const collection = mongoose.connection.collection('users');
  const indexes = await collection.indexes();
  console.log('CURRENT INDEXES ON users:');
  indexes.forEach(idx => {
    console.log(`- Name: ${idx.name}, Keys: ${JSON.stringify(idx.key)}, Unique: ${idx.unique || false}`);
  });

  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
