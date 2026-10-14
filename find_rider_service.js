const fs = require('fs');
const lines = fs.readFileSync('backend 3/services/riderSearchService.js', 'utf8').split('\n');
lines.forEach(function(l, i) {
  if (l.indexOf('riderAcceptDelivery') !== -1 || l.indexOf('riderRejectDelivery') !== -1) {
    console.log((i + 1) + ': ' + l.slice(0, 100));
  }
});
