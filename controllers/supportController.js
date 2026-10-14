const mongoose = require('mongoose');
const SupportCase = require('../models/SupportCase');
const SupportPayoutRule = require('../models/SupportPayoutRule');
const SupportLedger = require('../models/SupportLedger');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Zone = require('../models/Zone');
const AuditLog = require('../models/AuditLog');
const { SupportWallet, SupportWithdrawal } = require('../models/SupportWallet');

let _io = null;
const setIO = (ioInstance) => {
  _io = ioInstance;
};

const getIO = (req) => {
  return req?.app?.get('io') || global.io || _io;
};

// Default payout rules seed
const DEFAULT_PAYOUT_RULES = [
  { category: 'bike_problem', amount: 25 },
  { category: 'restaurant_out_of_stock', amount: 20 },
  { category: 'restaurant_closed', amount: 20 },
  { category: 'restaurant_delay', amount: 15 },
  { category: 'restaurant_accepted_by_mistake', amount: 15 },
  { category: 'rider_waiting', amount: 15 },
  { category: 'customer_wrong_location', amount: 20 },
  { category: 'customer_changed_location', amount: 20 },
  { category: 'customer_not_available', amount: 20 },
  { category: 'order_damaged', amount: 25 },
  { category: 'order_leaked', amount: 25 },
  { category: 'order_missing', amount: 25 },
  { category: 'payment_issue', amount: 20 },
  { category: 'refund_issue', amount: 20 },
  { category: 'delivery_failed', amount: 20 },
  { category: 'rider_issue', amount: 20 },
  { category: 'restaurant_issue', amount: 20 },
  { category: 'customer_issue', amount: 20 },
  { category: 'other', amount: 15 },
];

async function ensurePayoutRules() {
  try {
    const count = await SupportPayoutRule.countDocuments();
    if (count === 0) {
      await SupportPayoutRule.insertMany(DEFAULT_PAYOUT_RULES);
      console.log('✅ Default Support Payout Rules seeded');
    }
  } catch (err) {
    console.error('Error seeding payout rules:', err);
  }
}
ensurePayoutRules();

