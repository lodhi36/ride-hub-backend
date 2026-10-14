const User = require('../models/User');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_ATTEMPTS_PER_HOUR = 5;
const UPLOAD_DIR = path.join(__dirname, '../uploads/verifications');

// Ensure verifications folder exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ─── Available Liveness Challenges ───────────────────────────────────────────
const ALL_CHALLENGES = [
  { id: 'blink',      instruction: 'Blink your eyes',     icon: 'eye-off-outline' },
  { id: 'smile',      instruction: 'Smile naturally',     icon: 'happy-outline' },
  { id: 'turn_left',  instruction: 'Turn your head left', icon: 'arrow-back-outline' },
  { id: 'turn_right', instruction: 'Turn your head right',icon: 'arrow-forward-outline' },
  { id: 'look_up',    instruction: 'Look up slowly',      icon: 'arrow-up-outline' },
  { id: 'look_down',  instruction: 'Look down slowly',    icon: 'arrow-down-outline' },
];

// ─── Helper: pick N random challenges ────────────────────────────────────────
const pickChallenges = (n = 3) => {
  const shuffled = [...ALL_CHALLENGES].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
};

// ─── Helper: encrypt a file path for storage ─────────────────────────────────
const encryptPath = (filePath) => {
  const secret = process.env.JWT_SECRET || 'jwt_secret_dating_app_key';
  const hash = crypto.createHmac('sha256', secret).update(filePath).digest('hex');
  return hash.substring(0, 16) + path.basename(filePath);
};

// ─── Helper: check rate limit ────────────────────────────────────────────────
const checkRateLimit = (user) => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  // Store rate limit info in verificationAttempts + verificationDate as last attempt time
  // If last attempt was within 1 hour and attempts >= MAX, block
  if (
    user.verificationDate &&
    now - new Date(user.verificationDate).getTime() < oneHour &&
    user.verificationAttempts >= MAX_ATTEMPTS_PER_HOUR
  ) {
    const resetIn = Math.ceil(
      (oneHour - (now - new Date(user.verificationDate).getTime())) / 60000
    );
    return { blocked: true, resetIn };
  }

  // Reset counter if older than 1 hour
  if (
    user.verificationDate &&
    now - new Date(user.verificationDate).getTime() >= oneHour
  ) {
    return { blocked: false, resetAttempts: true };
  }

  return { blocked: false };
};

// ─── Controller: Initiate Verification ───────────────────────────────────────
// POST /api/verification/initiate
const initiateVerification = async (req, res) => {
  console.log('\n[VERIFICATION] initiateVerification called by userId:', req.user._id);

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Already verified
    if (user.verificationStatus === 'verified') {
      console.log('[VERIFICATION] User already verified:', user._id);
      return res.json({
        success: true,
        alreadyVerified: true,
        message: 'You are already verified.',
      });
    }

    // Rate limit check
    const rateCheck = checkRateLimit(user);
    if (rateCheck.blocked) {
      return res.status(429).json({
        success: false,
        message: `Too many attempts. Please try again in ${rateCheck.resetIn} minutes.`,
      });
    }

    // Generate random challenges (3 challenges)
    const challenges = pickChallenges(3);
    console.log('[VERIFICATION] Challenges issued:', challenges.map(c => c.id));

    res.json({
      success: true,
      challenges,
      sessionId: crypto.randomUUID(), // client echoes this back for session tracking
      message: 'Liveness challenges generated. Complete all steps using live camera only.',
    });
  } catch (error) {
    console.error('[VERIFICATION] initiateVerification ERROR:', error.message);
    res.status(500).json({ success: false, message: 'Server error during verification initiation.' });
  }
};

