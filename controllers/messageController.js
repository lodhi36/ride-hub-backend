const Message = require('../models/Message');
const Chat = require('../models/Chat');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Transaction = require('../models/Transaction');
const { userSockets } = require('../sockets/socketHandler');
const { sendPushNotification } = require('../services/firebase');

let ioInstance = null;
const setIO = (io) => { ioInstance = io; };

// @desc    Send a message
// @route   POST /api/messages
// @access  Private
const sendMessage = async (req, res, next) => {
  const { content, chatId, receiverId, messageType, mediaUrl } = req.body;

  console.log(`[sendMessage] Request received: sender=${req.user.id}, receiver=${receiverId}, chatId=${chatId}`);

  if (!chatId || !receiverId) {
    return res.status(400).json({ success: false, message: 'Invalid data passed into request' });
  }

  // Check if receiver has blocked the sender
  const receiverUser = await User.findById(receiverId);
  if (receiverUser && receiverUser.blockedUsers && receiverUser.blockedUsers.some(id => id.toString() === req.user.id.toString())) {
    return res.status(403).json({ success: false, message: 'Cannot send message to this user (Blocked).' });
  }

  // content can be empty if it's an image/audio
  const finalContent = content || '';

  // Check if receiver is online using active socket connections map
  const isReceiverOnline = userSockets && userSockets.has(receiverId.toString());
  const messageStatus = isReceiverOnline ? 'delivered' : 'sent';
  console.log(`[sendMessage] Receiver ${receiverId} is online: ${isReceiverOnline}. Message status set to: ${messageStatus}`);

  const newMessage = {
    sender: req.user.id,
    receiver: receiverId,
    text: finalContent,
    chatId: chatId,
    status: messageStatus,
    messageType: messageType || 'text',
    mediaUrl: mediaUrl || null
  };

  try {
    let message = await Message.create(newMessage);
    
    // Update chat latest message and unread counts
    let chat = await Chat.findById(chatId);
    if(chat) {
        chat.lastMessage = message._id;
        const currentCount = chat.unreadCounts.get(receiverId.toString()) || 0;
        chat.unreadCounts.set(receiverId.toString(), currentCount + 1);

        // Remove both users from deletedBy so the chat reappears
        if (chat.deletedBy && chat.deletedBy.length > 0) {
          chat.deletedBy = chat.deletedBy.filter(id => 
            id.toString() !== req.user.id.toString() && id.toString() !== receiverId.toString()
          );
        }

        await chat.save();
    }

    message = await message.populate('sender', 'name profilePicture');
    message = await message.populate('chatId');
    message = await User.populate(message, { path: 'chatId.participants', select: 'name profilePicture email isOnline lastSeen' });

    // Create a notification record in DB
    const senderName = message.sender?.name || 'Someone';
    const notification = await Notification.create({
      receiver: receiverId,
      sender: req.user.id,
      type: 'message',
      text: `sent you a ${messageType === 'image' ? 'photo' : messageType === 'audio' ? 'voice note' : 'message: "' + (finalContent.length > 40 ? finalContent.substring(0, 40) + '...' : finalContent) + '"'}`,
      isRead: false,
    });

    const populatedNotif = await notification.populate('sender', 'name username profilePicture');

    // Trigger FCM Push Notification
    const receiverTokenUser = await User.findById(receiverId);
    if (receiverTokenUser && receiverTokenUser.pushToken && receiverTokenUser.notificationsEnabled) {
      let pushTitle = `New message from ${senderName}`;
      let pushBody = messageType === 'image' ? 'Sent you a photo' : messageType === 'audio' ? 'Sent you a voice note' : finalContent;
      await sendPushNotification(receiverTokenUser.pushToken, pushTitle, pushBody, { type: 'CHAT', chatId: chatId.toString(), senderId: req.user.id.toString() });
    }

    // Emit socket events
    if (ioInstance) {
        console.log(`[sendMessage] Emitting receive_message to room chat_${chatId}`);
        ioInstance.to(`chat_${chatId}`).emit('receive_message', message);

        console.log(`[sendMessage] Emitting receive_notification to room user_${receiverId}`);
        ioInstance.to(`user_${receiverId}`).emit('receive_notification', {
          ...populatedNotif.toObject(),
          chatId,
        });

        // Tell receiver to refresh their chat list (unread counts)
        ioInstance.to(`user_${receiverId}`).emit('chat_list_update', { chatId });
    }

    res.json({ success: true, message });
  } catch (error) {
    console.error('[sendMessage] ERROR:', error);
    next(error);
  }
};

