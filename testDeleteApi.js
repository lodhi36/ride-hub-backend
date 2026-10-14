const axios = require('axios');

async function testDelete() {
  try {
    const loginRes = await axios.post('http://10.202.251.122:5000/api/admin/login', {
      email: 'admin@admin.com',
      password: '123456'
    });
    const token = loginRes.data.token;

    console.log("Testing delete notification API...");
    const deleteRes = await axios.post(
      'http://10.202.251.122:5000/api/admin/delete-notification',
      {
        id: '6a6251e53824bc9f4fd1cad9'
      },
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    console.log("Delete Response:", deleteRes.data);

    const historyRes = await axios.get('http://10.202.251.122:5000/api/admin/notifications', {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("History after delete count:", historyRes.data.notifications.length);
  } catch (err) {
    console.error("Error:", err.response ? err.response.data : err.message);
  }
}

testDelete();
