const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccountPath = path.join(__dirname, 'firebase-adminsdk.json');
const rootServiceAccountPath = path.join(__dirname, '../../firebase-adminsdk.json');

try {
  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('Firebase Admin initialized from FIREBASE_SERVICE_ACCOUNT env variable.');
  } else if (fs.existsSync(serviceAccountPath)) {
    serviceAccount = require(serviceAccountPath);
    console.log('Firebase Admin initialized from local file.');
  } else if (fs.existsSync(rootServiceAccountPath)) {
    serviceAccount = require(rootServiceAccountPath);
    console.log('Firebase Admin initialized from root file.');
  }

  if (!admin.apps.length) {
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } else {
      console.warn('WARNING: firebase-adminsdk.json not found and FIREBASE_SERVICE_ACCOUNT env var is missing. Phone Auth verification will fail.');
    }
  }
} catch (error) {
  console.error('Failed to initialize Firebase Admin:', error.message);
}

module.exports = admin;
