const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/datingapp';

async function checkRealData() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to DB:', MONGO_URI);
    const db = mongoose.connection.db;
    
    // Check users collection
    const users = await db.collection('users').find({}).toArray();
    console.log('\n==========================================');
    console.log('       REAL DATABASE RECORDS IN MONGODB    ');
    console.log('==========================================');
    console.log('Total Raw Users in DB:', users.length);
    
    const riders = users.filter(u => u.role === 'rider' || u.role === 'delivery_partner' || u.partnerId || u.vehicleType);
    const suppliers = users.filter(u => u.role === 'supplier' || u.role === 'restaurant' || u.restaurantName || u.businessCategoryName);
    const customers = users.filter(u => !riders.includes(u) && !suppliers.includes(u) && u.role !== 'admin');
    
    console.log(`\n🏍️ REAL RIDERS COUNT: ${riders.length}`);
    riders.forEach((r, i) => {
      console.log(`[Rider #${i+1}] Name: ${r.name || r.fullName || 'N/A'} | Phone: ${r.phoneNumber || r.phone || 'N/A'} | isOnline: ${Boolean(r.isOnline)} | rider_status: ${r.rider_status || 'offline'} | Zone: ${r.selectedZone || r.zone || 'None'} | Vehicle: ${r.vehicleType || 'Bike'} | Coordinates: ${JSON.stringify(r.location?.coordinates || r.coordinates || [])}`);
    });
    
    console.log(`\n🏪 REAL SUPPLIERS/STORES COUNT: ${suppliers.length}`);
    suppliers.forEach((s, i) => {
      console.log(`[Supplier #${i+1}] Store: ${s.restaurantName || s.name || 'N/A'} | Phone: ${s.phoneNumber || s.phone || 'N/A'} | Category: ${s.businessCategoryName || s.categoryName || 'N/A'} | isOnline: ${Boolean(s.isOnline)} | restaurant_status: ${s.restaurant_status || 'offline'} | Approval: ${s.approvalStatus || 'APPROVED'}`);
    });

    console.log(`\n👤 REAL CUSTOMERS / ACTIVE USERS COUNT: ${customers.length}`);
    customers.slice(0, 15).forEach((c, i) => {
      console.log(`[Customer #${i+1}] Name: ${c.name || c.username || 'User'} | Phone: ${c.phoneNumber || c.phone || 'N/A'} | isOnline: ${Boolean(c.isOnline)} | Role: ${c.role || 'customer'}`);
    });

    // Check partners collection
    const partnerCol = await db.collection('partners').find({}).toArray();
    if (partnerCol.length > 0) {
      console.log(`\n🏍️ PARTNERS COLLECTION: ${partnerCol.length}`);
      partnerCol.forEach(p => console.log(`- Partner: ${p.name || p.fullName} | Phone: ${p.phone || p.phoneNumber} | Online: ${p.isOnline}`));
    }

    // Check restaurants collection
    const restoCol = await db.collection('restaurants').find({}).toArray();
    if (restoCol.length > 0) {
      console.log(`\n🏪 RESTAURANTS COLLECTION: ${restoCol.length}`);
      restoCol.forEach(r => console.log(`- Restaurant: ${r.name || r.restaurantName} | Phone: ${r.phone || r.phoneNumber} | Online: ${r.isOnline}`));
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}
checkRealData();
