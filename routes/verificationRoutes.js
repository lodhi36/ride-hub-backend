const express = require('express');
const router = express.Router();

const {
  initiateVerification,
  submitVerification,
  getVerificationStatus,
  adminGetVerifications,
  adminReVerifyUser,
} = require('../controllers/verificationController');

const { protect } = require('../middleware/authMiddleware');
const { upload } = require('../middleware/uploadMiddleware');

// ─── Admin guard middleware ───────────────────────────────────────────────────
const adminOnly = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.',
    });
  }
  next();
};

// ─── User Verification Routes ─────────────────────────────────────────────────
// POST /api/verification/initiate  → get challenge sequence
router.post('/initiate', protect, initiateVerification);

// POST /api/verification/submit    → submit selfie + challenge results
router.post(
  '/submit',
  protect,
  upload.fields([{ name: 'selfie', maxCount: 1 }]),
  submitVerification
);

// GET  /api/verification/status    → get own verification status
router.get('/status', protect, getVerificationStatus);

// ─── Admin Routes ─────────────────────────────────────────────────────────────
// GET  /api/verification/admin/list?status=pending|verified|rejected
router.get('/admin/list', protect, adminOnly, adminGetVerifications);

// PUT  /api/verification/admin/:userId/reset  → force re-verification
router.put('/admin/:userId/reset', protect, adminOnly, adminReVerifyUser);

module.exports = router;
