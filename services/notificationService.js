const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendPushNotification } = require('./firebase');

const sendNotification = async (receiverId, senderId, type, text, ioInstance = null, dataPayload = {}) => {
  try {
    // 1. Save notification to Database
    const notification = await Notification.create({
      receiver: receiverId,
      sender: senderId,
      type,
      text,
      isRead: false,
    });

    // Populate sender details
    const populated = await Notification.findById(notification._id)
      .populate('sender', 'username name profilePicture')
      .exec();

    // 2. Deliver via Socket.IO if user is online
        if (ioInstance) {
      const roomName = `user_${receiverId}`;
      const idStr = String(receiverId);
      
      // Emit to user rooms and direct ID
      ioInstance.to(roomName).emit('order_notification_updated', populated);
      ioInstance.to(roomName).emit('notification_updated', populated);
      ioInstance.to(roomName).emit('new_notification', populated);
      ioInstance.to(roomName).emit('receive_notification', populated);
      ioInstance.to(roomName).emit('order_status_updated', {
        bookingId: bIdStr,
        orderId: bIdStr,
        status: statusKey,
        orderStatus: statusKey,
        title: title || 'Order Update',
        message: text,
        notification: populated,
      });

      ioInstance.to(idStr).emit('order_notification_updated', populated);
      ioInstance.to(idStr).emit('new_notification', populated);
      ioInstance.to(idStr).emit('receive_notification', populated);
      ioInstance.to(idStr).emit('order_status_updated', {
        bookingId: bIdStr,
        orderId: bIdStr,
        status: statusKey,
        orderStatus: statusKey,
        title: title || 'Order Update',
        message: text,
        notification: populated,
      });

      console.log(`📡 [NOTIF SOCKET EMITTED] Emitted auto notification to user ${idStr} for order ${bIdStr}: "${text}"`);
    }

    // 3. Trigger Actual FCM Push Notification
    const receiver = await User.findById(receiverId);
    if (receiver && receiver.pushToken && receiver.notificationsEnabled) {
      console.log(`[Push Notification] Sending to Token: ${receiver.pushToken} | Title: ${type} | Body: ${text}`);
      await sendPushNotification(receiver.pushToken, `New ${type}`, text, { ...dataPayload, type });
    }

    return populated;
  } catch (error) {
    console.error('Error in sendNotification service:', error);
  }
};

/**
 * Single Active Order Notification (Requirement 11)
 * Dynamically replaces/updates the single active order notification for the user.
 */
const updateOrSendOrderNotification = async (receiverId, senderId, orderId, statusKey, text, title, ioInstance = null, dataPayload = {}) => {
  try {
    if (!receiverId || !orderId) return null;
    const bIdStr = String(orderId);

    // Find existing notification for this order and receiver
    let existing = await Notification.findOne({
      receiver: receiverId,
      $or: [{ orderId: bIdStr }, { bookingId: bIdStr }],
    });

    let notification;
    if (existing) {
      existing.text = text;
      existing.title = title || 'Order Update';
      existing.statusKey = statusKey;
      existing.type = 'order_status';
      existing.isRead = false;
      existing.data = { ...dataPayload, orderId: bIdStr, statusKey };
      if (senderId) existing.sender = senderId;
      await existing.save();
      notification = existing;
      console.log(`🔔 [DYNAMIC NOTIF UPDATED] Order ${bIdStr} notification updated for user ${receiverId}: "${text}"`);
    } else {
      notification = await Notification.create({
        receiver: receiverId,
        sender: senderId || null,
        type: 'order_status',
        orderId: bIdStr,
        bookingId: bIdStr,
        statusKey: statusKey,
        title: title || 'Order Update',
        text: text,
        isRead: false,
        data: { ...dataPayload, orderId: bIdStr, statusKey },
      });
      console.log(`🔔 [DYNAMIC NOTIF CREATED] Order ${bIdStr} notification created for user ${receiverId}: "${text}"`);
    }

    const populated = await Notification.findById(notification._id)
      .populate('sender', 'username name profilePicture')
      .exec();

    if (ioInstance) {
      const roomName = `user_${receiverId}`;
      ioInstance.to(roomName).emit('order_notification_updated', populated);
      ioInstance.to(roomName).emit('notification_updated', populated);
      ioInstance.to(roomName).emit('new_notification', populated);
    }

    // FCM Push Notification
    try {
      const receiver = await User.findById(receiverId);
      if (receiver && receiver.pushToken && receiver.notificationsEnabled) {
        await sendPushNotification(receiver.pushToken, title || 'Ride Hub Order', text, {
          ...dataPayload,
          orderId: bIdStr,
          statusKey,
          type: 'order_status',
        });
      }
    } catch (_) {}

    return populated;
  } catch (error) {
    console.error('Error in updateOrSendOrderNotification:', error);
    return null;
  }
};

module.exports = { sendNotification, updateOrSendOrderNotification };
