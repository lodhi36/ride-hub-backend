const admin = require('firebase-admin');

const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  try {
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    const localJsonPath = path.join(__dirname, '../firebase-adminsdk.json');
    const rootJsonPath = path.join(__dirname, '../../../firebase-adminsdk.json');

    let credential;
    if (serviceAccountKey) {
      credential = admin.credential.cert(JSON.parse(serviceAccountKey));
      console.log('✅ Firebase Admin initialized from FIREBASE_SERVICE_ACCOUNT_KEY env.');
    } else if (fs.existsSync(localJsonPath)) {
      const serviceAccount = require(localJsonPath);
      credential = admin.credential.cert(serviceAccount);
      console.log('✅ Firebase Admin initialized from local firebase-adminsdk.json file.');
    } else if (fs.existsSync(rootJsonPath)) {
      const serviceAccount = require(rootJsonPath);
      credential = admin.credential.cert(serviceAccount);
      console.log('✅ Firebase Admin initialized from root firebase-adminsdk.json file.');
    }

    if (credential) {
      admin.initializeApp({ credential });
    } else {
      console.warn('⚠️ WARNING: FIREBASE_SERVICE_ACCOUNT_KEY is missing and firebase-adminsdk.json not found.');
      admin.initializeApp();
    }
  } catch (error) {
    console.error('Firebase admin initialization error:', error);
  }
}

const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken) return false;

  const message = {
    notification: {
      title,
      body,
    },
    data,
    token: fcmToken,
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'default_sound_v2',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
        },
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('Successfully sent message:', response);
    return true;
  } catch (error) {
    console.error('Error sending push notification:', error);
    return false;
  }
};

const sendMulticastNotification = async (fcmTokens, title, body, data = {}) => {
  if (!fcmTokens || fcmTokens.length === 0) return false;

  const message = {
    notification: {
      title,
      body,
    },
    data,
    tokens: fcmTokens,
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'default_sound_v2',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
        },
      },
    },
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(response.successCount + ' messages were sent successfully');
    
    // Check for failed tokens (e.g., unregistered devices)
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(fcmTokens[idx]);
        }
      });
      console.log('List of tokens that caused failures: ' + failedTokens);
      // In production, you would remove these failedTokens from your database
    }
    
    return response;
  } catch (error) {
    console.error('Error sending multicast push notification:', error);
    return false;
  }
};

module.exports = {
  admin,
  sendPushNotification,
  sendMulticastNotification,
};
