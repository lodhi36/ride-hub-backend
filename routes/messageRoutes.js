const express = require('express');
const { sendMessage, allMessages, uploadMedia, sendGift, logCallMessage, deleteMessage, clearCallLogs } = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');
const { upload, compressImage } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.post('/', protect, sendMessage);
router.get('/:chatId', protect, allMessages);
router.post('/upload-media', protect, upload.fields([{ name: 'media', maxCount: 1 }]), compressImage, uploadMedia);
router.post('/send-gift', protect, sendGift);
router.post('/call-log', protect, logCallMessage);
router.delete('/calls/clear/:chatId', protect, clearCallLogs);
router.delete('/:id', protect, deleteMessage);

module.exports = router;
