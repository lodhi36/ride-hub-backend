const express = require('express');
const {
  initiateFaceLiveness,
  registerFaceBiometric,
  loginWithFace,
  deleteFaceBiometric,
  checkFaceStatus,
} = require('../controllers/faceAuthController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Public Liveness Check & Face Auth
router.post('/liveness-initiate', initiateFaceLiveness);
router.post('/register', registerFaceBiometric);
router.post('/login', loginWithFace);
router.get('/status/:phone?', checkFaceStatus);

// Protected Biometric Deletion (Consent withdrawal)
router.post('/delete', deleteFaceBiometric);

module.exports = router;
