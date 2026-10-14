const fs = require('fs');
const content = fs.readFileSync('../DatingApp/src/screens/CustomerHomeScreen.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((l, i) => {
  if (l.includes('PROMO_BANNERS')) {
    console.log((i+1) + ': ' + l.trim());
  }
});
