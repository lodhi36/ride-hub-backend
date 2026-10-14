const axios = require('axios');

async function testCallLog() {
  try {
    console.log("1. Admin Login...");
    const loginRes = await axios.post('http://10.202.251.122:5000/api/admin/login', {
      email: 'admin@admin.com',
      password: '123456'
    });
    const token = loginRes.data.token;
    console.log("Logged in! Token obtained.");

    console.log("2. Testing Call Log Creation...");
    // Fetch users to test call log
    const usersRes = await axios.get('http://10.202.251.122:5000/api/admin/users', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const users = usersRes.data.users || usersRes.data.data || [];
    console.log(`Found ${users.length} users in DB.`);
    if (users.length >= 2) {
      const u1 = users[0]._id;
      const u2 = users[1]._id;
      console.log(`Testing call log between ${u1} and ${u2}...`);

      const callLogRes = await axios.post('http://10.202.251.122:5000/api/messages/call-log', {
        receiverId: u2,
        callType: 'video',
        callStatus: 'missed',
        callDuration: 0
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      console.log("Call Log Result:", callLogRes.data.success ? "SUCCESS ✅" : "FAILED ❌");
      console.log("Message created:", callLogRes.data.message?.text);
    }
  } catch (err) {
    console.error("Test Error:", err.response ? err.response.data : err.message);
  }
}

testCallLog();
