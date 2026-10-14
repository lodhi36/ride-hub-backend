const http = require('http');

http.get('http://127.0.0.1:5000/api/bookings/my-bookings?userId=6a9e2a264ab525ab1d351943&role=provider', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    console.log('Supplier 6a9e2a264ab525ab1d351943 Bookings Count:', json.count);
    if (json.bookings && json.bookings.length > 0) {
      console.log('First 2 bookings:', json.bookings.slice(0, 2).map(b => ({
        bookingId: b.bookingId,
        status: b.status,
        restaurantName: b.restaurantName,
        customerName: b.customerName,
        price: b.price
      })));
    }
    process.exit(0);
  });
}).on('error', (e) => {
  console.error(e);
  process.exit(1);
});
