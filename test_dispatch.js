require('dotenv').config();
const { connectDB } = require('./db');
const riderSearchService = require('./services/riderSearchService');

async function run() {
  await connectDB();
  const mockIo = {
    sockets: { sockets: new Map() },
    to: (room) => ({
      emit: (ev, data) => console.log(`[TEST EMIT to ${room}] ${ev}:`, data?.bookingId || data?.restaurantName || data?.status || data),
    }),
  };
  const mockOnlineRiders = new Map();
  riderSearchService.init(mockIo, mockOnlineRiders);
  console.log('--- Calling findAndDispatchNearestRider ---');
  await riderSearchService.findAndDispatchNearestRider('ride_1788929157577');
  process.exit(0);
}
run();
