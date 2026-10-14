const fs = require('fs');

const content = fs.readFileSync('controllers/bookingController.js', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
  if (line.includes('exports.') || line.includes('pocketBalance') || line.includes('DELIVERED') || line.includes('COMPLETED') || line.includes('complete')) {
    if (line.includes('exports.') || line.includes('pocketBalance') || line.includes('wallet') || line.includes('earning')) {
      console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
  }
});
