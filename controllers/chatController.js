const Chat = require('../models/Chat');
const User = require('../models/User');

// @desc    Access or create a chat with a specific user
// @route   POST /api/chats
// @access  Private
const accessChat = async (req, res, next) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: 'userId parameter is missing' });
  }

  try {
    let chat = await Chat.findOne({
      participants: { $all: [req.user.id, userId] }
    }).populate('participants', '-password').populate('lastMessage');

    if (chat) {
      res.json({ success: true, chat });
    } else {
      const chatData = {
        participants: [req.user.id, userId],
        unreadCounts: new Map([[req.user.id.toString(), 0], [userId.toString(), 0]])
      };

      const createdChat = await Chat.create(chatData);
      const fullChat = await Chat.findOne({ _id: createdChat._id }).populate('participants', '-password');
      res.status(201).json({ success: true, chat: fullChat });
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Fetch all chats for a user
// @route   GET /api/chats
// @access  Private
const fetchChats = async (req, res, next) => {
  try {
    const chats = await Chat.find({ 
      participants: { $elemMatch: { $eq: req.user.id } },
      deletedBy: { $ne: req.user.id }
    })
      .populate('participants', '-password')
      .populate('lastMessage')
      .sort({ updatedAt: -1 });
    
    res.json({ success: true, chats });
  } catch (error) {
    next(error);
  }
};

// @desc    Get total unread message count for a user
// @route   GET /api/chats/unread-count
// @access  Private
const getUnreadCount = async (req, res, next) => {
  try {
    const chats = await Chat.find({ participants: { $elemMatch: { $eq: req.user.id } } });
    let totalUnread = 0;
    chats.forEach(chat => {
      const count = chat.unreadCounts?.get(req.user.id.toString()) || 0;
      totalUnread += count;
    });
    res.json({ success: true, unreadCount: totalUnread });
  } catch (error) {
    next(error);
  }
};

// @desc    Clear chat history for the current user
// @route   POST /api/chats/:chatId/clear
// @access  Private
const clearChat = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const currentUserId = req.user.id;

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }

    if (!chat.participants.some(id => id.toString() === currentUserId.toString())) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (!chat.clearedAt) {
      chat.clearedAt = new Map();
    }
    chat.clearedAt.set(currentUserId.toString(), new Date());
    await chat.save();

    res.json({ success: true, message: 'Chat cleared successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete (hide) chat from chat list
// @route   DELETE /api/chats/:chatId
// @access  Private
const deleteChat = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const currentUserId = req.user.id;

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }

    if (!chat.participants.some(id => id.toString() === currentUserId.toString())) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (!chat.deletedBy.some(id => id.toString() === currentUserId.toString())) {
      chat.deletedBy.push(currentUserId);
    }
    
    if (!chat.clearedAt) chat.clearedAt = new Map();
    chat.clearedAt.set(currentUserId.toString(), new Date());
    
    await chat.save();

    res.json({ success: true, message: 'Chat deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a specific chat room by chatId
// @route   GET /api/chats/:chatId
// @access  Private
const getChatById = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const chat = await Chat.findById(chatId)
      .populate('participants', '-password')
      .populate('lastMessage');

    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat room not found' });
    }

    if (!chat.participants.some(p => p._id.toString() === req.user.id.toString())) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this chat' });
    }

    res.json({ success: true, chat });
  } catch (error) {
    next(error);
  }
};

module.exports = { accessChat, fetchChats, getUnreadCount, clearChat, deleteChat, getChatById };
