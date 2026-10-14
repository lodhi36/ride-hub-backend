require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Transaction = require('./src/models/Transaction');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  // Show ALL users with their coins/totalEarnedCoins
  const users = await User.find({}).select('name coins totalEarnedCoins totalGiftsReceived walletBalance totalWithdrawn');
  console.log('\n=== ALL Users Balance ===');
  users.forEach(u => {
    console.log(`  ${u.name} (${u._id})`);
    console.log(`    coins: ${u.coins} | totalEarnedCoins: ${u.totalEarnedCoins} | walletBalance: ${u.walletBalance} | totalGiftsReceived: ${u.totalGiftsReceived} | totalWithdrawn: ${u.totalWithdrawn}`);
  });

  // Show gift_received transactions PER user
  console.log('\n=== Gift Received Transactions per User ===');
  for (const u of users) {
    const gifts = await Transaction.find({ userId: u._id, type: 'gift_received' });
    const totalGifts = gifts.reduce((sum, g) => sum + g.amount, 0);
    const withdrawals = await Transaction.find({ userId: u._id, type: 'withdrawal_payout' });
    const totalWithdrawn = withdrawals.reduce((sum, w) => sum + Math.abs(w.amount), 0);
    console.log(`  ${u.name}: ${gifts.length} gifts = ₹${totalGifts} received, ₹${totalWithdrawn} withdrawn, Available = ₹${totalGifts - totalWithdrawn}`);
  }

  process.exit(0);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
