const axios = require('axios');

async function testApi() {
  try {
    console.log("1. Logging in as admin...");
    const loginRes = await axios.post('http://10.202.251.122:5000/api/admin/login', {
      email: 'admin@admin.com',
      password: '123456'
    });
    console.log("Login success! Token:", loginRes.data.token ? "RECEIVED" : "FAILED");

    const token = loginRes.data.token;

    console.log("2. Fetching /api/admin/notifications...");
    const notifRes = await axios.get('http://10.202.251.122:5000/api/admin/notifications', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    console.log("Notifications API Response Status:", notifRes.status);
    console.log("Notifications API Response Data:", JSON.stringify(notifRes.data, null, 2));
  } catch (err) {
    console.error("API Test Error:", err.response ? err.response.data : err.message);
  }
}

testApi();
