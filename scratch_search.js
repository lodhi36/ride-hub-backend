const fs = require('fs');

const content = fs.readFileSync('controllers/bookingController.js', 'utf8');
const lines = content.split('\n');
lines.forEach((l, i) => {
  if (l.includes('restaurantAcceptOrder') || l.includes('restaurantFoodReady') || l.includes('riderAcceptDelivery')) {
    console.log((i + 1) + ': ' + l.trim());
  }
});