// ─── Controller: Submit Verification ─────────────────────────────────────────
// POST /api/verification/submit  (multipart/form-data)
// Body fields: sessionId, challengeResults (JSON array), selfie (file)
const submitVerification = async (req, res) => {
  console.log('\n[VERIFICATION] submitVerification called by userId:', req.user._id);

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Rate limit check
    const rateCheck = checkRateLimit(user);
    if (rateCheck.blocked) {
      return res.status(429).json({
        success: false,
        message: `Too many attempts. Please try again in ${rateCheck.resetIn} minutes.`,
      });
    }

    // Parse challenge results
    let challengeResults;
    try {
      challengeResults = JSON.parse(req.body.challengeResults || '[]');
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid challengeResults format.' });
    }

    console.log('[VERIFICATION] Challenge results received:', challengeResults);

    // Validate challenges: all must be passed
    const allPassed = challengeResults.length > 0 &&
      challengeResults.every(r => r.passed === true);

    if (!allPassed) {
      // Increment attempts
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { verificationAttempts: 1 },
        verificationStatus: 'rejected',
        verificationDate: new Date(),
      });

      console.log('[VERIFICATION] FAILED: Not all challenges passed.');
      return res.status(400).json({
        success: false,
        verified: false,
        message: 'Liveness challenges not completed. Please try again.',
      });
    }

    // Handle selfie file upload
    let selfieStoredPath = '';

    // Check for selfie from multer (file in req.files or req.file)
    let selfieFile = null;
    if (req.files && req.files.selfie && req.files.selfie[0]) {
      selfieFile = req.files.selfie[0];
    } else if (req.file) {
      selfieFile = req.file;
    }

    if (selfieFile && selfieFile.buffer) {
      const filename = `verify-${req.user._id}-${Date.now()}.jpg`;
      const outputPath = path.join(UPLOAD_DIR, filename);

      try {
        const sharp = require('sharp');
        const compressed = await sharp(selfieFile.buffer)
          .rotate()
          .resize({ width: 400, height: 400, fit: 'cover' })
          .jpeg({ quality: 70 })
          .toBuffer();

        fs.writeFileSync(outputPath, compressed);
        selfieStoredPath = `/uploads/verifications/${filename}`;
        console.log('[VERIFICATION] Selfie saved at:', selfieStoredPath);
      } catch (sharpErr) {
        console.error('[VERIFICATION] Selfie compression error:', sharpErr.message);
        // Continue without selfie — don't block verification for image processing error
      }
    } else {
      console.log('[VERIFICATION] No selfie file received — continuing without face image.');
    }

    // Mark user as VERIFIED
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        verificationStatus: 'verified',
        verificationDate: new Date(),
        $inc: { verificationAttempts: 1 },
        verifiedFaceImage: selfieStoredPath,
      },
      { new: true }
    ).select('-password');

    console.log('[VERIFICATION] SUCCESS: User verified!', req.user._id);

    res.json({
      success: true,
      verified: true,
      message: '✅ Identity verified! Your Blue Badge is now active.',
      user: {
        _id: updatedUser._id,
        verificationStatus: updatedUser.verificationStatus,
        verificationDate: updatedUser.verificationDate,
      },
    });
  } catch (error) {
    console.error('[VERIFICATION] submitVerification ERROR:', error.message);
    res.status(500).json({ success: false, message: 'Server error during verification submission.' });
  }
};

// ─── Controller: Get Verification Status ─────────────────────────────────────
// GET /api/verification/status
const getVerificationStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      'verificationStatus verificationDate verificationAttempts'
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      verificationStatus: user.verificationStatus,
      verificationDate: user.verificationDate,
      verificationAttempts: user.verificationAttempts,
      isVerified: user.verificationStatus === 'verified',
    });
  } catch (error) {
    console.error('[VERIFICATION] getVerificationStatus ERROR:', error.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ─── Controller: Admin — List All Verifications ───────────────────────────────
// GET /api/verification/admin/list?status=pending
const adminGetVerifications = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status && ['pending', 'verified', 'rejected'].includes(status)) {
      filter.verificationStatus = status;
    }

    const users = await User.find(filter)
      .select('name username email profilePicture verificationStatus verificationDate verificationAttempts createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    // Summary counts
    const [pendingCount, verifiedCount, rejectedCount] = await Promise.all([
      User.countDocuments({ verificationStatus: 'pending' }),
      User.countDocuments({ verificationStatus: 'verified' }),
      User.countDocuments({ verificationStatus: 'rejected' }),
    ]);

    res.json({
      success: true,
      summary: { pending: pendingCount, verified: verifiedCount, rejected: rejectedCount },
      total,
      page: parseInt(page),
      users,
    });
  } catch (error) {
    console.error('[VERIFICATION] adminGetVerifications ERROR:', error.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ─── Controller: Admin — Reset User Verification ─────────────────────────────
// PUT /api/verification/admin/:userId/reset
const adminReVerifyUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findByIdAndUpdate(
      userId,
      {
        verificationStatus: 'pending',
        verificationDate: null,
        verificationAttempts: 0,
        verifiedFaceImage: '',
      },
      { new: true }
    ).select('name username email verificationStatus');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    console.log('[VERIFICATION ADMIN] Reset verification for user:', userId);
    res.json({
      success: true,
      message: `Verification reset for ${user.username}. They must re-verify.`,
      user,
    });
  } catch (error) {
    console.error('[VERIFICATION] adminReVerifyUser ERROR:', error.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = {
  initiateVerification,
  submitVerification,
  getVerificationStatus,
  adminGetVerifications,
  adminReVerifyUser,
};