// @desc    Get all messages for a chat
// @route   GET /api/messages/:chatId
// @access  Private
const allMessages = async (req, res, next) => {
  try {
    const chat = await Chat.findById(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }
    
    const clearedAt = chat.clearedAt ? chat.clearedAt.get(req.user.id.toString()) : null;
    
    let query = { chatId: req.params.chatId };
    if (clearedAt) {
      query.createdAt = { $gt: clearedAt };
    }

    const messages = await Message.find(query)
      .populate('sender', 'name profilePicture email')
      .sort({ createdAt: 1 });
    res.json({ success: true, messages });
  } catch (error) {
    next(error);
  }
};

const sendInternalMessage = async (senderId, receiverId, chatId, text) => {
  // Check if receiver has blocked the sender
  const receiverUser = await User.findById(receiverId);
  if (receiverUser && receiverUser.blockedUsers && receiverUser.blockedUsers.some(id => id.toString() === senderId.toString())) {
    throw new Error('Cannot send message to this user (Blocked).');
  }

  const isReceiverOnline = userSockets && userSockets.has(receiverId.toString());
  const messageStatus = isReceiverOnline ? 'delivered' : 'sent';

  const newMessage = {
    sender: senderId,
    receiver: receiverId,
    text: text,
    chatId: chatId,
    status: messageStatus,
    messageType: 'text',
    mediaUrl: null
  };

  try {
    let message = await Message.create(newMessage);
    
    let chat = await Chat.findById(chatId);
    if(chat) {
        chat.lastMessage = message._id;
        const currentCount = chat.unreadCounts?.get(receiverId.toString()) || 0;
        chat.unreadCounts?.set(receiverId.toString(), currentCount + 1);

        if (chat.deletedBy && chat.deletedBy.length > 0) {
          chat.deletedBy = chat.deletedBy.filter(id => 
            id.toString() !== senderId.toString() && id.toString() !== receiverId.toString()
          );
        }

        await chat.save();
    }

    message = await message.populate('sender', 'name profilePicture');
    message = await message.populate('chatId');
    message = await User.populate(message, { path: 'chatId.participants', select: 'name profilePicture email isOnline lastSeen' });

    const notification = await Notification.create({
      receiver: receiverId,
      sender: senderId,
      type: 'message',
      text: `sent you a gift: ${text.replace('GIFT_MESSAGE:', '')}`,
      isRead: false,
    });

    const populatedNotif = await notification.populate('sender', 'name username profilePicture');

    // Trigger FCM Push Notification
    const receiverTokenUser = await User.findById(receiverId);
    if (receiverTokenUser && receiverTokenUser.pushToken && receiverTokenUser.notificationsEnabled) {
      await sendPushNotification(receiverTokenUser.pushToken, `New gift`, text.replace('GIFT_MESSAGE:', ''), { type: 'CHAT', chatId: chatId.toString(), senderId: senderId.toString() });
    }

    if (ioInstance) {
        ioInstance.to(`chat_${chatId}`).emit('receive_message', message);
        ioInstance.to(`user_${receiverId}`).emit('receive_notification', {
          ...populatedNotif.toObject(),
          chatId,
        });
        ioInstance.to(`user_${receiverId}`).emit('chat_list_update', { chatId });
    }

    return message;
  } catch (error) {
    console.error('[sendInternalMessage] ERROR:', error);
    throw error;
  }
};

const uploadMedia = async (req, res, next) => {
  try {
    if (!req.file && !req.files) {
      return res.status(400).json({ success: false, message: 'No media file provided' });
    }
    
    const file = req.file || (req.files && req.files.media && req.files.media[0]);
    
    if (!file) {
      return res.status(400).json({ success: false, message: 'No media file found in request' });
    }

    const mediaUrl = `/uploads/${file.filename}`;
    res.json({ success: true, mediaUrl });
  } catch (error) {
    next(error);
  }
};

