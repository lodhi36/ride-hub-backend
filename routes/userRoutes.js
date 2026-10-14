const express = require('express');
const { getFeedProfiles, blockUser, unblockUser, updateUserProfile, updatePhoneWithOtp } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/feed', protect, getFeedProfiles);
router.post('/block/:id', protect, blockUser);
router.post('/unblock/:id', protect, unblockUser);
router.put('/update-profile', updateUserProfile);
router.post('/update-profile', updateUserProfile);
router.post('/update-phone', updatePhoneWithOtp);

module.exports = router;
