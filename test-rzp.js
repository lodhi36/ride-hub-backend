const Razorpay = require('razorpay');

const rzp = new Razorpay({ 
    key_id: 'rzp_live_T1PnvxJGMMYUM7', 
    key_secret: 'LtXizH7y33ldERMw16LesVPQ' 
});

rzp.orders.create({ amount: 1000, currency: 'INR', receipt: 'test_receipt' })
  .then(order => {
      console.log('SUCCESS: Razorpay order created.', order);
  })
  .catch(error => {
      console.error('ERROR: Failed to create Razorpay order.', error);
  });