// @desc    Send a gift inside a chat
// @route   POST /api/messages/send-gift
// @access  Private
const sendGift = async (req, res, next) => {
  const { chatId, receiverId, giftId, giftName, giftPrice, giftImage, giftEmoji } = req.body;
  const senderId = req.user.id;

  if (!chatId || !receiverId || !giftName || giftPrice === undefined || giftPrice === null) {
    return res.status(400).json({ success: false, message: 'Missing gift data' });
  }

  try {
    const sender = await User.findById(senderId);
    const receiver = await User.findById(receiverId);

    if (!sender || !receiver) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // For paid gifts: check sender wallet balance
    if (giftPrice > 0 && sender.walletBalance < giftPrice) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
    }

    // ── Deduct from sender (wallet) ──────────────────────────
    if (giftPrice > 0) {
      sender.walletBalance -= giftPrice;
      await sender.save();
    }

    // ── Credit receiver earnings (only receiver earns) ──────
    // coins = withdrawable balance, totalEarnedCoins = all-time earned
    receiver.coins += giftPrice;
    receiver.totalEarnedCoins += giftPrice;
    receiver.totalGiftsReceived += 1;
    await receiver.save();

    // ── Create gift message ──────────────────────────────────
    const isReceiverOnline = userSockets && userSockets.has(receiverId.toString());
    const messageStatus = isReceiverOnline ? 'delivered' : 'sent';

    const newMessage = {
      sender: senderId,
      receiver: receiverId,
      text: `Sent a gift: ${giftEmoji || giftName}`,
      chatId: chatId,
      status: messageStatus,
      messageType: 'gift',
      giftId: giftId || '',
      giftName: giftName,   // Human-readable name e.g. "Diamond"
      giftPrice,
      giftImage: giftEmoji || giftImage || '', // Store emoji as giftImage fallback
    };

    let message = await Message.create(newMessage);

    // Update chat
    let chat = await Chat.findById(chatId);
    if(chat) {
        chat.lastMessage = message._id;
        const currentCount = chat.unreadCounts?.get(receiverId.toString()) || 0;
        chat.unreadCounts?.set(receiverId.toString(), currentCount + 1);

        if (chat.deletedBy && chat.deletedBy.length > 0) {
          chat.deletedBy = chat.deletedBy.filter(id => 
            id.toString() !== senderId.toString() && id.toString() !== receiverId.toString()
          );
        }
        await chat.save();
    }

    message = await message.populate('sender', 'name profilePicture');
    message = await message.populate('chatId');
    message = await User.populate(message, { path: 'chatId.participants', select: 'name profilePicture email isOnline lastSeen' });

    // ── Log transactions ─────────────────────────────────────
    // Sender deduction log
    if (giftPrice > 0) {
      await Transaction.create({
        userId: senderId,
        type: 'gift_sent',
        amount: -giftPrice,
        currency: 'INR',
        status: 'completed',
        relatedGiftName: giftName,
        relatedUserId: receiverId,
        description: `Sent gift: ${giftEmoji || ''} ${giftName} (₹${giftPrice}) to ${receiver.name}`,
      });
    }

    // Receiver earnings log
    if (giftPrice > 0) {
      await Transaction.create({
        userId: receiverId,
        type: 'gift_received',
        amount: giftPrice,
        currency: 'INR',
        coinsAdded: giftPrice,
        status: 'completed',
        relatedGiftName: giftName,
        relatedUserId: senderId,
        description: `Received gift: ${giftEmoji || ''} ${giftName} (₹${giftPrice}) from ${sender.name}`,
      });
    }

    // ── Notification ─────────────────────────────────────────
    const notification = await Notification.create({
      receiver: receiverId,
      sender: senderId,
      type: 'message',
      text: `sent you a ${giftEmoji || ''} ${giftName} gift worth ₹${giftPrice}!`,
      isRead: false,
    });
    const populatedNotif = await notification.populate('sender', 'name username profilePicture');

    // Trigger FCM Push Notification
    if (receiver && receiver.pushToken && receiver.notificationsEnabled) {
      await sendPushNotification(receiver.pushToken, `New Gift from ${sender.name}`, `Sent you a ${giftEmoji || ''} ${giftName} gift!`, { type: 'CHAT', chatId: chatId.toString(), senderId: senderId.toString() });
    }

    // ── Socket events ─────────────────────────────────────────
    if (ioInstance) {
        // Gift message appears in chat for both users
        ioInstance.to(`chat_${chatId}`).emit('receive_message', message);

        ioInstance.to(`user_${receiverId}`).emit('receive_notification', {
          ...populatedNotif.toObject(),
          chatId,
        });
        ioInstance.to(`user_${receiverId}`).emit('chat_list_update', { chatId });
        
        // Update sender wallet display
        ioInstance.to(`user_${senderId}`).emit('wallet_updated', {
          walletBalance: sender.walletBalance,
        });
        
        // Update receiver earnings display — compute true balance from transaction history
        const mongoose = require('mongoose');
        const receiverBalanceResult = await Transaction.aggregate([
          { $match: { userId: new mongoose.Types.ObjectId(receiverId.toString()) } },
          {
            $group: {
              _id: null,
              totalReceived: {
                $sum: { $cond: [{ $eq: ['$type', 'gift_received'] }, '$amount', 0] }
              },
              totalWithdrawn: {
                $sum: { $cond: [{ $eq: ['$type', 'withdrawal_payout'] }, { $abs: '$amount' }, 0] }
              },
            }
          }
        ]);
        const rcvBal = receiverBalanceResult.length > 0 ? receiverBalanceResult[0] : { totalReceived: 0, totalWithdrawn: 0 };
        const computedAvailableBalance = Math.max(0, rcvBal.totalReceived - rcvBal.totalWithdrawn);

        ioInstance.to(`user_${receiverId}`).emit('earnings_updated', { 
          coins: receiver.coins, 
          totalEarnedCoins: rcvBal.totalReceived,
          availableBalance: computedAvailableBalance,
          totalGiftsReceived: receiver.totalGiftsReceived,
          latestGift: {
            giftName,
            giftEmoji: giftEmoji || '',
            giftPrice,
            senderName: sender.name,
          },
        });
    }

    res.json({ success: true, message, walletBalance: sender.walletBalance });
  } catch (error) {
    console.error('[sendGift] ERROR:', error);
    next(error);
  }
};

