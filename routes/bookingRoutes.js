const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { optionalProtect, protect, protectOrRestaurant } = require('../middleware/authMiddleware');

// Apply optionalProtect middleware across all booking routes to extract req.user when Bearer token is provided
router.use(optionalProtect);

// Booking Routes
router.post('/', bookingController.createBooking);
router.post('/create', bookingController.createBooking);
router.post('/request', bookingController.createBooking);
router.get('/my-bookings', bookingController.getMyBookings);
router.get('/history', bookingController.getMyBookings);
router.get('/active', bookingController.getActiveBooking);
router.get('/status', bookingController.getBookingStatus);
router.get('/status/:bookingId', bookingController.getBookingStatus);
router.get('/:bookingId/status', bookingController.getBookingStatus);
router.put('/status', bookingController.updateBookingStatus);
router.post('/status', bookingController.updateBookingStatus);
router.put('/:bookingId/status', bookingController.updateBookingStatus);
router.post('/:bookingId/status', bookingController.updateBookingStatus);
router.put('/status/:bookingId', bookingController.updateBookingStatus);
router.post('/status/:bookingId', bookingController.updateBookingStatus);
router.post('/cancel', bookingController.cancelBooking);
router.put('/cancel', bookingController.cancelBooking);
router.post('/:bookingId/cancel', bookingController.cancelBooking);
router.put('/:bookingId/cancel', bookingController.cancelBooking);
router.put('/restaurant-accept', bookingController.restaurantAcceptOrder);
router.post('/restaurant-accept', bookingController.restaurantAcceptOrder);
router.put('/food-ready', bookingController.restaurantFoodReady);
router.post('/food-ready', bookingController.restaurantFoodReady);
router.put('/restaurant-decline', bookingController.restaurantDeclineOrder);
router.post('/restaurant-decline', bookingController.restaurantDeclineOrder);
router.put('/rider-accept', bookingController.riderAcceptDelivery);
router.post('/rider-accept', bookingController.riderAcceptDelivery);
router.put('/:bookingId/rider-accept', bookingController.riderAcceptDelivery);
router.put('/rider-reject', bookingController.riderRejectDelivery);
router.post('/rider-reject', bookingController.riderRejectDelivery);
router.post('/rider-transfer-order', bookingController.riderTransferOrder);
router.put('/rider-transfer-order', bookingController.riderTransferOrder);

// ── Complete Emergency Order Transfer & Handover System ──
router.post('/transfer/request', bookingController.requestOrderTransfer);
router.post('/transfer/accept', bookingController.acceptOrderTransfer);
router.get('/transfer/otp', bookingController.getTransferOtp);
router.post('/transfer/otp', bookingController.getTransferOtp);
router.post('/transfer/verify', bookingController.verifyTransferHandover);
router.post('/transfer/cancel', bookingController.cancelOrderTransfer);
router.get('/details/:bookingId', bookingController.getBookingById);
router.post('/rate', bookingController.rateBooking);
router.get('/earnings', bookingController.getProviderEarnings);
router.post('/withdraw', bookingController.requestProviderWithdrawal);
router.get('/transactions', bookingController.getProviderTransactions);

router.get('/restaurant/reached-riders-count', bookingController.getReachedRidersCount);
router.get('/restaurant/riders', bookingController.getRestaurantRiders);
router.get('/pending-rider-request', bookingController.getPendingRiderRequest);
router.get('/rider/nearby-hotspots', bookingController.getRiderNearbyHotspots);
router.get('/reviews/:restaurantId', bookingController.getRestaurantReviews);
router.get('/restaurant/:restaurantId/reviews', bookingController.getRestaurantReviews);
router.get('/supplier/my-reviews', bookingController.getSupplierMyReviews);

// Parameterized wildcard route must be last
router.get('/:bookingId', bookingController.getBookingById);

module.exports = router;
