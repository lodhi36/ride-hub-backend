const fs = require('fs');
const content = fs.readFileSync('backend 3/controllers/bookingController.js', 'utf8');
const lines = content.split('\n');

lines.forEach((l, i) => {
  if (l.includes('getBookingById') || l.includes('riderAcceptDelivery') || l.includes('getActiveBooking')) {
    console.log(`L${i+1}: ${l.trim().slice(0, 100)}`);
  }
});