function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// 1. DASHBOARD STATS
const getDashboardStats = async (req, res) => {
  try {
    const agentId = req.query.agentId || req.user?._id || req.user?.id;
    const today = getStartOfToday();

    // 1. Support Cases Stats
    const allCases = await SupportCase.find({}).sort({ openedAt: -1 }).lean();
    const openStatuses = ['OPEN', 'IN_PROGRESS', 'WAITING', 'new', 'assigned', 'in_progress', 'waiting', 'escalated'];

    const openCases = allCases.filter((c) => openStatuses.includes(c.status));
    const newRequests = openCases.filter((c) => c.status === 'new' || c.status === 'OPEN').length;
    const myActive = agentId ? openCases.filter((c) => String(c.assignedAgentId) === String(agentId)).length : 0;
    const pendingUnassigned = openCases.filter((c) => !c.assignedAgentId).length;
    const urgent = openCases.filter(
      (c) => String(c.priority).toLowerCase() === 'urgent' || String(c.priority).toLowerCase() === 'critical'
    ).length;
    const inProgress = openCases.filter((c) => c.status === 'in_progress' || c.status === 'IN_PROGRESS').length;
    const waiting = openCases.filter((c) => c.status === 'waiting' || c.status === 'WAITING').length;

    const resolvedToday = allCases.filter((c) => c.resolvedAt && new Date(c.resolvedAt) >= today).length;
    const cancelledToday = allCases.filter(
      (c) => (c.status === 'cancelled' || c.status === 'CLOSED') && new Date(c.updatedAt) >= today
    ).length;

    // Breakdown by Requester Role
    const customerRequests = openCases.filter((c) => c.requesterRole === 'customer').length;
    const riderRequests = openCases.filter((c) => c.requesterRole === 'rider').length;
    const supplierRequests = openCases.filter(
      (c) => c.requesterRole === 'restaurant' || c.requesterRole === 'supplier'
    ).length;

    // 2. Real Live Orders from Booking Collection
    const activeOrderStatuses = [
      'ORDER_PLACED',
      'BOOKING_REQUESTED',
      'PENDING_RESTAURANT',
      'RESTAURANT_ACCEPTED',
      'PROVIDER_ASSIGNED',
      'ACCEPTED',
      'PROVIDER_ACCEPTED',
      'PREPARING',
      'SEARCHING_FOR_RIDER',
      'RIDER_ASSIGNED',
      'FOOD_READY',
      'READY_FOR_PICKUP',
      'READY',
      'OUT_FOR_DELIVERY',
      'PROVIDER_ON_THE_WAY',
      'PROVIDER_ARRIVED',
      'REACHED_CUSTOMER',
      'ARRIVED_AT_DROP',
      'STARTED',
      'SERVICE_STARTED',
      'SERVICE_IN_PROGRESS',
    ];

    const liveBookings = await Booking.find({
      status: { $in: activeOrderStatuses },
    }).lean();
    const totalLiveOrders = liveBookings.length;

    // Cancellation Requests
    const pendingCancellations = await Booking.countDocuments({
      $or: [{ 'cancellationRequest.isPending': true }, { status: 'CANCELLATION_PENDING' }],
    });

    // Refund Requests
    const refundRequestsCount = await SupportCase.countDocuments({
      status: { $in: openStatuses },
      $or: [
        { category: { $regex: 'refund', $options: 'i' } },
        { issueTitle: { $regex: 'refund', $options: 'i' } },
        { description: { $regex: 'refund', $options: 'i' } },
      ],
    });

    // 3. Real Online Riders from User Collection
    const onlineDrivers = await User.find({
      role: { $in: ['driver', 'rider'] },
      $or: [{ isOnline: true }, { online: true }],
    }).lean();
    const totalOnlineRiders = onlineDrivers.length;

    // 4. Pending Support Withdrawals
    const pendingWithdrawalsCount = await SupportWithdrawal.countDocuments({ status: 'pending' });

    // 5. Zone-wise counts (from actual configured Zones)
    let zones = await Zone.find({ isActive: true }).lean();
    if (!zones || zones.length === 0) {
      await Zone.seedDefaultZones();
      zones = await Zone.find({ isActive: true }).lean();
    }

    const zoneWiseStats = zones.map((z) => {
      const zOrders = liveBookings.filter(
        (b) => b.zoneId === z.zoneId || b.zoneName === z.zoneName
      ).length;
      const zRiders = onlineDrivers.filter(
        (r) => r.zoneId === z.zoneId || r.selectedZone === z.zoneName || r.zone === z.zoneName
      ).length;
      return {
        zoneId: z.zoneId,
        zoneName: z.zoneName,
        cityName: z.cityName || 'Bhopal',
        liveOrders: zOrders,
        onlineRiders: zRiders,
      };
    });

    // 6. City Summary
    const citySummary = {
      Bhopal: {
        totalZones: zones.length,
        liveOrders: totalLiveOrders,
        onlineRiders: totalOnlineRiders,
        activeCases: openCases.length,
      },
    };

    return res.status(200).json({
      success: true,
      stats: {
        totalLiveOrders,
        totalOnlineRiders,
        activeOrders: totalLiveOrders,
        pendingSupportRequests: openCases.length,
        cancellationRequests: pendingCancellations,
        refundRequests: refundRequestsCount,
        withdrawalRequests: pendingWithdrawalsCount,
        newRequests,
        myActive,
        pendingUnassigned,
        urgent,
        inProgress,
        waiting,
        resolvedToday,
        cancelledToday,
        customerRequests,
        riderRequests,
        supplierRequests,
        totalOpen: openCases.length,
        totalCases: allCases.length,
        zoneWiseStats,
        citySummary,
      },
    });
  } catch (error) {
    console.error('Error in getDashboardStats:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 2. QUEUE CASES & FILTERING
const getQueueCases = async (req, res) => {
  try {
    const {
      tab = 'all', // 'all', 'customer', 'rider', 'supplier', 'restaurant', 'my_active', 'unassigned', 'resolved', 'closed'
      role, // explicit role filter: 'customer', 'rider', 'supplier', 'restaurant'
      status, // 'OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'
      priority,
      search,
      agentId,
    } = req.query;

    const query = {};

    // Role filtering (Tabs: CUSTOMER REQUESTS, RIDER REQUESTS, SUPPLIER REQUESTS)
    const targetRole = role || (['customer', 'rider', 'supplier', 'restaurant'].includes(tab) ? tab : null);
    if (targetRole) {
      if (targetRole === 'supplier' || targetRole === 'restaurant') {
        query.requesterRole = { $in: ['restaurant', 'supplier'] };
      } else {
        query.requesterRole = targetRole;
      }
    }

    if (status) {
      if (status === 'OPEN') {
        query.status = { $in: ['OPEN', 'new', 'assigned'] };
      } else if (status === 'IN_PROGRESS') {
        query.status = { $in: ['IN_PROGRESS', 'in_progress'] };
      } else if (status === 'WAITING') {
        query.status = { $in: ['WAITING', 'waiting', 'waiting_for_user'] };
      } else if (status === 'RESOLVED') {
        query.status = { $in: ['RESOLVED', 'resolved'] };
      } else if (status === 'CLOSED') {
        query.status = { $in: ['CLOSED', 'closed', 'cancelled'] };
      } else {
        query.status = status;
      }
    } else if (tab === 'resolved') {
      query.status = { $in: ['RESOLVED', 'resolved'] };
    } else if (tab === 'closed') {
      query.status = { $in: ['CLOSED', 'closed', 'cancelled'] };
    } else if (tab === 'my_active' && agentId) {
      query.assignedAgentId = String(agentId);
      query.status = { $in: ['OPEN', 'IN_PROGRESS', 'WAITING', 'new', 'assigned', 'in_progress', 'waiting'] };
    } else if (tab === 'unassigned') {
      query.assignedAgentId = null;
      query.status = { $in: ['OPEN', 'IN_PROGRESS', 'WAITING', 'new', 'assigned', 'in_progress', 'waiting'] };
    }

    if (priority) {
      query.priority = new RegExp(`^${priority}$`, 'i');
    }

    if (search && search.trim()) {
      const s = search.trim();
      query.$or = [
        { ticketId: new RegExp(s, 'i') },
        { caseNumber: new RegExp(s, 'i') },
        { orderRef: new RegExp(s, 'i') },
        { bookingId: new RegExp(s, 'i') },
        { requesterName: new RegExp(s, 'i') },
        { requesterPhone: new RegExp(s, 'i') },
        { restaurantName: new RegExp(s, 'i') },
        { customerName: new RegExp(s, 'i') },
        { riderName: new RegExp(s, 'i') },
        { issueTitle: new RegExp(s, 'i') },
        { summary: new RegExp(s, 'i') },
      ];
    }

    const cases = await SupportCase.find(query).sort({ openedAt: -1 }).lean();

    // Summary counts by role
    const allActive = await SupportCase.find({
      status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING', 'new', 'assigned', 'in_progress', 'waiting'] },
    }).lean();

    const counts = {
      customer: allActive.filter(c => c.requesterRole === 'customer').length,
      rider: allActive.filter(c => c.requesterRole === 'rider').length,
      supplier: allActive.filter(c => c.requesterRole === 'restaurant' || c.requesterRole === 'supplier').length,
      all: allActive.length,
    };

    return res.status(200).json({
      success: true,
      count: cases.length,
      counts,
      cases,
      tickets: cases,
    });
  } catch (error) {
    console.error('Error in getQueueCases:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 3. GET SINGLE CASE / TICKET BY ID (Populated with real MongoDB Booking context)
const getCaseById = async (req, res) => {
  try {
    const { caseId } = req.params;
    if (!caseId) return res.status(400).json({ success: false, message: 'Case ID required' });

    let ticket = await SupportCase.findOne({
      $or: [
        { ticketId: caseId },
        { caseNumber: caseId },
        ...(mongoose.Types.ObjectId.isValid(caseId) ? [{ _id: caseId }] : []),
      ],
    }).lean();

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Support ticket not found' });
    }

    // Lookup Live Booking Details
    let liveOrder = null;
    const bId = ticket.bookingId || ticket.orderRef;
    if (bId) {
      liveOrder = await Booking.findOne({
        $or: [
          { bookingId: bId },
          { rideId: bId },
          ...(mongoose.Types.ObjectId.isValid(bId) ? [{ _id: bId }] : []),
        ],
      }).lean();
    }

    return res.status(200).json({
      success: true,
      case: ticket,
      ticket,
      liveOrder,
    });
  } catch (error) {
    console.error('Error in getCaseById:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 4. CREATE SUPPORT REQUEST / TICKET (With Duplicate Protection & Auto Context Enrichment)
const createSupportRequest = async (req, res) => {
  try {
    const {
      orderId,
      orderRef,
      bookingId,
      requesterRole,
      userRole,
      requesterId,
      requesterRef,
      userId,
      requesterName,
      userName,
      requesterPhone,
      userPhone,
      requesterPhoto,
      issueCategory = 'General Support',
      issueTitle,
      category = 'other',
      description = '',
      remarks = '',
      priority = 'normal',
      gpsLat,
      gpsLng,
      orderStatus,
      attachments = [],
    } = req.body;

    const bRef = bookingId || orderId || orderRef || '';
    const rRole = (requesterRole || userRole || 'rider').toLowerCase();
    const rId = requesterId || requesterRef || userId || req.user?._id || req.user?.id || 'anonymous_user';
    const rName = requesterName || userName || (rRole === 'rider' ? 'Delivery Partner' : 'User');
    const rPhone = requesterPhone || userPhone || '';
    const desc = description || remarks || issueTitle || issueCategory || 'Support Request';

    // Duplicate submission protection (prevent double-taps within 15 seconds)
    const recentDuplicate = await SupportCase.findOne({
      requesterId: String(rId),
      orderRef: bRef,
      issueTitle: issueTitle || issueCategory,
      createdAt: { $gte: new Date(Date.now() - 15000) },
    }).lean();

    if (recentDuplicate) {
      console.log(`⚠️ [DUPLICATE TICKET BLOCKED] Existing Ticket: ${recentDuplicate.ticketId}`);
      return res.status(200).json({
        success: true,
        message: 'Support ticket already submitted.',
        ticketId: recentDuplicate.ticketId,
        case: recentDuplicate,
        ticket: recentDuplicate,
      });
    }

    // Fetch Live Order Context from MongoDB to enrich ticket
    let liveOrder = null;
    if (bRef) {
      liveOrder = await Booking.findOne({
        $or: [
          { bookingId: bRef },
          { rideId: bRef },
          ...(mongoose.Types.ObjectId.isValid(bRef) ? [{ _id: bRef }] : []),
        ],
      }).lean();
    }

    // Resolve party contacts authoritatively without dummy fallbacks
    let resolvedCustomerName = (rRole === 'customer') ? (requesterName || 'Customer') : null;
    let resolvedCustomerPhone = (rRole === 'customer') ? (requesterPhone || '') : null;
    let resolvedCustomerId = (rRole === 'customer') ? rId : null;

    let resolvedRestoName = (rRole === 'restaurant' || rRole === 'supplier' || rRole === 'store') ? (requesterName || 'Store Partner') : null;
    let resolvedRestoPhone = (rRole === 'restaurant' || rRole === 'supplier' || rRole === 'store') ? (requesterPhone || '') : null;
    let resolvedRestoId = (rRole === 'restaurant' || rRole === 'supplier' || rRole === 'store') ? rId : null;

    let resolvedRiderName = (rRole === 'rider') ? (requesterName || 'Delivery Partner') : null;
    let resolvedRiderPhone = (rRole === 'rider') ? (requesterPhone || '') : null;
    let resolvedRiderId = (rRole === 'rider') ? rId : null;

    let resolvedStoreCategory = 'Food';
    let resolvedDeliveryAddress = '';
    let resolvedStoreAddress = '';
    let resolvedOrderAmount = 0;
    let resolvedLiveStatus = orderStatus || 'PENDING';

    if (liveOrder) {
      if (liveOrder.customerName || liveOrder.customerId) {
        resolvedCustomerName = liveOrder.customerName || resolvedCustomerName;
        resolvedCustomerPhone = liveOrder.customerPhone || resolvedCustomerPhone;
        resolvedCustomerId = liveOrder.customerId || resolvedCustomerId;
      }

      if (liveOrder.restaurantName || liveOrder.restaurantId) {
        resolvedRestoName = liveOrder.restaurantName || liveOrder.name || resolvedRestoName;
        resolvedRestoPhone = liveOrder.restaurantPhone || liveOrder.providerPhone || liveOrder.phone || resolvedRestoPhone;
        resolvedRestoId = liveOrder.restaurantId || liveOrder.providerId || liveOrder.partnerId || resolvedRestoId;
      }

      if (liveOrder.riderName || liveOrder.riderId || liveOrder.acceptedBy?.riderId) {
        resolvedRiderName = liveOrder.riderName || liveOrder.acceptedBy?.riderName || resolvedRiderName;
        resolvedRiderPhone = liveOrder.riderPhone || liveOrder.acceptedBy?.riderPhone || resolvedRiderPhone;
        resolvedRiderId = liveOrder.riderId || liveOrder.acceptedBy?.riderId || resolvedRiderId;
      }

      resolvedStoreCategory = liveOrder.storeCategory || liveOrder.categoryName || liveOrder.businessCategoryName || resolvedStoreCategory;
      resolvedDeliveryAddress = liveOrder.destinationAddress || liveOrder.serviceAddress || '';
      resolvedStoreAddress = liveOrder.pickupAddress || liveOrder.restaurantAddress || '';
      resolvedOrderAmount = Number(liveOrder.price || liveOrder.totalAmount || 0);
      resolvedLiveStatus = liveOrder.status || resolvedLiveStatus;
    }

    // Direct User collection lookup for exact real name
    try {
      let dbUser = null;
      if (mongoose.Types.ObjectId.isValid(rId)) {
        dbUser = await User.findById(rId).lean();
      }
      if (!dbUser && (rPhone || requesterPhone)) {
        const ph = rPhone || requesterPhone;
        dbUser = await User.findOne({ $or: [{ phone: ph }, { phoneNumber: ph }] }).lean();
      }

      if (dbUser) {
        if (rRole === 'rider' || dbUser.role === 'driver' || dbUser.role === 'rider') {
          resolvedRiderName = dbUser.name || dbUser.username || dbUser.fullName || resolvedRiderName;
          resolvedRiderPhone = dbUser.phoneNumber || dbUser.phone || resolvedRiderPhone;
        } else if (rRole === 'restaurant' || rRole === 'supplier' || dbUser.role === 'restaurant' || dbUser.role === 'store') {
          resolvedRestoName = dbUser.restaurantName || dbUser.storeName || dbUser.name || resolvedRestoName;
          resolvedRestoPhone = dbUser.phoneNumber || dbUser.phone || resolvedRestoPhone;
        } else {
          resolvedCustomerName = dbUser.name || dbUser.username || dbUser.fullName || resolvedCustomerName;
          resolvedCustomerPhone = dbUser.phoneNumber || dbUser.phone || resolvedCustomerPhone;
        }
      }
    } catch (uErr) {
      console.warn('[USER RESOLVE NOTICE]:', uErr.message);
    }

    // Authoritative requester identification
    const finalRequesterName = (rRole === 'rider')
      ? (resolvedRiderName || requesterName || 'Delivery Partner')
      : (rRole === 'restaurant' || rRole === 'supplier' || rRole === 'store')
        ? (resolvedRestoName || requesterName || 'Store Partner')
        : (resolvedCustomerName || requesterName || 'Customer');

    const finalRequesterPhone = (rRole === 'rider')
      ? (resolvedRiderPhone || requesterPhone || '')
      : (rRole === 'restaurant' || rRole === 'supplier' || rRole === 'store')
        ? (resolvedRestoPhone || requesterPhone || '')
        : (resolvedCustomerPhone || requesterPhone || '');

    // Generate clean Ticket ID
    const ticketId = 'TKT-' + Math.floor(100000 + Math.random() * 900000);

    const initialActivity = {
      type: 'request',
      body: `Support ticket created: ${issueTitle || issueCategory}. ${desc}`,
      targetRole: rRole,
      agentName: finalRequesterName,
      metadata: { orderId: bRef, reason: issueTitle || issueCategory },
    };

    const initialMessage = {
      messageId: 'msg_' + Date.now() + '_init',
      senderId: String(rId),
      senderRole: rRole,
      senderName: finalRequesterName,
      text: desc,
      createdAt: new Date(),
    };

    const newTicket = await SupportCase.create({
      ticketId,
      caseNumber: ticketId,
      orderRef: bRef,
      bookingId: bRef,
      category: category || 'other',
      issueCategory: issueCategory || 'General Support',
      issueTitle: issueTitle || issueCategory || 'Support Request',
      description: desc,
      priority: (priority || 'normal').toLowerCase(),
      status: 'OPEN',
      requesterRole: rRole,
      requesterId: String(rId),
      requesterRef: String(rId),
      requesterName: finalRequesterName,
      requesterPhone: finalRequesterPhone,
      requesterPhoto: requesterPhoto || null,

      storeCategory: resolvedStoreCategory,
      categoryName: resolvedStoreCategory,
      restaurantId: resolvedRestoId,
      restaurantName: resolvedRestoName,
      restaurantPhone: resolvedRestoPhone,
      customerId: resolvedCustomerId,
      customerName: resolvedCustomerName,
      customerPhone: resolvedCustomerPhone,
      riderId: resolvedRiderId,
      riderName: resolvedRiderName,
      riderPhone: resolvedRiderPhone,

      orderStatusAtCreation: resolvedLiveStatus,
      orderAmount: resolvedOrderAmount,
      deliveryAddress: resolvedDeliveryAddress,
      storeAddress: resolvedStoreAddress,
      gpsLat: Number(gpsLat || 0) || null,
      gpsLng: Number(gpsLng || 0) || null,

      claimReward: 2,
      requestFee: 2,
      payoutAmount: 2,

      summary: `${issueTitle || issueCategory} - ${description}`,
      openedAt: new Date(),
      activities: [initialActivity],
      messages: [initialMessage],
      requests: [{
        orderRef: bRef,
        bookingId: bRef,
        category: category || 'other',
        requesterRole: rRole,
        requesterRef: String(rId),
        requesterName: finalRequesterName,
        requesterPhone: finalRequesterPhone,
        description: description || '',
        gpsLat: Number(gpsLat || 0) || null,
        gpsLng: Number(gpsLng || 0) || null,
        orderStatus: resolvedLiveStatus,
      }],
      attachments: (attachments || []).map(url => ({ kind: 'photo', url })),
    });

    console.log(`🎫 [SUPPORT TICKET CREATED]: ID=${newTicket.ticketId} Role=${newTicket.requesterRole} Order=${newTicket.orderRef}`);

    // Real-Time Socket.IO Broadcast to Admin & User Rooms
    const io = getIO(req);
    if (io) {
      // 1. Broadcast to Support Admin Dashboard
      io.to('support_admin_room').emit('new_support_ticket', newTicket);
      io.to('support_admin_room').emit('support_case_created', newTicket);
      io.to('support_admin_room').emit('support_request_created', newTicket);
      io.emit('new_support_ticket', newTicket);
      io.emit('support_ticket_created', newTicket);
      io.emit('support_case_created', newTicket);
      io.emit('support_request_created', newTicket);

      // 2. Broadcast to specific requester room
      io.to(`user_${rId}`).emit('my_ticket_created', newTicket);
      io.to(`support_user_${rId}`).emit('my_ticket_created', newTicket);

      // 3. Update active counts
      io.emit('support_stats_updated', {
        role: rRole,
        ticketId: newTicket.ticketId,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Support ticket raised successfully.',
      ticketId: newTicket.ticketId,
      caseNumber: newTicket.ticketId,
      case: newTicket,
      ticket: newTicket,
    });
  } catch (error) {
    console.error('Error in createSupportRequest:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 5. SEND REAL-TIME SUPPORT MESSAGE (Agent <-> User Chat)
const addCaseMessage = async (req, res) => {
  try {
    const { caseId } = req.params;
    const {
      text,
      body,
      senderId,
      senderRole = 'agent',
      senderName = 'Support',
      attachments = [],
      isInternal = false,
    } = req.body;

    const messageText = text || body;
    if (!messageText || !messageText.trim()) {
      return res.status(400).json({ success: false, message: 'Message text required' });
    }

    const ticket = await SupportCase.findOne({
      $or: [
        { ticketId: caseId },
        { caseNumber: caseId },
        ...(mongoose.Types.ObjectId.isValid(caseId) ? [{ _id: caseId }] : []),
      ],
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const messageObj = {
      messageId: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      senderId: String(senderId || req.user?._id || req.user?.id || 'agent_1'),
      senderRole: senderRole || (req.user?.role === 'admin' ? 'admin' : 'agent'),
      senderName: senderName || req.user?.name || req.user?.username || 'Support Team',
      text: messageText.trim(),
      attachments: attachments || [],
      isInternal: Boolean(isInternal),
      createdAt: new Date(),
      isRead: false,
    };

    ticket.messages.push(messageObj);

    // Also record in activities
    ticket.activities.push({
      type: 'message',
      body: messageText.trim(),
      isInternal: Boolean(isInternal),
      targetRole: ticket.requesterRole,
      agentId: messageObj.senderId,
      agentName: messageObj.senderName,
      metadata: { messageId: messageObj.messageId },
    });

    // Auto update firstResponseAt if first agent reply
    if (['agent', 'admin'].includes(messageObj.senderRole) && !ticket.firstResponseAt) {
      ticket.firstResponseAt = new Date();
      if (ticket.status === 'OPEN' || ticket.status === 'new') {
        ticket.status = 'IN_PROGRESS';
      }
    }

    await ticket.save();

    console.log(`💬 [SUPPORT CHAT MESSAGE]: Ticket=${ticket.ticketId} From=${messageObj.senderName} (${messageObj.senderRole})`);

    // Real-Time Socket.IO Broadcast
    const io = getIO(req);
    if (io) {
      const payload = {
        ticketId: ticket.ticketId,
        caseNumber: ticket.caseNumber,
        message: messageObj,
        ticketStatus: ticket.status,
      };

      io.to(`support_ticket_${ticket.ticketId}`).emit('support_message_received', payload);
      io.to('support_admin_room').emit('support_message_received', payload);
      io.to(`user_${ticket.requesterId}`).emit('support_message_received', payload);
      io.to(`support_user_${ticket.requesterId}`).emit('support_message_received', payload);
      io.emit('support_message_event', payload);
    }

    return res.status(200).json({
      success: true,
      message: 'Message sent successfully.',
      newMessage: messageObj,
      ticket,
    });
  } catch (error) {
    console.error('Error in addCaseMessage:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 6. UPDATE TICKET STATUS (OPEN, IN_PROGRESS, WAITING, RESOLVED, CLOSED)
const updateCaseStatus = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { status, reason, agentId, agentName } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const normStatus = status.toUpperCase();

    const ticket = await SupportCase.findOne({
      $or: [
        { ticketId: caseId },
        { caseNumber: caseId },
        ...(mongoose.Types.ObjectId.isValid(caseId) ? [{ _id: caseId }] : []),
      ],
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Support ticket not found' });
    }

    const oldStatus = ticket.status;
    ticket.status = normStatus;

    if (normStatus === 'RESOLVED' || normStatus === 'resolved') {
      ticket.resolvedAt = new Date();
      ticket.resolutionReason = reason || 'Resolved by Support Agent';
    } else if (normStatus === 'CLOSED' || normStatus === 'closed') {
      ticket.closedAt = new Date();
    }

    ticket.activities.push({
      type: 'status_change',
      body: `Status changed from ${oldStatus} to ${normStatus}. ${reason ? 'Reason: ' + reason : ''}`,
      agentId: agentId || req.user?._id || req.user?.id || null,
      agentName: agentName || req.user?.name || 'Support Agent',
      metadata: { oldStatus, newStatus: normStatus, reason },
    });

    await ticket.save();

    console.log(`🔄 [TICKET STATUS UPDATED]: Ticket=${ticket.ticketId} ${oldStatus} -> ${normStatus}`);

    // Real-Time Socket.IO Broadcast
    const io = getIO(req);
    if (io) {
      const payload = {
        ticketId: ticket.ticketId,
        caseNumber: ticket.caseNumber,
        oldStatus,
        status: normStatus,
        resolutionReason: ticket.resolutionReason,
        updatedAt: ticket.updatedAt,
      };

      io.to(`support_ticket_${ticket.ticketId}`).emit('support_ticket_status_changed', payload);
      io.to('support_admin_room').emit('support_ticket_status_changed', payload);
      io.to(`user_${ticket.requesterId}`).emit('support_ticket_status_changed', payload);
      io.to(`support_user_${ticket.requesterId}`).emit('support_ticket_status_changed', payload);
      io.emit('support_ticket_status_changed', payload);
    }

    return res.status(200).json({
      success: true,
      message: `Ticket status updated to ${normStatus}`,
      ticket,
    });
  } catch (error) {
    console.error('Error in updateCaseStatus:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 7. 0-PENALTY RIDER ORDER TRANSFER (Executed after Store Delay Countdown Timer)
const transferRiderOrder = async (req, res) => {
  try {
    const {
      bookingId,
      orderId,
      riderId,
      riderName,
      reason = 'Restaurant preparation delay - 0 penalty transfer',
    } = req.body;

    const bId = bookingId || orderId;
    if (!bId) {
      return res.status(400).json({ success: false, message: 'Booking / Order ID required' });
    }

    const booking = await Booking.findOne({
      $or: [
        { bookingId: bId },
        { rideId: bId },
        ...(mongoose.Types.ObjectId.isValid(bId) ? [{ _id: bId }] : []),
      ],
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Active booking not found' });
    }

    const currentRiderId = riderId || booking.riderId || booking.acceptedBy?.riderId;
    const currentRiderName = riderName || booking.riderName || booking.acceptedBy?.riderName || 'Rider';

    console.log(`🔄 [0-PENALTY ORDER TRANSFER INITIATED]: Booking=${bId}, Released Rider=${currentRiderName} (${currentRiderId})`);

    // Safety checks: do not transfer if order was already picked up or delivered
    const st = (booking.status || '').toUpperCase();
    const rSt = (booking.riderStatus || '').toUpperCase();
    if (['FOOD_PICKED_UP', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'].includes(st) ||
        ['FOOD_PICKED_UP', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(rSt)) {
      return res.status(400).json({
        success: false,
        message: 'Order has already been picked up and cannot be transferred.',
      });
    }

    // 1. Add current rider to rejectedRiders array so same order won't loop back to them immediately
    const rejectedList = Array.isArray(booking.rejectedRiders) ? [...booking.rejectedRiders] : [];
    if (currentRiderId && !rejectedList.includes(String(currentRiderId))) {
      rejectedList.push(String(currentRiderId));
    }

    // 2. Release current rider and reset delivery status to SEARCHING_FOR_RIDER
    booking.rejectedRiders = rejectedList;
    booking.riderId = null;
    booking.riderName = null;
    booking.riderPhone = null;
    booking.riderStatus = 'NONE';
    booking.deliveryStatus = 'SEARCHING_FOR_RIDER';
    booking.pendingRiderId = null;
    booking.acceptedBy = null;

    await booking.save();

    // 3. Create or update Support Case record for transfer audit
    try {
      await SupportCase.create({
        orderRef: booking.bookingId || bId,
        bookingId: booking.bookingId || bId,
        category: 'restaurant_delay',
        issueCategory: 'Restaurant Delay Transfer',
        issueTitle: 'Order Transferred (0 Penalty)',
        description: `Order transferred due to store delay. Original rider: ${currentRiderName}. Penalty: ₹0.`,
        priority: 'high',
        status: 'RESOLVED',
        requesterRole: 'rider',
        requesterId: String(currentRiderId || ''),
        requesterName: currentRiderName,
        restaurantName: booking.restaurantName || 'Partner Store',
        customerName: booking.customerName || 'Customer',
        summary: `0-Penalty Order Transfer for Booking #${(booking.bookingId || bId).slice(-6)}`,
        transferDetails: {
          isTransferred: true,
          originalRiderId: String(currentRiderId || ''),
          originalRiderName: currentRiderName,
          transferredAt: new Date(),
          reason,
          penaltyAmount: 0,
        },
      });
    } catch (tErr) {
      console.warn('[TRANSFER AUDIT LOG NOTICE]', tErr.message);
    }

    // 4. Real-Time Socket.IO Broadcast
    const io = getIO(req);
    if (io) {
      // Notify original rider that they are cleanly released with 0 penalty
      if (currentRiderId) {
        io.to(`user_${currentRiderId}`).emit('rider_released', {
          bookingId: booking.bookingId || bId,
          message: 'Order transferred successfully with 0 penalty. You are now free for new orders.',
          penalty: 0,
        });
        io.to(`provider_${currentRiderId}`).emit('rider_released', {
          bookingId: booking.bookingId || bId,
          message: 'Order transferred successfully with 0 penalty.',
          penalty: 0,
        });
      }

      // Notify Restaurant & Customer
      const bookingRoom = `booking_${booking.bookingId || bId}`;
      io.to(bookingRoom).emit('order_status_updated', {
        bookingId: booking.bookingId || bId,
        status: booking.status,
        deliveryStatus: 'SEARCHING_FOR_RIDER',
        message: 'Looking for a nearby delivery partner...',
      });

      // Broadcast new delivery request to online eligible riders
      io.emit('new_delivery_request', {
        bookingId: booking.bookingId || bId,
        rideId: booking.bookingId || bId,
        booking: booking.toObject(),
        restaurantName: booking.restaurantName,
        pickupAddress: booking.pickupAddress,
        destinationAddress: booking.destinationAddress,
        deliveryFee: booking.deliveryFee || 25,
        price: booking.price,
        categoryName: booking.categoryName || 'Delivery',
        serviceName: booking.categoryName || 'Delivery',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Order transferred successfully with 0 penalty.',
      bookingId: booking.bookingId || bId,
      penalty: 0,
    });
  } catch (error) {
    console.error('Error in transferRiderOrder:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 8. GET PREVIOUS ORDERS FOR RIDER / CUSTOMER / SUPPLIER (100% Real Database Orders)
const getPreviousOrders = async (req, res) => {
  try {
    const { userId, role = 'rider', limit = 30 } = req.query;
    const uId = userId || req.user?._id || req.user?.id;

    if (!uId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const query = {};
    const r = role.toLowerCase();

    if (r === 'rider') {
      query.$or = [
        { riderId: String(uId) },
        { providerId: String(uId) },
        { 'acceptedBy.riderId': String(uId) },
      ];
    } else if (r === 'restaurant' || r === 'supplier') {
      query.$or = [
        { restaurantId: String(uId) },
        { providerId: String(uId) },
        { partnerId: String(uId) },
      ];
    } else {
      query.customerId = String(uId);
    }

    const orders = await Booking.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .lean();

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error('Error in getPreviousOrders:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 9. GET USER'S ACTIVE & PAST TICKETS
const getUserTickets = async (req, res) => {
  try {
    const { userId } = req.params;
    const uId = userId || req.query.userId || req.user?._id || req.user?.id;

    if (!uId) {
      return res.status(400).json({ success: false, message: 'User ID required' });
    }

    const tickets = await SupportCase.find({
      $or: [
        { requesterId: String(uId) },
        { requesterRef: String(uId) },
        { customerId: String(uId) },
        { riderId: String(uId) },
        { restaurantId: String(uId) },
      ],
    }).sort({ openedAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      count: tickets.length,
      tickets,
    });
  } catch (error) {
    console.error('Error in getUserTickets:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 10. ASSIGN CASE TO AGENT
// 10. ASSIGN CASE TO AGENT (Atomic Assignment with Double-Claim Protection)
const assignCase = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { agentId, agentName, agentCode } = req.body;

    const resolvedAgentId = String(agentId || req.user?._id || req.user?.id || 'agent_1');
    const resolvedAgentName = agentName || req.user?.name || req.user?.username || 'Support Agent';
    const resolvedAgentCode = agentCode || req.user?.agentCode || '';

    // Atomic findOneAndUpdate: only assign if unassigned or already assigned to this exact agent
    const updatedTicket = await SupportCase.findOneAndUpdate(
      {
        $or: [
          { ticketId: caseId },
          { caseNumber: caseId },
          ...(mongoose.Types.ObjectId.isValid(caseId) ? [{ _id: caseId }] : []),
        ],
        $or: [
          { assignedAgentId: null },
          { assignedAgentId: '' },
          { assignedAgentId: { $exists: false } },
          { assignedAgentId: resolvedAgentId },
        ],
      },
      {
        $set: {
          assignedAgentId: resolvedAgentId,
          assignedAgentName: resolvedAgentName,
          assignedAgentCode: resolvedAgentCode,
          assignedAt: new Date(),
          status: 'IN_PROGRESS',
        },
        $push: {
          activities: {
            type: 'assignment',
            body: `Ticket assigned to agent ${resolvedAgentName}`,
            agentId: resolvedAgentId,
            agentName: resolvedAgentName,
            agentCode: resolvedAgentCode,
            createdAt: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!updatedTicket) {
      // Check if ticket exists but is already claimed by another agent
      const existing = await SupportCase.findOne({
        $or: [
          { ticketId: caseId },
          { caseNumber: caseId },
          ...(mongoose.Types.ObjectId.isValid(caseId) ? [{ _id: caseId }] : []),
        ],
      }).lean();

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Support ticket not found' });
      }

      console.log(`⚠️ [DOUBLE CLAIM CONFLICT]: Ticket=${existing.ticketId} already assigned to ${existing.assignedAgentName} (${existing.assignedAgentId})`);
      return res.status(409).json({
        success: false,
        message: `Ticket is already assigned to ${existing.assignedAgentName || 'another agent'}.`,
        ticket: existing,
        case: existing,
      });
    }

    console.log(`👤 [TICKET ATOMICALLY ASSIGNED]: Ticket=${updatedTicket.ticketId} Agent=${updatedTicket.assignedAgentName} (${resolvedAgentId})`);

    // Credit ₹2 Claim Reward to Support Admin Wallet
    try {
      const rewardAmount = updatedTicket.claimReward || 2;
      let wallet = await SupportWallet.findOne({ agentId: resolvedAgentId });
      if (!wallet) {
        wallet = new SupportWallet({
          agentId: resolvedAgentId,
          agentName: resolvedAgentName,
          balance: 0,
          totalEarned: 0,
          totalWithdrawn: 0,
        });
      }
      wallet.balance = (wallet.balance || 0) + rewardAmount;
      wallet.totalEarned = (wallet.totalEarned || 0) + rewardAmount;
      wallet.transactions.push({
        type: 'credit',
        amount: rewardAmount,
        balanceAfter: wallet.balance,
        description: `Support Request Reward for Ticket #${updatedTicket.ticketId}`,
        status: 'completed',
        referenceId: updatedTicket.ticketId,
        createdAt: new Date(),
      });
      await wallet.save();
      console.log(`💰 [WALLET CREDITED]: ₹${rewardAmount} credited to Agent ${resolvedAgentName} (${resolvedAgentId}) for Ticket ${updatedTicket.ticketId}. New Balance: ₹${wallet.balance}`);

      const ioInst = getIO(req);
      if (ioInst) {
        ioInst.to('support_admin_room').emit('support_wallet_updated', wallet);
        ioInst.emit('support_wallet_updated', wallet);
      }
    } catch (wErr) {
      console.warn('[WALLET CREDIT NOTICE]:', wErr.message);
    }

    // Broadcast Real-Time Socket Events to all rooms (Admin, Ticket Room, Requester, Rider, Customer, Store)
    const io = getIO(req);
    if (io) {
      const payload = {
        ticketId: updatedTicket.ticketId,
        caseNumber: updatedTicket.caseNumber,
        assignedAgentId: resolvedAgentId,
        assignedAgentName: updatedTicket.assignedAgentName,
        assignedAgentCode: updatedTicket.assignedAgentCode,
        assignedAt: updatedTicket.assignedAt,
        status: updatedTicket.status,
        ticket: updatedTicket,
        case: updatedTicket,
      };

      const eventNames = [
        'support_ticket_assigned',
        'support_case_assigned',
        'case_assigned',
        'ticket_assigned',
        'support_call_connected',
        'support_request_accepted',
        'support_ticket_status_changed',
      ];

      const rooms = [
        'support_admin_room',
        `support_ticket_${updatedTicket.ticketId}`,
        `user_${updatedTicket.requesterId}`,
        `support_user_${updatedTicket.requesterId}`,
      ];

      if (updatedTicket.riderId) {
        rooms.push(`user_${updatedTicket.riderId}`);
        rooms.push(`provider_${updatedTicket.riderId}`);
        rooms.push(`rider_${updatedTicket.riderId}`);
      }
      if (updatedTicket.customerId) {
        rooms.push(`user_${updatedTicket.customerId}`);
        rooms.push(`customer_${updatedTicket.customerId}`);
      }
      if (updatedTicket.restaurantId) {
        rooms.push(`user_${updatedTicket.restaurantId}`);
        rooms.push(`restaurant_${updatedTicket.restaurantId}`);
        rooms.push(`store_${updatedTicket.restaurantId}`);
        rooms.push(`supplier_${updatedTicket.restaurantId}`);
        rooms.push(`provider_${updatedTicket.restaurantId}`);
      }

      // Emit to all targeted rooms
      rooms.forEach((room) => {
        eventNames.forEach((ev) => {
          io.to(room).emit(ev, payload);
        });
      });

      // Global broadcasts for full real-time guarantee
      eventNames.forEach((ev) => {
        io.emit(ev, payload);
      });
    }

    return res.status(200).json({ success: true, ticket: updatedTicket, case: updatedTicket });
  } catch (error) {
    console.error('Error in assignCase:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 11. RESOLVE CASE WITH PAYOUT
const resolveCase = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { reason, payoutAmount = 0 } = req.body;

    const ticket = await SupportCase.findOne({
      $or: [
        { ticketId: caseId },
        { caseNumber: caseId },
        ...(mongoose.Types.ObjectId.isValid(caseId) ? [{ _id: caseId }] : []),
      ],
    });

    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

    ticket.status = 'RESOLVED';
    ticket.resolvedAt = new Date();
    ticket.resolutionReason = reason || 'Issue resolved successfully.';
    ticket.payoutAmount = Number(payoutAmount) || 0;

    await ticket.save();

    const io = getIO(req);
    if (io) {
      io.to(`support_ticket_${ticket.ticketId}`).emit('support_ticket_status_changed', {
        ticketId: ticket.ticketId,
        status: 'RESOLVED',
        reason: ticket.resolutionReason,
      });
      io.to('support_admin_room').emit('support_ticket_status_changed', {
        ticketId: ticket.ticketId,
        status: 'RESOLVED',
      });
    }

    return res.status(200).json({ success: true, ticket });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 12. EXECUTE MONEY ACTION
const executeMoneyAction = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { actionType, amount, targetUserId, note } = req.body;

    if (!amount || Number(amount) <= 0 || !targetUserId) {
      return res.status(400).json({ success: false, message: 'Amount and targetUserId required' });
    }

    const numAmount = Number(amount);
    const user = await User.findById(targetUserId);
    if (!user) return res.status(404).json({ success: false, message: 'Target user not found' });

    if (actionType === 'refund' || actionType === 'payout' || actionType === 'credit') {
      user.walletBalance = (user.walletBalance || 0) + numAmount;
      await user.save();
    }

    return res.status(200).json({
      success: true,
      message: `Money action (${actionType}) of ₹${numAmount} executed successfully.`,
      newBalance: user.walletBalance,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 13. AGENT OPERATIONS
const getAgents = async (req, res) => {
  try {
    const agents = await User.find({ role: { $in: ['admin', 'agent', 'support'] } }).select('name username email phoneNumber supportStatus isOnline').lean();
    return res.status(200).json({ success: true, agents });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

const updateAgentStatus = async (req, res) => {
  try {
    const { agentId, isOnline } = req.body;
    if (agentId) {
      await User.findByIdAndUpdate(agentId, { isOnline: Boolean(isOnline) });
    }
    return res.status(200).json({ success: true, isOnline: Boolean(isOnline) });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

const agentLogin = async (req, res) => {
  try {
    const { email, password, phone } = req.body;
    const user = await User.findOne({
      $or: [
        { email: email ? email.toLowerCase().trim() : null },
        { phoneNumber: phone },
        { username: email },
      ].filter(Boolean),
    });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    return res.status(200).json({
      success: true,
      agent: {
        id: user._id,
        name: user.name || user.username,
        email: user.email,
        phone: user.phoneNumber,
        role: user.role,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

function formatBookingWithTimeline(b) {
  const placedAt = b.placedAt || b.createdAt;
  const acceptedAt = b.restaurantAcceptedAt || b.acceptedAt;
  const riderAssignedAt = b.riderAssignedAt;
  const riderReachedRestoAt = b.riderReachedRestoAt || b.riderReachedAt;
  const orderReadyAt = b.orderReadyAt || b.foodReadyAt;
  const riderPickedUpAt = b.riderPickedUpAt;
  const riderStartedDeliveryAt = b.riderStartedDeliveryAt || b.startedAt;
  const riderReachedCustomerAt = b.riderReachedCustomerAt;
  const deliveredAt = b.deliveredAt || b.completedAt;

  const steps = [
    { title: 'Order Placed', timestamp: placedAt, durationSec: null },
    {
      title: 'Restaurant Accepted',
      timestamp: acceptedAt,
      durationSec: acceptedAt && placedAt ? Math.round((new Date(acceptedAt) - new Date(placedAt)) / 1000) : null,
    },
    {
      title: 'Rider Assigned',
      timestamp: riderAssignedAt,
      durationSec: riderAssignedAt && acceptedAt ? Math.round((new Date(riderAssignedAt) - new Date(acceptedAt)) / 1000) : null,
    },
    {
      title: 'Rider Reached Restaurant',
      timestamp: riderReachedRestoAt,
      durationSec: riderReachedRestoAt && riderAssignedAt ? Math.round((new Date(riderReachedRestoAt) - new Date(riderAssignedAt)) / 1000) : null,
    },
    {
      title: 'Order Ready',
      timestamp: orderReadyAt,
      durationSec: orderReadyAt && acceptedAt ? Math.round((new Date(orderReadyAt) - new Date(acceptedAt)) / 1000) : null,
    },
    {
      title: 'Rider Picked Up',
      timestamp: riderPickedUpAt,
      durationSec: riderPickedUpAt && riderReachedRestoAt ? Math.round((new Date(riderPickedUpAt) - new Date(riderReachedRestoAt)) / 1000) : null,
    },
    {
      title: 'Rider Started Delivery',
      timestamp: riderStartedDeliveryAt,
      durationSec: riderStartedDeliveryAt && riderPickedUpAt ? Math.round((new Date(riderStartedDeliveryAt) - new Date(riderPickedUpAt)) / 1000) : null,
    },
    {
      title: 'Rider Reached Customer',
      timestamp: riderReachedCustomerAt,
      durationSec: riderReachedCustomerAt && riderStartedDeliveryAt ? Math.round((new Date(riderReachedCustomerAt) - new Date(riderStartedDeliveryAt)) / 1000) : null,
    },
    {
      title: 'Order Delivered / Completed',
      timestamp: deliveredAt,
      durationSec: deliveredAt && riderStartedDeliveryAt ? Math.round((new Date(deliveredAt) - new Date(riderStartedDeliveryAt)) / 1000) : null,
    },
  ];

  let totalDurationMinutes = null;
  if (deliveredAt && placedAt) {
    totalDurationMinutes = Math.round((new Date(deliveredAt) - new Date(placedAt)) / (1000 * 60));
  } else if (placedAt && !['CANCELLED', 'COMPLETED'].includes(b.status)) {
    totalDurationMinutes = Math.round((Date.now() - new Date(placedAt)) / (1000 * 60));
  }

  return {
    ...b,
    timelineSteps: steps,
    totalDeliveryDurationMinutes: b.totalDeliveryDurationMinutes || totalDurationMinutes,
  };
}

// ORDER SEARCH WITH COMPLETE TIMELINE & TRACKING CONTEXT
const searchOrders = async (req, res) => {
  try {
    const { q, orderId, phone, riderId, restaurantName, dateFrom, dateTo, zoneId, status, limit = 50 } = req.query;
    const query = {};

    if (q && q.trim()) {
      const term = q.trim();
      const isShortCode = term.length <= 6;
      query.$or = [
        { bookingId: isShortCode ? new RegExp(term + '$', 'i') : new RegExp(term, 'i') },
        { customerPhone: new RegExp(term, 'i') },
        { customerName: new RegExp(term, 'i') },
        { providerName: new RegExp(term, 'i') },
        { riderName: new RegExp(term, 'i') },
        { restaurantName: new RegExp(term, 'i') },
        { serviceName: new RegExp(term, 'i') },
        { destinationAddress: new RegExp(term, 'i') },
        { serviceAddress: new RegExp(term, 'i') },
      ];
    }

    if (orderId && orderId.trim()) {
      const oid = orderId.trim();
      query.bookingId = oid.length <= 6 ? new RegExp(oid + '$', 'i') : new RegExp(oid, 'i');
    }
    if (phone && phone.trim()) {
      query.$or = [
        { customerPhone: new RegExp(phone.trim(), 'i') },
        { providerPhone: new RegExp(phone.trim(), 'i') },
        { riderPhone: new RegExp(phone.trim(), 'i') },
      ];
    }
    if (riderId && riderId.trim()) {
      query.$or = [{ riderId: riderId.trim() }, { providerId: riderId.trim() }];
    }
    if (restaurantName && restaurantName.trim()) {
      query.restaurantName = new RegExp(restaurantName.trim(), 'i');
    }
    if (zoneId && zoneId.trim()) {
      query.zoneId = zoneId.trim();
    }
    if (status && status.trim() && status !== 'all') {
      query.status = status.trim();
    }
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const toD = new Date(dateTo);
        toD.setHours(23, 59, 59, 999);
        query.createdAt.$lte = toD;
      }
    }

    const bookings = await Booking.find(query).sort({ createdAt: -1 }).limit(Number(limit)).lean();
    const enriched = bookings.map((b) => formatBookingWithTimeline(b));

    return res.status(200).json({
      success: true,
      count: enriched.length,
      orders: enriched,
    });
  } catch (error) {
    console.error('Error in searchOrders:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET ORDER DETAILS WITH TRACKING CONTEXT
const getOrderDetailsWithTracking = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ success: false, message: 'Order ID required' });

    let booking = await Booking.findOne({
      $or: [
        { bookingId: orderId.length <= 6 ? new RegExp(orderId + '$', 'i') : orderId },
        { rideId: orderId },
        ...(mongoose.Types.ObjectId.isValid(orderId) ? [{ _id: orderId }] : []),
      ],
    }).lean();

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Lookup single rider GPS live position
    let riderLocation = null;
    const rId = booking.riderId || booking.providerId;
    if (rId) {
      const riderUser = await User.findById(rId).lean();
      if (riderUser) {
        riderLocation = {
          riderId: riderUser._id,
          name: riderUser.name || 'Delivery Partner',
          phone: riderUser.phoneNumber || riderUser.phone || '',
          latitude:
            riderUser.locationCoords?.latitude ||
            riderUser.latitude ||
            riderUser.currentLatitude ||
            null,
          longitude:
            riderUser.locationCoords?.longitude ||
            riderUser.longitude ||
            riderUser.currentLongitude ||
            null,
          isOnline: Boolean(riderUser.isOnline || riderUser.online),
          isBusy: Boolean(riderUser.isBusy || riderUser.busy),
          lastUpdated: riderUser.updatedAt || new Date(),
        };
      }
    }

    const formatted = formatBookingWithTimeline(booking);

    return res.status(200).json({
      success: true,
      order: formatted,
      riderLocation,
    });
  } catch (error) {
    console.error('Error in getOrderDetailsWithTracking:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// LIVE ZONE MAP DATA (All active zones + single unique rider markers)
const getLiveZonesAndRiders = async (req, res) => {
  try {
    const { zoneId, riderStatus } = req.query;

    let zones = await Zone.find({ isActive: true }).lean();
    if (!zones || zones.length === 0) {
      await Zone.seedDefaultZones();
      zones = await Zone.find({ isActive: true }).lean();
    }

    if (zoneId && zoneId !== 'all') {
      zones = zones.filter((z) => z.zoneId === zoneId);
    }

    const activeOrderStatuses = [
      'ORDER_PLACED',
      'RESTAURANT_ACCEPTED',
      'PREPARING',
      'FOOD_READY',
      'RIDER_ASSIGNED',
      'RIDER_AT_RESTAURANT',
      'FOOD_PICKED_UP',
      'OUT_FOR_DELIVERY',
      'REACHED_CUSTOMER',
      'STARTED',
      'ACCEPTED',
    ];
    const liveBookings = await Booking.find({ status: { $in: activeOrderStatuses } }).lean();

    const driverQuery = {
      role: { $in: ['driver', 'rider'] },
      $or: [{ isOnline: true }, { online: true }, { isBusy: true }, { busy: true }],
    };

    if (riderStatus && riderStatus !== 'all') {
      if (riderStatus === 'online') driverQuery.isOnline = true;
      if (riderStatus === 'busy') driverQuery.isBusy = true;
    }

    const drivers = await User.find(driverQuery).lean();

    const riderMarkers = drivers
      .map((d) => {
        const lat =
          d.locationCoords?.latitude ||
          d.latitude ||
          d.currentLatitude ||
          d.lastLocation?.latitude ||
          null;
        const lon =
          d.locationCoords?.longitude ||
          d.longitude ||
          d.currentLongitude ||
          d.lastLocation?.longitude ||
          null;
        if (!lat || !lon) return null;
      const isBusy = Boolean(
        d.isBusy ||
          d.busy ||
          liveBookings.some(
            (b) => String(b.riderId) === String(d._id) || String(b.providerId) === String(d._id)
          )
      );
      return {
        riderId: d._id,
        name: d.name || d.username || 'Delivery Partner',
        phone: d.phoneNumber || d.phone || '',
        photo: d.profilePicture || d.photo || null,
        latitude: lat,
        longitude: lon,
        status: isBusy ? 'busy' : 'online',
        zoneId: d.zoneId || d.selectedZoneId || 'old_bhopal',
        zoneName: d.selectedZone || d.zone || 'Your Zone',
        lastUpdated: d.updatedAt || new Date(),
      };
    }).filter(Boolean);

    return res.status(200).json({
      success: true,
      totalZones: zones.length,
      zones,
      riderMarkers,
      liveOrdersCount: liveBookings.length,
      liveOrders: liveBookings,
    });
  } catch (error) {
    console.error('Error in getLiveZonesAndRiders:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// CANCELLATION REQUEST DECISION (ACCEPT / REJECT WITH STAGE-BASED CALCULATIONS)
const processCancellationDecision = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { action, rejectionReason, agentId, agentName } = req.body;

    if (!['ACCEPT', 'REJECT', 'accept', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: "action must be 'ACCEPT' or 'REJECT'" });
    }

    let ticket = await SupportCase.findOne({
      $or: [
        { ticketId: caseId },
        { caseNumber: caseId },
        ...(mongoose.Types.ObjectId.isValid(caseId) ? [{ _id: caseId }] : []),
      ],
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Support ticket not found' });
    }

    const bId = ticket.bookingId || ticket.orderRef;
    let booking = null;
    if (bId) {
      booking = await Booking.findOne({
        $or: [
          { bookingId: bId },
          { rideId: bId },
          ...(mongoose.Types.ObjectId.isValid(bId) ? [{ _id: bId }] : []),
        ],
      });
    }

    const isAccept = action.toUpperCase() === 'ACCEPT';
    const reviewerName = agentName || req.user?.name || 'Support Agent';
    const reviewerId = agentId || req.user?._id || req.user?.id || 'agent_system';

    if (isAccept) {
      let cancellationCharge = 0;
      let refundAmount = 0;
      let penaltyAmount = 0;
      let penaltyFault = 'NONE';

      if (booking) {
        const orderTotal = Number(booking.price) || Number(booking.subtotal) || 0;
        const stage = (booking.status || '').toUpperCase();

        if (ticket.requesterRole === 'restaurant' || ticket.requesterRole === 'supplier') {
          penaltyFault = 'RESTAURANT_FAULT';
          penaltyAmount = Math.min(100, Math.round(orderTotal * 0.2));
          cancellationCharge = 0;
          refundAmount = orderTotal;
        } else if (
          stage === 'ORDER_PLACED' ||
          stage === 'BOOKING_REQUESTED' ||
          stage === 'PENDING_RESTAURANT'
        ) {
          cancellationCharge = 0;
          refundAmount = orderTotal;
        } else if (stage === 'RESTAURANT_ACCEPTED' || stage === 'PREPARING') {
          cancellationCharge = Math.round(orderTotal * 0.4);
          refundAmount = Math.max(0, orderTotal - cancellationCharge);
        } else if (
          stage === 'FOOD_READY' ||
          stage === 'READY' ||
          stage === 'OUT_FOR_DELIVERY' ||
          stage === 'REACHED_CUSTOMER'
        ) {
          cancellationCharge = Math.round(orderTotal * 0.8);
          refundAmount = Math.max(0, orderTotal - cancellationCharge);
        } else {
          cancellationCharge = 0;
          refundAmount = orderTotal;
        }

        booking.status = 'CANCELLED';
        booking.cancelledBy = `SUPPORT_AGENT (${reviewerName})`;
        booking.cancellationReason =
          ticket.description || ticket.issueTitle || 'Cancelled by Support Agent';
        booking.cancelledAt = new Date();
        booking.cancellationCharge = cancellationCharge;
        booking.refundAmount = refundAmount;
        booking.refundStatus = refundAmount > 0 ? 'PROCESSED' : 'NONE';
        booking.restaurantPenaltyAmount = penaltyAmount;
        booking.restaurantCancellationFault = penaltyFault;
        booking.cancellationRequest = {
          ...(booking.cancellationRequest || {}),
          isPending: false,
          status: 'ACCEPTED',
          reviewedBy: reviewerName,
          reviewedAt: new Date(),
          cancellationCharge,
          expectedRefund: refundAmount,
        };
        await booking.save();
      }

      ticket.status = 'RESOLVED';
      ticket.resolvedAt = new Date();
      ticket.resolutionCategory = 'cancellation_approved';
      ticket.resolutionNotes = `Cancellation Approved by ${reviewerName}. Charge: ₹${
        booking?.cancellationCharge || 0
      }, Refund: ₹${booking?.refundAmount || 0}`;
      await ticket.save();

      await AuditLog.logAction({
        userId: reviewerId,
        userRole: 'support_admin',
        userName: reviewerName,
        action: 'CANCELLATION_APPROVED',
        category: 'cancellation',
        targetType: 'Booking',
        targetId: bId || ticket.ticketId,
        details: {
          ticketId: ticket.ticketId,
          bookingId: bId,
          charge: booking?.cancellationCharge || 0,
          refund: booking?.refundAmount || 0,
        },
        ipAddress: req.ip || '',
      });

      const io = getIO(req);
      if (io && booking) {
        io.to(`booking_${bId}`).emit('order_cancelled', {
          bookingId: bId,
          by: 'SUPPORT',
          refund: booking.refundAmount,
        });
        io.to(`user_${booking.customerId}`).emit('order_cancelled', {
          bookingId: bId,
          by: 'SUPPORT',
          refund: booking.refundAmount,
        });
        if (booking.restaurantId)
          io.to(`user_${booking.restaurantId}`).emit('order_cancelled', { bookingId: bId });
        if (booking.riderId)
          io.to(`user_${booking.riderId}`).emit('order_cancelled', { bookingId: bId });
      }

      return res.status(200).json({
        success: true,
        message: 'Cancellation Request ACCEPTED and Processed successfully.',
        booking,
        ticket,
      });
    } else {
      if (booking && booking.cancellationRequest) {
        booking.cancellationRequest.isPending = false;
        booking.cancellationRequest.status = 'REJECTED';
        booking.cancellationRequest.reviewedBy = reviewerName;
        booking.cancellationRequest.reviewedAt = new Date();
        booking.cancellationRequest.rejectionReason = rejectionReason || 'Rejected by Support Team';
        await booking.save();
      }

      ticket.status = 'IN_PROGRESS';
      ticket.resolutionNotes = `Cancellation Request REJECTED by ${reviewerName}: ${
        rejectionReason || 'Order remains active'
      }`;
      await ticket.save();

      await AuditLog.logAction({
        userId: reviewerId,
        userRole: 'support_admin',
        userName: reviewerName,
        action: 'CANCELLATION_REJECTED',
        category: 'cancellation',
        targetType: 'Booking',
        targetId: bId || ticket.ticketId,
        details: { ticketId: ticket.ticketId, bookingId: bId, rejectionReason },
        ipAddress: req.ip || '',
      });

      return res.status(200).json({
        success: true,
        message: 'Cancellation Request REJECTED. Order remains active in system.',
        booking,
        ticket,
      });
    }
  } catch (error) {
    console.error('Error in processCancellationDecision:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// SUPPORT ADMIN WALLET (Distinct from Rider Wallet)
const getSupportWallet = async (req, res) => {
  try {
    const { agentId } = req.params;
    let wallet = await SupportWallet.findOne({ agentId });
    if (!wallet) {
      const user = await User.findById(agentId).lean();
      wallet = await SupportWallet.create({
        agentId,
        agentName: user?.name || user?.username || 'Support Agent',
        agentEmail: user?.email || '',
        balance: 2500,
        totalEarned: 2500,
        totalWithdrawn: 0,
        transactions: [
          {
            type: 'credit',
            amount: 2500,
            balanceAfter: 2500,
            description: 'Support Agent Monthly Base Allocation',
            status: 'completed',
          },
        ],
      });
    }
    return res.status(200).json({ success: true, wallet });
  } catch (error) {
    console.error('Error in getSupportWallet:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// SUPPORT ADMIN UPI SUBMIT (Pending Main Admin Approval)
const submitSupportUpi = async (req, res) => {
  try {
    const { agentId, upiId, holderName } = req.body;
    if (!agentId || !upiId) {
      return res.status(400).json({ success: false, message: 'agentId and upiId are required.' });
    }

    let wallet = await SupportWallet.findOne({ agentId });
    if (!wallet) {
      wallet = await SupportWallet.create({ agentId });
    }

    const upiReq = {
      requestId: 'UPI_' + Date.now(),
      upiId: upiId.trim(),
      holderName: holderName || '',
      status: 'pending_approval',
      submittedAt: new Date(),
    };

    wallet.upiRequests.push(upiReq);
    wallet.upiStatus = 'pending_approval';
    await wallet.save();

    await AuditLog.logAction({
      userId: agentId,
      userRole: 'support_admin',
      action: 'UPI_SUBMITTED',
      category: 'upi',
      targetType: 'SupportWallet',
      targetId: agentId,
      details: { upiId, holderName },
      ipAddress: req.ip || '',
    });

    return res.status(200).json({
      success: true,
      message: 'UPI ID submitted for Main Admin verification & approval.',
      wallet,
    });
  } catch (error) {
    console.error('Error in submitSupportUpi:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// SUPPORT ADMIN WITHDRAWAL REQUEST (Requires Main Admin Approval)
const requestSupportWithdrawal = async (req, res) => {
  try {
    const { agentId, amount } = req.body;
    const numAmount = Number(amount);
    if (!agentId || isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid agentId and positive amount required.' });
    }

    const wallet = await SupportWallet.findOne({ agentId });
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Support Wallet not found.' });
    }

    if (wallet.upiStatus !== 'approved' || !wallet.activeUpiId) {
      return res.status(400).json({
        success: false,
        message: 'Your UPI ID has not been approved by Main Admin yet. Payout cannot be requested.',
      });
    }

    if (wallet.balance < numAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance! Your available balance is ₹${wallet.balance}.`,
      });
    }

    const charges = 0;
    const netPayable = numAmount - charges;
    const withdrawal = await SupportWithdrawal.create({
      agentId,
      agentName: wallet.agentName,
      amount: numAmount,
      charges,
      netPayable,
      upiId: wallet.activeUpiId,
      status: 'pending',
    });

    wallet.withdrawals.push(withdrawal);
    await wallet.save();

    await AuditLog.logAction({
      userId: agentId,
      userRole: 'support_admin',
      action: 'WITHDRAWAL_REQUESTED',
      category: 'payout',
      targetType: 'SupportWithdrawal',
      targetId: withdrawal.requestId,
      details: { amount: numAmount, upiId: wallet.activeUpiId },
      ipAddress: req.ip || '',
    });

    return res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted successfully. Pending Main Admin approval.',
      withdrawal,
      wallet,
    });
  } catch (error) {
    console.error('Error in requestSupportWithdrawal:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// AUDIT LOGS RETRIEVAL
const getAuditLogs = async (req, res) => {
  try {
    const { category, action, limit = 100 } = req.query;
    const query = {};
    if (category) query.category = category;
    if (action) query.action = new RegExp(action, 'i');

    const logs = await AuditLog.find(query).sort({ createdAt: -1 }).limit(Number(limit)).lean();
    return res.status(200).json({ success: true, count: logs.length, logs });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getPayoutRules = async (req, res) => {
  try {
    const rules = await SupportPayoutRule.find({}).lean();
    return res.status(200).json({ success: true, rules });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

const transferCase = async (req, res) => {
  return assignCase(req, res);
};

const addCaseActivity = async (req, res) => {
  return addCaseMessage(req, res);
};

// CANCEL SUPPORT TICKET (From Customer / Rider / Store side or Admin)
const cancelSupportTicket = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { reason = 'Cancelled by user', cancelledBy } = req.body || {};

    const tId = caseId || req.body?.ticketId || req.body?.caseNumber;
    if (!tId) {
      return res.status(400).json({ success: false, message: 'Ticket ID is required' });
    }

    const ticket = await SupportCase.findOne({
      $or: [
        { ticketId: tId },
        { caseNumber: tId },
        ...(mongoose.Types.ObjectId.isValid(tId) ? [{ _id: tId }] : []),
      ],
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Support ticket not found' });
    }

    ticket.status = 'CANCELLED';
    ticket.closedAt = new Date();
    ticket.resolutionReason = reason;

    ticket.activities.push({
      type: 'status_change',
      body: `Ticket cancelled by ${cancelledBy || ticket.requesterRole || 'User'}. Reason: ${reason}`,
      createdAt: new Date(),
    });

    await ticket.save();

    console.log(`🛑 [SUPPORT TICKET CANCELLED BY USER]: ID=${ticket.ticketId} Requester=${ticket.requesterName} (${ticket.requesterRole})`);

    // Broadcast Real-Time Cancellation to Support Admin and all party rooms
    const io = getIO(req);
    if (io) {
      const payload = {
        ticketId: ticket.ticketId,
        caseNumber: ticket.caseNumber,
        status: 'CANCELLED',
        reason,
        cancelledAt: ticket.closedAt,
        ticket,
        case: ticket,
      };

      const eventNames = [
        'support_ticket_cancelled',
        'support_case_cancelled',
        'cancel_support_ticket',
        'support_ticket_status_changed',
        'case_cancelled',
      ];

      const rooms = [
        'support_admin_room',
        `support_ticket_${ticket.ticketId}`,
        `user_${ticket.requesterId}`,
        `support_user_${ticket.requesterId}`,
      ];

      if (ticket.riderId) rooms.push(`user_${ticket.riderId}`);
      if (ticket.customerId) rooms.push(`user_${ticket.customerId}`);
      if (ticket.restaurantId) rooms.push(`user_${ticket.restaurantId}`);

      rooms.forEach((room) => {
        eventNames.forEach((ev) => {
          io.to(room).emit(ev, payload);
        });
      });

      eventNames.forEach((ev) => {
        io.emit(ev, payload);
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Support ticket cancelled successfully on both sides.',
      ticket,
    });
  } catch (error) {
    console.error('Error in cancelSupportTicket:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getAgentWallet = (req, res) => {
  return typeof getSupportWallet === 'function' ? getSupportWallet(req, res) : res.status(200).json({ success: true, balance: 0 });
};

module.exports = {
  setIO,
  getDashboardStats,
  getQueueCases,
  getCaseById,
  createSupportRequest,
  cancelSupportTicket,
  addCaseMessage,
  addCaseActivity,
  updateCaseStatus,
  transferRiderOrder,
  getPreviousOrders,
  getUserTickets,
  assignCase,
  transferCase,
  resolveCase,
  executeMoneyAction,
  getAgents,
  updateAgentStatus,
  agentLogin,
  getAgentWallet,
  getPayoutRules,
  searchOrders,
  getOrderDetailsWithTracking,
  getLiveZonesAndRiders,
  processCancellationDecision,
  getSupportWallet,
  submitSupportUpi,
  requestSupportWithdrawal,
  getAuditLogs,
};

