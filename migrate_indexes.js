const mongoose = require('./node_modules/mongoose');
const path = require('path');
require('./node_modules/dotenv').config({ path: path.join(__dirname, '.env') });

async function migrate() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  console.log('Connecting to Mongo Atlas for migration...');
  await mongoose.connect(uri);
  console.log('Connected.');

  const collection = mongoose.connection.collection('users');
  const indexes = await collection.indexes();
  console.log('Existing indexes:', indexes.map(i => i.name));

  // 1. Drop global unique indexes if they exist
  const indexesToDrop = ['phoneNumber_1', 'username_1', 'email_1'];
  for (const idxName of indexesToDrop) {
    const exists = indexes.some(i => i.name === idxName);
    if (exists) {
      console.log(`Dropping index: ${idxName}...`);
      try {
        await collection.dropIndex(idxName);
        console.log(`Dropped ${idxName} successfully.`);
      } catch (e) {
        console.warn(`Could not drop ${idxName}:`, e.message);
      }
    }
  }

  // 2. Ensure existing users have distinct role-scoped usernames and emails if needed
  const users = await collection.find({}).toArray();
  console.log(`Analyzing ${users.length} existing users...`);
  for (const u of users) {
    let needsUpdate = false;
    const updates = {};
    const role = (u.role || 'customer').toLowerCase();

    // Check username: if it's purely 10-digit number and has role != customer
    if (u.username && /^\d{10}$/.test(u.username) && role !== 'customer') {
      updates.username = `${u.username}_${role}`;
      needsUpdate = true;
    }

    if (needsUpdate) {
      await collection.updateOne({ _id: u._id }, { $set: updates });
      console.log(`Updated user ${u._id} (${u.name || u.phoneNumber}): username -> ${updates.username}`);
    }
  }

  // 3. Create compound unique index on { phoneNumber: 1, role: 1 }
  try {
    console.log('Creating compound index: phoneNumber_1_role_1...');
    await collection.createIndex(
      { phoneNumber: 1, role: 1 },
      { unique: true, sparse: true, name: 'phoneNumber_1_role_1' }
    );
    console.log('Created phoneNumber_1_role_1 index successfully.');
  } catch (e) {
    console.warn('Notice creating phoneNumber_1_role_1 index:', e.message);
  }

  // 4. Create compound index on { username: 1, role: 1 }
  try {
    console.log('Creating compound index: username_1_role_1...');
    await collection.createIndex(
      { username: 1, role: 1 },
      { unique: true, sparse: true, name: 'username_1_role_1' }
    );
    console.log('Created username_1_role_1 index successfully.');
  } catch (e) {
    console.warn('Notice creating username_1_role_1 index:', e.message);
  }

  const finalIndexes = await collection.indexes();
  console.log('FINAL USER INDEXES:');
  finalIndexes.forEach(idx => {
    console.log(`- ${idx.name}: ${JSON.stringify(idx.key)} (unique: ${idx.unique || false})`);
  });

  console.log('Migration completed successfully!');
  process.exit(0);
}

migrate().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
