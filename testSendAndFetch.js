const axios = require('axios');

async function testSendAndFetch() {
  try {
    console.log("1. Logging in...");
    const loginRes = await axios.post('http://10.202.251.122:5000/api/admin/login', {
      email: 'admin@admin.com',
      password: '123456'
    });
    const token = loginRes.data.token;

    console.log("2. Sending a test admin notification via API...");
    const sendRes = await axios.post(
      'http://10.202.251.122:5000/api/admin/send-notification',
      {
        title: 'System Update',
        message: 'Welcome to the updated Admin Panel notification system!',
        target: 'all_users'
      },
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    console.log("Send API Response:", sendRes.data);

    console.log("3. Fetching sent notifications history...");
    const historyRes = await axios.get('http://10.202.251.122:5000/api/admin/notifications', {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("History API Response:", JSON.stringify(historyRes.data, null, 2));

  } catch (err) {
    console.error("Error:", err.response ? err.response.data : err.message);
  }
}

testSendAndFetch();
