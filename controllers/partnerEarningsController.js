const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const User = require('../models/User');

/**
 * Calculates accurate supplier earning for a single order according to existing payout policy.
 * Preference:
 * 1. Dedicated financialBreakdown.supplierNet if available and > 0.
 * 2. financialBreakdown.supplierGross - supplierDeductions if available.
 * 3. subtotal (itemTotal).
 * 4. price - deliveryFee.
 */
function calculateSupplierOrderEarning(order) {
  if (!order) return 0;

  // 1. Dedicated Supplier Net Payout field
  if (
    order.financialBreakdown &&
    typeof order.financialBreakdown.supplierNet === 'number' &&
    order.financialBreakdown.supplierNet > 0
  ) {
    return Math.round(order.financialBreakdown.supplierNet);
  }

  // 2. Gross minus deductions
  if (
    order.financialBreakdown &&
    typeof order.financialBreakdown.supplierGross === 'number' &&
    order.financialBreakdown.supplierGross > 0
  ) {
    const net = order.financialBreakdown.supplierGross - (order.financialBreakdown.supplierDeductions || 0);
    if (net > 0) return Math.round(net);
  }

  // 3. Subtotal (items total, strictly excluding delivery fee and platform charges)
  const sub = Number(order.subtotal);
  if (!isNaN(sub) && sub > 0) {
    return Math.round(sub);
  }

  // 4. Fallback: price minus rider delivery fee
  const price = Number(order.price || order.totalAmount || 0);
  const deliveryFee = Number(order.deliveryFee || 0);
  return Math.max(0, Math.round(price - deliveryFee));
}

/**
 * Formats a clean item summary string from order cartItems or category/service name.
 */
function extractItemSummary(order) {
  if (Array.isArray(order.cartItems) && order.cartItems.length > 0) {
    const parts = order.cartItems
      .filter(item => item && (item.name || item.title || item.itemName))
      .map(item => {
        const qty = item.quantity || item.qty || 1;
        const name = (item.name || item.title || item.itemName || 'Item').trim();
        return `${qty}x ${name}`;
      });
    if (parts.length > 0) {
      return parts.join(', ');
    }
  }

  if (order.cartItems && typeof order.cartItems === 'object') {
    const values = Object.values(order.cartItems);
    if (values.length > 0) {
      const parts = values
        .filter(item => item && (typeof item === 'string' || item.name || item.title))
        .map(item => {
          if (typeof item === 'string') return item;
          const qty = item.quantity || item.qty || 1;
          const name = (item.name || item.title || item.itemName || 'Item').trim();
          return `${qty}x ${name}`;
        });
      if (parts.length > 0) {
        return parts.join(', ');
      }
    }
  }

  return order.serviceName || order.categoryName || 'Store Order';
}

/**
 * GET /api/partner/earnings-by-date?date=YYYY-MM-DD
 * Strict date-wise order filtering and accurate supplier partner earnings calculation.
 * Filters strictly by completedAt within the selected IST date [00:00:00 IST, next date 00:00:00 IST).
 */
