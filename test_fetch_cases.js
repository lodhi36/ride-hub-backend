const axios = require('axios');

async function testFetchCases() {
  try {
    const res = await axios.get('http://127.0.0.1:5000/api/support/cases');
    console.log('GET /api/support/cases Status:', res.status);
    console.log('Cases count:', res.data?.cases?.length);
    console.log('Cases summary:');
    (res.data?.cases || []).forEach(c => {
      console.log(`- [${c.ticketId || c.caseNumber}] Role: ${c.requesterRole} | Name: ${c.requesterName} | Title: ${c.summary || c.issueTitle || c.description} | Status: ${c.status}`);
    });
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}

testFetchCases();
