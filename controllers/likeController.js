const Like = require('../models/Like');
const User = require('../models/User');
const { sendNotification } = require('../services/notificationService');

let ioInstance = null;
const setIO = (io) => { ioInstance = io; };

// @desc    Like or Dislike a profile
// @route   POST /api/likes
// @access  Private
const likeProfile = async (req, res, next) => {
  try {
    const { likeeId, status } = req.body; // status: 'like' | 'dislike'
    const likerId = req.user.id;

    if (!likeeId || !status) {
      return res.status(400).json({ success: false, message: 'likeeId and status are required' });
    }
    if (likerId === likeeId) {
      return res.status(400).json({ success: false, message: 'You cannot like yourself' });
    }

    // Upsert the like record
    const like = await Like.findOneAndUpdate(
      { liker: likerId, likee: likeeId },
      { status },
      { upsert: true, new: true }
    );

    // Check if it's a mutual like (Match)
    let isMatch = false;
    if (status === 'like' || status === 'superlike') {
      const mutualLike = await Like.findOne({ liker: likeeId, likee: likerId, status: { $in: ['like', 'superlike'] } });
      if (mutualLike) {
        isMatch = true;
      }
    }

    // Send real-time notification
    if (status === 'like' || status === 'superlike') {
      const liker = await User.findById(likerId).select('name username');
      const senderName = liker.name || liker.username;
      
      if (isMatch) {
        // Match notification for both users
        const likee = await User.findById(likeeId).select('name username');
        const likeeName = likee.name || likee.username;

        await sendNotification(
          likeeId,
          likerId,
          'match',
          `You and ${senderName} have matched!`,
          ioInstance
        );
        await sendNotification(
          likerId,
          likeeId,
          'match',
          `You and ${likeeName} have matched!`,
          ioInstance
        );
      } else {
        // Regular like or superlike notification
        const actionText = status === 'superlike' ? 'Super Liked' : 'liked';
        await sendNotification(
          likeeId,
          likerId,
          status,
          `${senderName} ${actionText} your profile!`,
          ioInstance
        );
      }
    }

    res.json({ success: true, like, isMatch });
  } catch (error) {
    next(error);
  }
};

// @desc    Get likes count for a profile
// @route   GET /api/likes/:userId
// @access  Private
const getLikesCount = async (req, res, next) => {
  try {
    const count = await Like.countDocuments({ likee: req.params.userId, status: 'like' });
    res.json({ success: true, count });
  } catch (error) {
    next(error);
  }
};

module.exports = { likeProfile, getLikesCount, setIO };
