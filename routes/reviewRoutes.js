const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Review = require('../models/Review');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { upload, compressImage } = require('../middleware/uploadMiddleware');

// Dedicated Review Image Upload Endpoint
router.post('/upload-image', upload.single('image'), compressImage, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image uploaded' });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    return res.status(200).json({
      success: true,
      imageUrl,
      url: imageUrl,
      filename: req.file.filename,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Helper to calculate combined reviews and rating
async function calculateRestaurantRating(restaurantId) {
  const idVariants = [restaurantId, String(restaurantId)];
  if (mongoose.Types.ObjectId.isValid(restaurantId)) {
    idVariants.push(new mongoose.Types.ObjectId(restaurantId));
  }

  // 1. Fetch from Review model (Royal Dish panel & direct reviews)
  const directReviews = await Review.find({
    restaurantId: { $in: [restaurantId, String(restaurantId)] },
  }).sort({ createdAt: -1 }).lean();

  // 2. Fetch from Booking model (Order delivery reviews)
  const bookingReviews = await Booking.find({
    $or: [
      { restaurantId: { $in: idVariants } },
      { providerId: { $in: idVariants } },
      { partnerId: { $in: idVariants } },
      { supplierId: { $in: idVariants } },
    ],
    restaurantRating: { $ne: null, $gt: 0 },
  }).sort({ restaurantRatedAt: -1, createdAt: -1 }).lean();

  const formattedReviews = [];
  let totalScore = 0;

  for (const rev of directReviews) {
    const star = Number(rev.rating) || 5;
    totalScore += star;
    formattedReviews.push({
      _id: rev._id,
      id: rev._id,
      restaurantId: rev.restaurantId,
      rating: star,
      comment: rev.comment || '',
      feedback: rev.comment || '',
      userName: rev.userName || 'Guest Reviewer',
      customerName: rev.userName || 'Guest Reviewer',
      userPhoto: rev.userPhoto || '',
      image: rev.image || (Array.isArray(rev.photos) && rev.photos[0]) || '',
      photos: Array.isArray(rev.photos) ? rev.photos : (rev.image ? [rev.image] : []),
      source: rev.source || 'ROYAL_PANEL',
      createdAt: rev.createdAt,
    });
  }

  for (const ord of bookingReviews) {
    const star = Number(ord.restaurantRating) || 5;
    totalScore += star;
    formattedReviews.push({
      _id: ord._id,
      id: ord.bookingId || ord._id,
      restaurantId: ord.restaurantId || restaurantId,
      orderId: ord.bookingId || ord._id,
      rating: star,
      comment: ord.restaurantFeedback || ord.reviewText || 'Delicious food & prompt delivery!',
      feedback: ord.restaurantFeedback || ord.reviewText || 'Delicious food & prompt delivery!',
      userName: ord.customerName || 'Verified Customer',
      customerName: ord.customerName || 'Verified Customer',
      userPhoto: ord.customerPhoto || '',
      image: ord.dishImage || ord.itemImage || ord.reviewImage || '',
      photos: ord.reviewPhotos || (ord.dishImage ? [ord.dishImage] : []),
      source: 'ORDER_DELIVERY',
      createdAt: ord.restaurantRatedAt || ord.updatedAt || ord.createdAt,
    });
  }

  // Sort all reviews newest first
  formattedReviews.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalReviews = formattedReviews.length;
  const averageRating = totalReviews > 0 ? parseFloat((totalScore / totalReviews).toFixed(1)) : 4.8;

  return { formattedReviews, averageRating, totalReviews };
}

// Helper to sync calculated rating into User document
async function syncUserRating(restaurantId, averageRating, totalReviews) {
  try {
    const idVariants = [restaurantId, String(restaurantId)];
    if (mongoose.Types.ObjectId.isValid(restaurantId)) {
      idVariants.push(new mongoose.Types.ObjectId(restaurantId));
    }

    await User.updateMany(
      {
        $or: [
          { _id: { $in: idVariants } },
          { supplierId: { $in: idVariants } },
          { partnerId: { $in: idVariants } },
        ],
      },
      {
        $set: {
          rating: averageRating,
          reviewsCount: totalReviews,
          ratingCount: totalReviews,
        },
      }
    );
  } catch (uErr) {
    console.error('[UPDATE USER RATING ERROR]:', uErr.message);
  }
}

// @desc    Get all reviews and rating for a restaurant
// @route   GET /api/reviews/:restaurantId or GET /api/reviews?restaurantId=...
router.get(['/:restaurantId', '/'], async (req, res) => {
  try {
    const restaurantId = req.params.restaurantId || req.query.restaurantId || req.query.supplierId;
    if (!restaurantId || restaurantId === 'undefined' || restaurantId === 'null') {
      return res.status(400).json({ success: false, message: 'Valid restaurantId is required' });
    }

    const { formattedReviews, averageRating, totalReviews } = await calculateRestaurantRating(restaurantId);

    return res.status(200).json({
      success: true,
      restaurantId,
      averageRating,
      totalReviews,
      reviews: formattedReviews,
    });
  } catch (error) {
    console.error('[GET REVIEWS ERROR]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Submit a review (From Royal Dish web panel or Customer App)
// @route   POST /api/reviews
router.post('/', async (req, res) => {
  try {
    const { restaurantId, userName, rating, comment, userPhoto, image, photos, source } = req.body;

    if (!restaurantId || restaurantId === 'undefined' || restaurantId === 'null') {
      return res.status(400).json({ success: false, message: 'Valid restaurantId is required' });
    }

    const numericRating = Number(rating);
    if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be a number between 1 and 5' });
    }

    const cleanComment = (comment || '').trim();
    if (!cleanComment) {
      return res.status(400).json({ success: false, message: 'Review comment cannot be empty' });
    }

    const cleanUserName = (userName || '').trim() || 'Guest Diner';

    let resolvedImage = (image || req.body.photo || req.body.dishImage || '').trim();
    if (resolvedImage.startsWith('data:image')) {
      try {
        const matches = resolvedImage.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          const fname = `review-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
          const uploadDir = path.join(__dirname, '../uploads');
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          fs.writeFileSync(path.join(uploadDir, fname), buffer);
          resolvedImage = `/uploads/${fname}`;
        }
      } catch (e) {
        console.warn('Base64 review image parse error:', e.message);
      }
    }

    const resolvedPhotos = Array.isArray(photos) ? photos : (resolvedImage ? [resolvedImage] : []);

    // 1. Create permanent review in Review collection
    const newReview = await Review.create({
      restaurantId: String(restaurantId),
      userName: cleanUserName,
      rating: numericRating,
      comment: cleanComment,
      userPhoto: userPhoto || '',
      image: resolvedImage,
      photos: resolvedPhotos,
      source: source || 'ROYAL_PANEL',
    });

    // 2. Re-calculate overall average rating and total reviews
    const { averageRating, totalReviews } = await calculateRestaurantRating(restaurantId);

    // 3. Update the restaurant user record in MongoDB
    await syncUserRating(restaurantId, averageRating, totalReviews);

    // 4. Realtime Socket.IO Broadcast to all connected clients & rooms
    try {
      const io = req.app.get('io') || global.io;
      if (io) {
        const payload = {
          restaurantId: String(restaurantId),
          review: {
            _id: newReview._id,
            id: newReview._id,
            restaurantId: newReview.restaurantId,
            rating: newReview.rating,
            comment: newReview.comment,
            feedback: newReview.comment,
            userName: newReview.userName,
            customerName: newReview.userName,
            userPhoto: newReview.userPhoto,
            image: newReview.image || '',
            photos: newReview.photos || [],
            source: newReview.source,
            createdAt: newReview.createdAt,
          },
          averageRating,
          totalReviews,
        };

        // Broadcast to all listening customer apps and panels
        io.emit('RESTAURANT_REVIEWED', payload);
        io.emit('restaurant_rating_updated', payload);

        // Targeted room emits
        io.to(`restaurant_${restaurantId}`).emit('new_review_received', payload);
        io.to(`supplier_${restaurantId}`).emit('new_review_received', payload);
        io.to(`user_${restaurantId}`).emit('new_review_received', payload);

        console.log(`⭐ [REALTIME REVIEW BROADCAST]: Emitted RESTAURANT_REVIEWED with image for restaurant ${restaurantId} (New Rating: ${averageRating}, Total: ${totalReviews})`);
      }
    } catch (sErr) {
      console.error('[SOCKET BROADCAST ERROR]:', sErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Review published successfully and counted in real-time!',
      review: newReview,
      averageRating,
      totalReviews,
    });
  } catch (error) {
    console.error('[SUBMIT REVIEW ERROR]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Edit/Update an existing review
// @route   PUT /api/reviews/:reviewId
router.put('/:reviewId', async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { userName, rating, comment, image, photos } = req.body;

    if (!reviewId) {
      return res.status(400).json({ success: false, message: 'reviewId is required' });
    }

    let resolvedRestaurantId = req.body.restaurantId;
    let updatedReviewObj = null;

    // Check if exists in Review collection
    let reviewDoc = null;
    if (mongoose.Types.ObjectId.isValid(reviewId)) {
      reviewDoc = await Review.findById(reviewId);
    }
    if (!reviewDoc) {
      reviewDoc = await Review.findOne({ _id: reviewId });
    }

    let resolvedImage = image !== undefined ? (image || '').trim() : undefined;
    if (resolvedImage && resolvedImage.startsWith('data:image')) {
      try {
        const matches = resolvedImage.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          const fname = `review-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
          const uploadDir = path.join(__dirname, '../uploads');
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          fs.writeFileSync(path.join(uploadDir, fname), buffer);
          resolvedImage = `/uploads/${fname}`;
        }
      } catch (e) {
        console.warn('Base64 image parse error:', e.message);
      }
    }

    if (reviewDoc) {
      if (userName && userName.trim()) reviewDoc.userName = userName.trim();
      if (rating !== undefined && !isNaN(Number(rating))) {
        reviewDoc.rating = Math.min(5, Math.max(1, Number(rating)));
      }
      if (comment && comment.trim()) reviewDoc.comment = comment.trim();
      if (resolvedImage !== undefined) {
        reviewDoc.image = resolvedImage;
        reviewDoc.photos = resolvedImage ? [resolvedImage] : [];
      } else if (Array.isArray(photos)) {
        reviewDoc.photos = photos;
        reviewDoc.image = photos[0] || '';
      }
      await reviewDoc.save();

      resolvedRestaurantId = resolvedRestaurantId || reviewDoc.restaurantId;
      updatedReviewObj = {
        _id: reviewDoc._id,
        id: reviewDoc._id,
        restaurantId: reviewDoc.restaurantId,
        userName: reviewDoc.userName,
        rating: reviewDoc.rating,
        comment: reviewDoc.comment,
        feedback: reviewDoc.comment,
        image: reviewDoc.image || '',
        photos: reviewDoc.photos || [],
        createdAt: reviewDoc.createdAt,
        updatedAt: reviewDoc.updatedAt,
      };
    } else {
      // Check if it's an order review in Booking
      const booking = await Booking.findOne({
        $or: [
          ...(mongoose.Types.ObjectId.isValid(reviewId) ? [{ _id: reviewId }] : []),
          { bookingId: reviewId },
        ],
      });

      if (booking) {
        if (userName && userName.trim()) booking.customerName = userName.trim();
        if (rating !== undefined && !isNaN(Number(rating))) {
          booking.restaurantRating = Math.min(5, Math.max(1, Number(rating)));
        }
        if (comment && comment.trim()) {
          booking.restaurantFeedback = comment.trim();
          booking.reviewText = comment.trim();
        }
        if (resolvedImage !== undefined) {
          booking.reviewImage = resolvedImage;
          booking.dishImage = resolvedImage;
        }
        await booking.save();

        resolvedRestaurantId = resolvedRestaurantId || booking.restaurantId || booking.supplierId || booking.providerId;
        updatedReviewObj = {
          _id: booking._id,
          id: booking.bookingId || booking._id,
          restaurantId: resolvedRestaurantId,
          userName: booking.customerName || 'Verified Customer',
          rating: booking.restaurantRating,
          comment: booking.restaurantFeedback,
          feedback: booking.restaurantFeedback,
          image: booking.reviewImage || booking.dishImage || '',
          photos: booking.reviewImage ? [booking.reviewImage] : [],
          createdAt: booking.restaurantRatedAt || booking.updatedAt,
        };
      } else {
        return res.status(404).json({ success: false, message: 'Review not found' });
      }
    }

    // Recalculate rating & review count
    const { averageRating, totalReviews } = await calculateRestaurantRating(resolvedRestaurantId);
    await syncUserRating(resolvedRestaurantId, averageRating, totalReviews);

    // Socket.IO Broadcast
    try {
      const io = req.app.get('io') || global.io;
      if (io) {
        const payload = {
          restaurantId: String(resolvedRestaurantId),
          reviewId: String(reviewId),
          review: updatedReviewObj,
          averageRating,
          totalReviews,
        };
        io.emit('RESTAURANT_REVIEW_UPDATED', payload);
        io.emit('RESTAURANT_REVIEWED', payload);
        io.emit('restaurant_rating_updated', payload);
      }
    } catch (sErr) {}

    return res.status(200).json({
      success: true,
      message: 'Review updated successfully!',
      review: updatedReviewObj,
      averageRating,
      totalReviews,
    });
  } catch (error) {
    console.error('[EDIT REVIEW ERROR]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Delete an existing review
// @route   DELETE /api/reviews/:reviewId
router.delete('/:reviewId', async (req, res) => {
  try {
    const { reviewId } = req.params;
    let targetRestaurantId = req.query.restaurantId || req.body?.restaurantId;

    if (!reviewId) {
      return res.status(400).json({ success: false, message: 'reviewId is required' });
    }

    let deleted = false;

    // 1. Check in Review collection
    let reviewDoc = null;
    if (mongoose.Types.ObjectId.isValid(reviewId)) {
      reviewDoc = await Review.findById(reviewId);
    }
    if (!reviewDoc) {
      reviewDoc = await Review.findOne({ _id: reviewId });
    }

    if (reviewDoc) {
      targetRestaurantId = targetRestaurantId || reviewDoc.restaurantId;
      await Review.deleteOne({ _id: reviewDoc._id });
      deleted = true;
    } else {
      // 2. Check in Booking collection
      const booking = await Booking.findOne({
        $or: [
          ...(mongoose.Types.ObjectId.isValid(reviewId) ? [{ _id: reviewId }] : []),
          { bookingId: reviewId },
        ],
      });

      if (booking) {
        targetRestaurantId = targetRestaurantId || booking.restaurantId || booking.supplierId || booking.providerId;
        booking.restaurantRating = null;
        booking.restaurantFeedback = null;
        booking.reviewText = null;
        await booking.save();
        deleted = true;
      }
    }

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Review not found to delete' });
    }

    // Recalculate stats
    const { averageRating, totalReviews } = await calculateRestaurantRating(targetRestaurantId);
    await syncUserRating(targetRestaurantId, averageRating, totalReviews);

    // Socket.IO Broadcast
    try {
      const io = req.app.get('io') || global.io;
      if (io) {
        const payload = {
          restaurantId: String(targetRestaurantId),
          reviewId: String(reviewId),
          averageRating,
          totalReviews,
          deleted: true,
        };
        io.emit('RESTAURANT_REVIEW_DELETED', payload);
        io.emit('restaurant_rating_updated', payload);
        io.emit('RESTAURANT_REVIEWED', payload);
        console.log(`🗑️ [REALTIME REVIEW DELETED]: Emitted RESTAURANT_REVIEW_DELETED for restaurant ${targetRestaurantId}`);
      }
    } catch (sErr) {}

    return res.status(200).json({
      success: true,
      message: 'Review deleted successfully!',
      reviewId,
      averageRating,
      totalReviews,
    });
  } catch (error) {
    console.error('[DELETE REVIEW ERROR]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
