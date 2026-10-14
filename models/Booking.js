const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    customerId: {
      type: String,
      required: true,
    },
    customerName: {
      type: String,
    },
    customerPhone: {
      type: String,
    },
    customerPhoto: {
      type: String,
      default: null,
    },
    serviceId: {
      type: String,
    },
    serviceName: {
      type: String,
      required: true,
    },
    categoryName: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
      default: 299,
    },
    providerId: {
      type: String,
      default: null,
    },
    providerName: {
      type: String,
      default: null,
    },
    providerPhone: {
      type: String,
      default: null,
    },
    providerPhoto: {
      type: String,
      default: null,
    },
    providerRating: {
      type: Number,
      default: 4.9,
    },
    serviceAddress: {
      type: String,
      default: 'Service Location',
    },
    latitude: {
      type: Number,
      default: 0,
    },
    longitude: {
      type: Number,
      default: 0,
    },
    scheduledDate: {
      type: String,
      default: () => new Date().toISOString().split('T')[0],
    },
    scheduledTime: {
      type: String,
      default: () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
    propertyType: {
      type: String,
      default: 'Apartment',
    },
    numRooms: {
      type: String,
      default: '2 BHK',
    },
    specialInstructions: {
      type: String,
      default: '',
    },
    // Food Delivery & Restaurant Fields
    restaurantId: {
      type: String,
      default: null,
      index: true,
    },
    partnerId: {
      type: String,
      default: null,
      index: true,
    },
    preparationTime: {
      type: Number,
      default: 15,
      min: 5,
      max: 20,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    foodReadyAt: {
      type: Date,
      default: null,
    },
    restaurantName: {
      type: String,
      default: '',
    },
    pickupAddress: {
      type: String,
      default: '',
    },
    pickupLatitude: {
      type: Number,
      default: null,
    },
    pickupLongitude: {
      type: Number,
      default: null,
    },
    restaurantPhoto: {
      type: String,
      default: '',
    },
    restaurantPhotos: {
      type: [String],
      default: [],
    },

    // ── Preparation Timer (server-side timestamps) ──
    prepStartedAt: {
      type: Date,
      default: null,
    },
    prepEndsAt: {
      type: Date,
      default: null,
    },

    // ── Rider Assignment ──
    riderId: {
      type: String,
      default: null,
      index: true,
    },
    riderName: {
      type: String,
      default: null,
    },
    riderPhone: {
      type: String,
      default: null,
    },
    riderStatus: {
      type: String,
      default: 'NONE',
    },
    riderReachedAt: {
      type: Date,
      default: null,
    },
    deliveryStatus: {
      type: String,
      default: 'NOT_REQUIRED',
    },
    // Riders who rejected this order — skip them in future search
    rejectedRiders: {
      type: [String],
      default: [],
    },
    // Detailed Decline History for persistent record
    declineHistory: [
      {
        riderId: { type: String, required: true },
        riderName: { type: String, default: 'Rider' },
        status: { type: String, default: 'DECLINED' },
        timestamp: { type: Date, default: Date.now },
        reason: { type: String, default: 'Rider Declined' },
      },
    ],
    // Rider Compensation on cancellation
    riderCompensation: {
      type: Number,
      default: 0,
    },
    riderCompensationPaid: {
      type: Boolean,
      default: false,
    },
    riderArrivalGuaranteedPaid: {
      type: Boolean,
      default: false,
    },
    riderArrivalFee: {
      type: Number,
      default: 20,
    },
    cancellationStage: {
      type: String,
      default: 'BEFORE_ACCEPTANCE',
    },
    financialBreakdown: {
      customerPaid: { type: Number, default: 0 },
      customerRefund: { type: Number, default: 0 },
      supplierGross: { type: Number, default: 0 },
      supplierDeductions: { type: Number, default: 0 },
      supplierNet: { type: Number, default: 0 },
      riderFare: { type: Number, default: 0 },
      riderArrivalCompensation: { type: Number, default: 0 },
      platformShare: { type: Number, default: 0 },
    },
    // Currently pending rider request (not yet accept/reject)
    pendingRiderId: {
      type: String,
      default: null,
    },

    destinationAddress: {
      type: String,
      default: '',
    },
    destinationLatitude: {
      type: Number,
      default: null,
    },
    destinationLongitude: {
      type: Number,
      default: null,
    },
    supplierId: {
      type: String,
      default: null,
      index: true,
    },
    supplierCategory: {
      type: String,
      default: null,
    },
    categoryId: {
      type: String,
      default: null,
    },
    supplierBusinessLatitude: {
      type: Number,
      default: null,
    },
    supplierBusinessLongitude: {
      type: Number,
      default: null,
    },
    supplierBusinessAddress: {
      type: String,
      default: '',
    },
    customerLatitude: {
      type: Number,
      default: null,
    },
    customerLongitude: {
      type: Number,
      default: null,
    },
    customerAddress: {
      type: String,
      default: '',
    },
    pickupLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      address: { type: String, default: '' },
      supplierId: { type: String, default: null },
    },
    dropLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      address: { type: String, default: '' },
      customerId: { type: String, default: null },
    },
    distanceKm: {
      type: Number,
      default: 0,
    },
    deliveryFee: {
      type: Number,
      default: 0,
    },
    subtotal: {
      type: Number,
      default: 0,
    },
    cartItems: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    weatherIncentive: {
      type: Number,
      default: 0,
    },
    isRaining: {
      type: Boolean,
      default: false,
    },
    businessCategoryName: {
      type: String,
      default: '',
    },
    partnerType: {
      type: String,
      default: '',
    },
    storeCategory: {
      type: String,
      default: '',
    },
    businessType: {
      type: String,
      default: '',
    },
    paymentMethod: {
      type: String,
      default: 'online',
    },
    razorpayOrderId: {
      type: String,
      default: null,
    },
    razorpayPaymentId: {
      type: String,
      default: null,
    },
    razorpaySignature: {
      type: String,
      default: null,
    },
    cashfreeOrderId: {
      type: String,
      default: null,
    },
    cashfreePaymentId: {
      type: String,
      default: null,
    },
    paymentSessionId: {
      type: String,
      default: null,
    },
    razorpayOrderId: {
      type: String,
      default: null,
    },
    razorpayPaymentId: {
      type: String,
      default: null,
    },
    razorpaySignature: {
      type: String,
      default: null,
    },
    deliveryOtp: {
      type: String,
      default: null,
    },
    otp: {
      type: String,
      default: null,
    },
    paymentStatus: {
      type: String,
      default: 'PAID',
    },
    status: {
      type: String,
      default: 'ORDER_PLACED',
    },
    cancellationReason: {
      type: String,
      default: null,
    },
    cancelledBy: {
      type: String,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    paidAmount: {
      type: Number,
      default: 0,
    },
    refundAmount: {
      type: Number,
      default: 0,
    },
    refundStatus: {
      type: String,
      enum: ['NOT_APPLICABLE', 'PENDING', 'REFUND_PROCESSED', 'NO_REFUND', 'FAILED'],
      default: 'NOT_APPLICABLE',
    },
    isNonRefundable: {
      type: Boolean,
      default: false,
    },
    cancellationFee: {
      type: Number,
      default: 0,
    },
    rating: {
      type: Number,
      default: null,
    },
    // ── Separate Ratings for Restaurant/Supplier and Rider (Requirement 17) ──
    restaurantRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    restaurantFeedback: {
      type: String,
      default: '',
      trim: true,
    },
    restaurantRatedAt: {
      type: Date,
      default: null,
    },
    riderRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    riderFeedback: {
      type: String,
      default: '',
      trim: true,
    },
    riderRatedAt: {
      type: Date,
      default: null,
    },
    // ── Zone & City Details ──
    zoneId: {
      type: String,
      default: 'old_bhopal',
      index: true,
    },
    zoneName: {
      type: String,
      default: 'Your Zone',
    },
    cityName: {
      type: String,
      default: 'Bhopal',
      index: true,
    },

    // ── Complete Order Stage Timestamps & Total Duration ──
    placedAt: {
      type: Date,
      default: Date.now,
    },
    restaurantAcceptedAt: {
      type: Date,
      default: null,
    },
    riderAssignedAt: {
      type: Date,
      default: null,
    },
    riderReachedRestoAt: {
      type: Date,
      default: null,
    },
    orderReadyAt: {
      type: Date,
      default: null,
    },
    riderPickedUpAt: {
      type: Date,
      default: null,
    },
    riderStartedDeliveryAt: {
      type: Date,
      default: null,
    },
    riderReachedCustomerAt: {
      type: Date,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    totalDeliveryDurationMinutes: {
      type: Number,
      default: null,
    },

    // ── Complete Emergency Order Transfer & Handover System ──
    transferStatus: {
      type: String,
      enum: ['NONE', 'TRANSFER_REQUESTED', 'TRANSFER_ACCEPTED_PENDING_HANDOVER', 'TRANSFER_COMPLETED', 'TRANSFER_CANCELLED', 'TRANSFER_EXPIRED'],
      default: 'NONE',
      index: true,
    },
    transferReason: {
      type: String,
      default: null,
    },
    transferDetails: {
      type: String,
      default: null,
    },
    transferLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      address: { type: String, default: '' },
      accuracy: { type: Number, default: null },
      timestamp: { type: Date, default: null },
    },
    originalRiderId: {
      type: String,
      default: null,
    },
    originalRiderName: {
      type: String,
      default: null,
    },
    originalRiderPhone: {
      type: String,
      default: null,
    },
    transferRiderId: {
      type: String,
      default: null,
    },
    transferRiderName: {
      type: String,
      default: null,
    },
    transferRiderPhone: {
      type: String,
      default: null,
    },
    transferRiderPhoto: {
      type: String,
      default: null,
    },
    transferOtp: {
      type: String,
      default: null,
    },
    transferOtpExpiresAt: {
      type: Date,
      default: null,
    },
    transferOtpVerifiedAt: {
      type: Date,
      default: null,
    },
    transferCompensation: {
      type: Number,
      default: 0,
    },
    previousRiderId: {
      type: String,
      default: null,
    },

    // ── Rider Assignment & Transfer History ──
    transferHistory: [
      {
        transferId: { type: String, default: null },
        previousRiderId: String,
        previousRiderName: String,
        previousRiderPhone: String,
        transferTime: { type: Date, default: Date.now },
        transferReason: String,
        transferDetails: String,
        nextRiderId: String,
        nextRiderName: String,
        nextRiderPhone: String,
        nextRiderAcceptedTime: Date,
        transferLocation: {
          latitude: Number,
          longitude: Number,
          address: String,
        },
        otpVerifiedAt: Date,
        status: { type: String, default: 'COMPLETED' },
      },
    ],

    // ── Support Admin Cancellation Request System ──
    cancellationRequest: {
      isPending: { type: Boolean, default: false, index: true },
      requestedByRole: { type: String, default: null },
      requestedById: { type: String, default: null },
      requestedByName: { type: String, default: null },
      reason: { type: String, default: null },
      stageAtRequest: { type: String, default: null },
      requestedAt: { type: Date, default: null },
      cancellationCharge: { type: Number, default: 0 },
      expectedRefund: { type: Number, default: 0 },
      reviewedBy: { type: String, default: null },
      reviewedAt: { type: Date, default: null },
      status: { type: String, default: 'NONE' },
      rejectionReason: { type: String, default: null },
    },

    // ── Financials: Refund, Cancellation Charge, Restaurant Penalty ──
    cancellationCharge: {
      type: Number,
      default: 0,
    },
    refundAmount: {
      type: Number,
      default: 0,
    },
    refundStatus: {
      type: String,
      default: 'NONE',
    },
    restaurantPenaltyAmount: {
      type: Number,
      default: 0,
    },
    restaurantPenaltyWaived: {
      type: Boolean,
      default: false,
    },
    restaurantPenaltyReason: {
      type: String,
      default: '',
    },
    restaurantCancellationFault: {
      type: String,
      enum: ['RESTAURANT_FAULT', 'SYSTEM_ISSUE', 'CUSTOMER_RELATED', 'NONE'],
      default: 'NONE',
    },
  },
  { timestamps: true }
);

bookingSchema.index({ customerId: 1, createdAt: -1 });
bookingSchema.index({ providerId: 1, createdAt: -1 });
bookingSchema.index({ restaurantId: 1, createdAt: -1 });
bookingSchema.index({ supplierId: 1, createdAt: -1 });
bookingSchema.index({ customerId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ providerId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ supplierId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ scheduledDate: 1 });
bookingSchema.index({ deliveryStatus: 1 });
bookingSchema.index({ deliveryStatus: 1, riderId: 1, status: 1 });
module.exports = mongoose.model('Booking', bookingSchema);
