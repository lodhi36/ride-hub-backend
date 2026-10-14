const axios = require('axios');

async function testMyBookings() {
  try {
    const res = await axios.get('http://10.202.251.122:5000/api/bookings/my-bookings?userId=6a9e2a264ab525ab1d351943&role=provider');
    console.log('Bookings response count:', res.data.count);
    console.log('Bookings data:', JSON.stringify(res.data.bookings.slice(0, 3), null, 2));
  } catch (e) {
    console.log('Error:', e.message);
  }
}

testMyBookings();
