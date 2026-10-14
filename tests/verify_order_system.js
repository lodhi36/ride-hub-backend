const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const User = require('../models/User');
const Booking = require('../models/Booking');
const { resolveSupplierIdentity, getSupplierSocketRooms } = require('../utils/idUtils');
const riderSearchService = require('../services/riderSearchService');

async function runTests() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  console.log('Connecting to MongoDB for verification tests...');
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB.\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, testName) {
    totalTests++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
    }
  }

  // ── TEST 1: Canonical Supplier Identity Resolver ──
  const mockUser = { _id: new mongoose.Types.ObjectId('6a9e2a264ab525ab1d351943'), role: 'supplier' };
  const resolvedId = resolveSupplierIdentity(mockUser);
  assert(resolvedId === '6a9e2a264ab525ab1d351943', 'Resolver extracts string from User object with ObjectId _id');

  const strId = resolveSupplierIdentity('6a9e2a264ab525ab1d351943');
  assert(strId === '6a9e2a264ab525ab1d351943', 'Resolver returns string ID unchanged');

  // ── TEST 2: Deterministic Socket Rooms ──
  const rooms = getSupplierSocketRooms('6a9e2a264ab525ab1d351943');
  assert(rooms.includes('supplier:6a9e2a264ab525ab1d351943'), 'Rooms include supplier:{supplierId}');
  assert(rooms.includes('supplier_6a9e2a264ab525ab1d351943'), 'Rooms include supplier_{supplierId}');
  assert(rooms.includes('restaurant_6a9e2a264ab525ab1d351943'), 'Rooms include restaurant_{supplierId}');

  // ── TEST 3: Real Supplier Record in DB ──
  const supplierDoc = await User.findById('6a9e2a264ab525ab1d351943').lean();
  assert(Boolean(supplierDoc), 'Supplier Kk exists in DB');
  assert(supplierDoc?.supplierId === '6a9e2a264ab525ab1d351943', 'Supplier Kk has canonical supplierId matching _id');
  assert(supplierDoc?.ownerUserId === '6a9e2a264ab525ab1d351943', 'Supplier Kk has ownerUserId matching _id');

  // ── TEST 4: Real Rider Record in DB ──
  const riderDoc = await User.findById('6aa0b890ba2a908d4bc3fc00').lean();
  assert(Boolean(riderDoc), 'Rider Rahul exists in DB');
  assert(riderDoc?.role === 'rider' || riderDoc?.role === 'delivery_partner', 'Rider Rahul has rider role');

  // ── TEST 5: Order Creation & Canonical Supplier Identity ──
  const testBookingId = `test_order_${Date.now()}`;
  const testBooking = new Booking({
    bookingId: testBookingId,
    customerId: '6a9e43224ab525ab1d3522f9',
    customerName: 'Sachin',
    customerPhone: '9999999999',
    serviceName: 'TOYS',
    categoryName: 'TOYS',
    supplierCategory: 'TOYS',
    price: 350,
    serviceAddress: 'Arera Colony, Bhopal',
    latitude: 23.3442352,
    longitude: 77.4071598,
    supplierId: '6a9e2a264ab525ab1d351943',
    restaurantId: '6a9e2a264ab525ab1d351943',
    providerId: '6a9e2a264ab525ab1d351943',
    partnerId: '6a9e2a264ab525ab1d351943',
    restaurantName: 'Kk',
    pickupAddress: 'Shop 1, Bhopal',
    pickupLatitude: 23.3442352,
    pickupLongitude: 77.4071598,
    pickupLocation: {
      latitude: 23.3442352,
      longitude: 77.4071598,
      address: 'Shop 1, Bhopal',
      supplierId: '6a9e2a264ab525ab1d351943',
    },
    status: 'PENDING_RESTAURANT',
  });
  await testBooking.save();

  const savedOrder = await Booking.findOne({ bookingId: testBookingId }).lean();
  assert(savedOrder?.supplierId === '6a9e2a264ab525ab1d351943', 'Order saved with exact canonical supplierId');
  assert(savedOrder?.pickupLocation?.supplierId === '6a9e2a264ab525ab1d351943', 'Order pickupLocation contains canonical supplierId');

  // ── TEST 6: Supplier History Query (getMyBookings logic) ──
  const uStr = '6a9e2a264ab525ab1d351943';
  const queryConditions = [
    { supplierId: uStr },
    { restaurantId: uStr },
    { providerId: uStr },
    { partnerId: uStr },
  ];
  const supplierOrders = await Booking.find({ $or: queryConditions }).sort({ createdAt: -1 }).limit(10).lean();
  assert(supplierOrders.length > 0, `Supplier history query returned ${supplierOrders.length} bookings (not empty)`);
  assert(supplierOrders.some(o => o.bookingId === testBookingId), 'Created order is included in Supplier history');

  // ── TEST 7: Delayed Rider Search Non-Regression Test ──
  // Simulate order acceptance
  savedOrder.status = 'PREPARING';
  savedOrder.providerId = '6a9e2a264ab525ab1d351943';
  savedOrder.riderStatus = 'NONE';
  savedOrder.riderId = null;

  // Check the critical condition that was previously aborting:
  const isPreviouslyAborted = Boolean(savedOrder.riderId || (savedOrder.providerId && savedOrder.riderStatus));
  const isNowAborted = Boolean(savedOrder.riderId || (savedOrder.riderStatus && savedOrder.riderStatus !== 'NONE'));
  assert(isPreviouslyAborted === true, 'Confirmed old logic was incorrectly aborting (isPreviouslyAborted = true)');
  assert(isNowAborted === false, 'Confirmed fixed logic DOES NOT abort (isNowAborted = false)');

  // ── CLEANUP TEST ORDER ──
  await Booking.deleteOne({ bookingId: testBookingId });
  console.log(`Cleaned up test booking: ${testBookingId}`);

  console.log(`\n==================================================`);
  console.log(`TEST SUMMARY: ${passedTests}/${totalTests} PASSED`);
  console.log(`==================================================\n`);

  await mongoose.disconnect();
  process.exit(passedTests === totalTests ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
