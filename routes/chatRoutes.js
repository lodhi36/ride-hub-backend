const express = require('express');
const { accessChat, fetchChats, getUnreadCount, clearChat, deleteChat, getChatById } = require('../controllers/chatController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/unread-count', protect, getUnreadCount);
router.post('/', protect, accessChat);
router.get('/', protect, fetchChats);
router.get('/:chatId', protect, getChatById);
router.post('/:chatId/clear', protect, clearChat);
router.delete('/:chatId', protect, deleteChat);

module.exports = router;
