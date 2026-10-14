const express = require('express');
const { 
  register, 
  login, 
  getMe,
  getPartnerProfile,
  requestAccountDeletion,
  confirmAccountDeletion,
  recoverAccount,
  verifyPhone,
  updateFcmToken,
  refreshToken,
  logout,
  sendOtp,
  verifyOtp,
  loginWithOtp,
  registerVerified,
} = require('../controllers/authController');
const { validateRegister, validateLogin } = require('../src/validations/inputValidator');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Production Mobile OTP Authentication Routes
router.post('/otp/send', sendOtp);
router.post('/otp/verify', verifyOtp);
router.post('/otp/login', loginWithOtp);
router.post('/otp/register', registerVerified);
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);

router.post('/refresh', refreshToken);
router.post('/logout', protect, logout);
router.post('/update-fcm-token', protect, updateFcmToken);
router.post('/register', validateRegister, register);
router.post('/login', validateLogin, login);
router.post('/verify-phone', verifyPhone);
router.get('/me', protect, getMe);
router.get('/partner-profile', protect, getPartnerProfile);

// Account Deletion & Recovery
router.post('/delete/request', protect, requestAccountDeletion);
router.post('/delete/confirm', protect, confirmAccountDeletion);
router.post('/recover', recoverAccount);

// Biometric Multi-Role Face Auth
const {
  initiateFaceLiveness,
  registerFaceBiometric,
  loginWithFace,
  deleteFaceBiometric,
  checkFaceStatus,
} = require('../controllers/faceAuthController');

router.post('/face/liveness-initiate', initiateFaceLiveness);
router.post('/face/register', registerFaceBiometric);
router.post('/face/login', loginWithFace);
router.get('/face/status/:phone?', checkFaceStatus);
router.post('/face/delete', protect, deleteFaceBiometric);

module.exports = router;
