const express = require('express');
const multer = require('multer');
const { protect } = require('../middleware/authMiddleware');
const {
  uploadBanner,
  getBanners,
  updateBanner,
  deleteBanner
} = require('../controllers/bannerController');

const router = express.Router();

// Setup memory storage for multer so we can check size before writing to disk
const upload = multer({ storage: multer.memoryStorage() });

// Middleware to ensure user is admin
const adminOnly = (req, res, next) => {
  if (req.user && (req.user.isAdmin || req.user.role === 'admin')) {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Not authorized as an admin' });
  }
};

router.get('/', getBanners);

// Protected routes
router.use(protect);
router.use(adminOnly);

router.post('/upload', upload.single('image'), uploadBanner);
router.put('/:id', updateBanner);
router.delete('/:id', deleteBanner);

module.exports = router;