exports.getEarningsByDate = async (req, res) => {
  try {
    // 1. Strict Authentication & Supplier Identity Validation
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized. Supplier session token is required.',
        totalOrders: 0,
        totalEarnings: 0,
        orders: [],
      });
    }

    const authUserId = req.user._id ? String(req.user._id) : String(req.user.id);
    const supplierIdVariants = [authUserId];
    if (req.user._id) supplierIdVariants.push(req.user._id);
    if (req.user.id) supplierIdVariants.push(String(req.user.id));
    if (req.user.partnerId) {
      supplierIdVariants.push(req.user.partnerId);
      supplierIdVariants.push(String(req.user.partnerId));
    }
    if (req.user.restaurantId) {
      supplierIdVariants.push(req.user.restaurantId);
      supplierIdVariants.push(String(req.user.restaurantId));
    }
    if (req.user.phoneNumber) {
      supplierIdVariants.push(req.user.phoneNumber);
    }

    // 2. Date Input Validation (YYYY-MM-DD format and valid calendar date)
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Expected YYYY-MM-DD (e.g. 2026-10-17)',
        totalOrders: 0,
        totalEarnings: 0,
        orders: [],
      });
    }

    const [yearStr, monthStr, dayStr] = date.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);

    const testUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    if (
      isNaN(testUtc.getTime()) ||
      testUtc.getUTCFullYear() !== year ||
      testUtc.getUTCMonth() !== month - 1 ||
      testUtc.getUTCDate() !== day
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid calendar date provided',
        totalOrders: 0,
        totalEarnings: 0,
        orders: [],
      });
    }

    // 3. IST to UTC Date Conversion
    // IST is UTC + 5:30 (offset: 5.5 hours = 19,800,000 milliseconds)
    const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
    const startUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - IST_OFFSET_MS);
    const endUtc = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0) - IST_OFFSET_MS);

    // 4. Query Database with MongoDB Aggregation
    const supplierMatch = {
      $or: [
        { supplierId: { $in: supplierIdVariants } },
        { restaurantId: { $in: supplierIdVariants } },
        { partnerId: { $in: supplierIdVariants } },
        { providerId: { $in: supplierIdVariants } },
      ],
    };

    const statusMatch = {
      status: { $in: ['COMPLETED', 'completed', 'DELIVERED', 'Delivered', 'SERVICE_COMPLETED'] },
      deliveryStatus: { $nin: ['CANCELLED', 'RESTAURANT_DECLINED', 'REJECTED', 'cancelled'] },
      riderStatus: { $nin: ['CANCELLED', 'DECLINED', 'REJECTED', 'cancelled'] },
      $or: [
        { cancelledAt: null },
        { cancelledAt: { $exists: false } },
      ],
    };

    // Strictly filter by completedAt (with fallback to deliveredAt)
    const dateMatch = {
      $or: [
        { completedAt: { $gte: startUtc, $lt: endUtc } },
        { completedAt: null, deliveredAt: { $gte: startUtc, $lt: endUtc } },
      ],
    };

    const matchCriteria = {
      $and: [supplierMatch, statusMatch, dateMatch],
    };

    // Use MongoDB aggregation with $facet for summary and order breakdown
    const aggregationResult = await Booking.aggregate([
      { $match: matchCriteria },
      { $sort: { completedAt: -1, deliveredAt: -1, createdAt: -1 } },
      {
        $facet: {
          orders: [
            {
              $project: {
                bookingId: 1,
                _id: 1,
                price: 1,
                subtotal: 1,
                deliveryFee: 1,
                financialBreakdown: 1,
                cartItems: 1,
                serviceName: 1,
                categoryName: 1,
                completedAt: 1,
                deliveredAt: 1,
                restaurantRatedAt: 1,
                updatedAt: 1,
                status: 1,
              },
            },
          ],
        },
      },
    ]);

    const rawOrders = (aggregationResult[0] && aggregationResult[0].orders) || [];

    // Format orders breakdown and calculate actual supplier earnings
    const formattedOrders = rawOrders.map(o => {
      const amount = calculateSupplierOrderEarning(o);
      const itemSummary = extractItemSummary(o);
      const completedTime = o.completedAt || o.deliveredAt || o.restaurantRatedAt || o.updatedAt;

      return {
        orderId: o.bookingId || String(o._id),
        amount,
        itemSummary,
        completedAt: completedTime,
        orderStatus: o.status || 'COMPLETED',
      };
    });

    const totalOrders = formattedOrders.length;
    const totalEarnings = formattedOrders.reduce((sum, order) => sum + order.amount, 0);

    // 5. Empty State Response
    if (totalOrders === 0) {
      return res.status(200).json({
        success: true,
        date,
        totalOrders: 0,
        totalEarnings: 0,
        orders: [],
        message: '0 Completed Orders on this date',
      });
    }

    // 6. Success Response with Breakdown
    return res.status(200).json({
      success: true,
      date,
      totalOrders,
      totalEarnings,
      orders: formattedOrders,
    });
  } catch (error) {
    console.error('❌ [PartnerEarningsByDate Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve date-wise partner earnings: ' + error.message,
      totalOrders: 0,
      totalEarnings: 0,
      orders: [],
    });
  }
};