// @desc    Log a call message (missed, rejected, or completed)
// @route   POST /api/messages/call-log
// @access  Private
const saveCallLogHelper = async ({ chatId, senderId, receiverId, callType, callStatus, callDuration = 0 }) => {
  try {
    let chat = null;
    if (chatId) {
      chat = await Chat.findById(chatId);
    }
    if (!chat && senderId && receiverId) {
      chat = await Chat.findOne({
        participants: { $all: [senderId, receiverId] }
      });
      if (!chat) {
        chat = await Chat.create({
          participants: [senderId, receiverId],
          unreadCounts: new Map()
        });
      }
    }
    if (!chat) return null;

    const actualChatId = chat._id;
    const targetReceiverId = receiverId || chat.participants.find(p => p.toString() !== senderId.toString());

    const formatDur = (sec) => {
      if (!sec || sec <= 0) return '';
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return m > 0 ? `${m}m ${s}s` : `${s}s`;
    };

    const isVideo = callType === 'video';
    const icon = isVideo ? '📹' : '📞';
    const durStr = formatDur(callDuration);

    let textStr = '';
    if (callStatus === 'missed') {
      textStr = `${icon} Missed ${isVideo ? 'video' : 'voice'} call`;
    } else if (callStatus === 'rejected') {
      textStr = `${icon} Declined ${isVideo ? 'video' : 'voice'} call`;
    } else {
      textStr = `${icon} ${isVideo ? 'Video' : 'Voice'} call ${durStr ? '(' + durStr + ')' : ''}`.trim();
    }

    const isReceiverOnline = userSockets && userSockets.has(targetReceiverId.toString());
    const messageStatus = isReceiverOnline ? 'delivered' : 'sent';

    const newMessage = await Message.create({
      chatId: actualChatId,
      sender: senderId,
      receiver: targetReceiverId,
      text: textStr,
      messageType: 'call',
      callType: callType || 'voice',
      callStatus: callStatus || 'completed',
      callDuration: callDuration || 0,
      status: messageStatus,
    });

    chat.lastMessage = newMessage._id;
    if (callStatus === 'missed' || callStatus === 'rejected') {
      const currentCount = chat.unreadCounts.get(targetReceiverId.toString()) || 0;
      chat.unreadCounts.set(targetReceiverId.toString(), currentCount + 1);
    }
    await chat.save();

    let message = await Message.findById(newMessage._id)
      .populate('sender', 'name profilePicture')
      .populate('chatId');

    // Socket emit to chat room
    if (ioInstance) {
      console.log(`[saveCallLogHelper] Emitting call message to room chat_${actualChatId}`);
      ioInstance.to(`chat_${actualChatId}`).emit('receive_message', message);
    }

    // FCM Push Notification for missed call (only if missed and not self)
    if (callStatus === 'missed' && targetReceiverId && targetReceiverId.toString() !== senderId.toString()) {
      const senderUser = await User.findById(senderId);
      const receiverUser = await User.findById(targetReceiverId);
      const senderName = senderUser ? (senderUser.name || senderUser.username) : 'Someone';

      const notification = await Notification.create({
        receiver: targetReceiverId,
        sender: senderId,
        type: 'message',
        text: `Missed ${isVideo ? 'video' : 'voice'} call from ${senderName}`,
        isRead: false,
      });

      const populatedNotif = await notification.populate('sender', 'name username profilePicture');

      if (receiverUser && receiverUser.pushToken && receiverUser.notificationsEnabled) {
        if (senderUser && senderUser.pushToken === receiverUser.pushToken) {
          console.log('[saveCallLogHelper] Sender and Receiver share the same Push Token. Skipping push notification.');
        } else {
          let pushTitle = `Missed ${isVideo ? 'Video' : 'Voice'} Call`;
          let pushBody = `${senderName} tried to call you`;
          await sendPushNotification(receiverUser.pushToken, pushTitle, pushBody, {
            type: 'MISSED_CALL',
            chatId: actualChatId.toString(),
            senderId: senderId.toString()
          });
        }
      }

      if (ioInstance) {
        ioInstance.to(`user_${targetReceiverId}`).emit('receive_notification', {
          ...populatedNotif.toObject(),
          chatId: actualChatId,
        });
      }
    }

    return message;
  } catch (err) {
    console.error('[saveCallLogHelper] Error:', err);
    return null;
  }
};

