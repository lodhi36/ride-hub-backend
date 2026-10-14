const axios = require('axios');

async function testSupportTicket() {
  try {
    const payload = {
      orderRef: 'BOOKING_TEST_123',
      bookingId: null,
      category: 'problem_placing_order',
      orderCategory: 'Food',
      priority: 'urgent',
      requesterRole: 'customer',
      requesterRef: '6a9e43224ab525ab1d3522f9',
      requesterName: 'Sachin m.p. constable Lodhi',
      requesterPhone: '9999999999',
      description: 'Problem placing order: My cart is not confirming checkout.',
      gpsLat: 23.2505,
      gpsLng: 77.4065,
      orderStatus: 'BEFORE_PAYMENT'
    };

    console.log('Sending test customer ticket to http://127.0.0.1:5000/api/support/request ...');
    const res = await axios.post('http://127.0.0.1:5000/api/support/request', payload);
    console.log('Response Status:', res.status);
    console.log('Response Data:', res.data);
  } catch (err) {
    console.error('Error sending ticket:', err.response?.data || err.message);
  }
}

testSupportTicket();
