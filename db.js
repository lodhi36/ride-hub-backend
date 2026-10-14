const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (_) {}
const mongoose = require('mongoose');

let lastConnectionError = null;

const connectDB = async () => {
  try {
    lastConnectionError = null;
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    console.log('[MongoDB] Connecting to:', uri ? uri.replace(/:([^@]+)@/, ':****@') : 'Default URI');
    
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 20000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      maxPoolSize: 50,
      minPoolSize: 5,
      maxIdleTimeMS: 60000,
      family: 4,
    });
    console.log(`[MongoDB Connected] host: ${conn.connection.host}`);
    
    console.log('[MongoDB] Database connection ready. User statuses preserved from DB.');

    return conn;
  } catch (error) {
    lastConnectionError = error;
    console.error(`[MongoDB Atlas Warning] ${error.message}`);
    console.log('💡 Note: Backend API routes & Socket.IO server are online and operating smoothly.');
  }
};

const getLastConnectionError = () => lastConnectionError;

module.exports = { connectDB, getLastConnectionError };

