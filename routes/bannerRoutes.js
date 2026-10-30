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

// Optional admin protection (allows admin session, token, or direct console access)
const optionalAdmin = async (req, res, next) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      return protect(req, res, () => {
        next();
      });
    } catch (_) {}
  }
  next();
};

router.get('/', getBanners);

router.post('/upload', optionalAdmin, upload.single('image'), uploadBanner);
router.put('/:id', optionalAdmin, updateBanner);
router.delete('/:id', optionalAdmin, deleteBanner);

module.exports = router;
