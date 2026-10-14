const express = require('express');
const dotenv = require('dotenv');
dotenv.config();
const { createOrder } = require('./src/controllers/paymentController');

const app = express();
app.use(express.json());

app.post('/test-create-order', createOrder);

const PORT = 5001;
const server = app.listen(PORT, async () => {
    console.log(`Server running on ${PORT}`);
    try {
        const response = await fetch(`http://10.202.251.122:${PORT}/test-create-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: 50, currency: 'INR' })
        });
        const data = await response.json();
        console.log("\n--- BACKEND API RESPONSE ---");
        console.log(JSON.stringify(data, null, 2));
        console.log("----------------------------\n");
    } catch (e) {
        console.error("Fetch error:", e);
    }
    server.close();
});