const logCallMessage = async (req, res, next) => {
  try {
    const { chatId, receiverId, callType, callStatus, callDuration } = req.body;
    const senderId = req.user.id;

    if (!receiverId && !chatId) {
      return res.status(400).json({ success: false, message: 'Receiver ID or Chat ID is required' });
    }

    const message = await saveCallLogHelper({
      chatId,
      senderId,
      receiverId,
      callType,
      callStatus,
      callDuration: parseInt(callDuration || 0, 10)
    });

    if (!message) {
      return res.status(500).json({ success: false, message: 'Failed to create call log message' });
    }

    res.json({ success: true, message });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a single message by ID (call log or text message)
// @route   DELETE /api/messages/:id
// @access  Private
const deleteMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const message = await Message.findById(id);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    const senderIdStr = message.sender ? message.sender.toString() : '';
    const receiverIdStr = message.receiver ? message.receiver.toString() : '';

    if (senderIdStr !== userId.toString() && receiverIdStr !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this message' });
    }

    await Message.findByIdAndDelete(id);

    if (ioInstance && message.chatId) {
      ioInstance.to(`chat_${message.chatId}`).emit('message_deleted', { messageId: id });
    }

    res.json({ success: true, message: 'Message deleted successfully', messageId: id });
  } catch (error) {
    next(error);
  }
};

// @desc    Clear all call log messages in a chat
// @route   DELETE /api/messages/calls/clear/:chatId
// @access  Private
const clearCallLogs = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    const chat = await Chat.findById(chatId);
    if (!chat || !chat.participants.map(p => p.toString()).includes(userId.toString())) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await Message.deleteMany({
      chatId,
      messageType: 'call',
    });

    if (ioInstance) {
      ioInstance.to(`chat_${chatId}`).emit('call_logs_cleared', { chatId });
    }

    res.json({ success: true, message: 'All call logs cleared for this chat' });
  } catch (error) {
    next(error);
  }
};

module.exports = { 
  sendMessage, 
  allMessages, 
  uploadMedia, 
  setIO, 
  sendInternalMessage, 
  sendGift, 
  logCallMessage, 
  saveCallLogHelper,
  deleteMessage,
  clearCallLogs,
};
