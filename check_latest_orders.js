const mongoose = require('mongoose');
require('dotenv').config();

async function checkOrders() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://datingapp:datingapp%40123@cluster0.k2hhy.mongodb.net/datingapp?retryWrites=true&w=majority&appName=Cluster0');
  const Booking = mongoose.model('Booking', new mongoose.Schema({}, { strict: false }));
  const latest = await Booking.find().sort({ createdAt: -1 }).limit(3).lean();
  console.log('Latest 3 Orders:');
  latest.forEach(b => {
    console.log(`- BookingID: ${b.bookingId || b._id}`);
    console.log(`  Status: ${b.status}, DeliveryStatus: ${b.deliveryStatus}, RiderStatus: ${b.riderStatus}`);
    console.log(`  Category: ${b.categoryName}, Store: ${b.restaurantName || b.supplierBusinessName}`);
    console.log(`  Customer: ${b.customerName}, Phone: ${b.customerPhone}`);
    console.log(`  Rider: ${b.riderName || b.riderId || 'None'}`);
    console.log(`  Total: ₹${b.totalAmount || b.price}, Fee: ₹${b.deliveryFee}`);
  });
  process.exit(0);
}

checkOrders().catch(e => { console.error(e); process.exit(1); });
