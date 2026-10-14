const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');

/**
 * Protect middleware: Verifies JWT token in Authorization header.
 * Sets req.user with canonical user object from MongoDB.
 */
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      if (token && token !== 'jwt_mock_token' && token !== 'undefined' && token !== 'null') {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwt_secret_dating_app_key');
        if (decoded && decoded.id) {
          req.user = await User.findById(decoded.id).select('-password');

          if (!req.user) {
            return res.status(401).json({ success: false, message: 'Not authorized, user account not found.' });
          }

          if (req.user.isSuspended) {
            return res.status(403).json({ success: false, message: 'Not authorized, user account is suspended.' });
          }

          return next();
        }
      }
    } catch (error) {
      console.error('[AuthMiddleware Error]:', error.message);
      return res.status(401).json({ success: false, message: 'Not authorized, token validation failed or expired.' });
    }
  }

  return res.status(401).json({ success: false, message: 'Not authorized, access token missing.' });
};

/**
 * Optional protect middleware: Attempts to decode token if present, but does not block if omitted.
 */
const optionalProtect = async (req, res, next) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      const token = req.headers.authorization.split(' ')[1];
      if (token && token !== 'jwt_mock_token' && token !== 'undefined' && token !== 'null') {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwt_secret_dating_app_key');
        if (decoded && decoded.id) {
          const user = await User.findById(decoded.id).select('-password');
          if (user && !user.isSuspended) {
            req.user = user;
          }
        }
      }
    } catch (e) {
      // Non-blocking optional authentication
    }
  }
  next();
};

/**
 * Role-based authorization middleware.
 */
const protectRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authorized, authentication required.' });
    }
    const userRole = (req.user.role || 'customer').toLowerCase();
    const normalizedAllowed = allowedRoles.map(r => r.toLowerCase());

    const isMatch = normalizedAllowed.some(r => {
      if (r === 'supplier' && (userRole === 'supplier' || userRole === 'seller_partner')) return true;
      if (r === 'rider' && (userRole === 'rider' || userRole === 'delivery_partner' || userRole === 'provider')) return true;
      if (r === 'customer' && userRole === 'customer') return true;
      if (r === 'admin' && (userRole === 'admin' || req.user.isAdmin)) return true;
      return r === userRole;
    });

    if (!isMatch) {
      return res.status(403).json({
        success: false,
        message: `Forbidden. Role '${req.user.role}' is not authorized to access this endpoint.`
      });
    }

    next();
  };
};

const protectOrRestaurant = async (req, res, next) => {
  // 1. Try Bearer token first
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      const token = req.headers.authorization.split(' ')[1];
      if (token && token !== 'jwt_mock_token' && token !== 'undefined' && token !== 'null') {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwt_secret_dating_app_key');
        if (decoded && decoded.id) {
          req.user = await User.findById(decoded.id).select('-password');
          if (req.user && !req.user.isSuspended) {
            return next();
          }
        }
      }
    } catch (e) {}
  }

  // 2. Fallback to restaurantId in body/query/params
  const rId = req.body.restaurantId || req.query.restaurantId || req.params.restaurantId;
  if (rId && mongoose.Types.ObjectId.isValid(rId)) {
    try {
      const user = await User.findById(rId).select('-password');
      if (user && !user.isSuspended) {
        req.user = user;
        return next();
      }
    } catch (e) {}
  }

  return res.status(401).json({ success: false, message: 'Not authorized. Valid token or restaurant ID required.' });
};

module.exports = { protect, optionalProtect, protectRole, protectOrRestaurant };
