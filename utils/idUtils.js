const mongoose = require('mongoose');

/**
 * Safely normalizes any string, ObjectId, or user object into a clean string representation.
 */
function normalizeId(id) {
  if (!id) return '';
  if (typeof id === 'string') return id.trim();
  if (id instanceof mongoose.Types.ObjectId || (id.constructor && id.constructor.name === 'ObjectId')) {
    return id.toString().trim();
  }
  if (typeof id.toHexString === 'function') {
    return id.toHexString().trim();
  }
  if (id._id && id._id !== id) return normalizeId(id._id);
  if (id.id && id.id !== id && typeof id.id === 'string') return normalizeId(id.id);
  if (typeof id.toString === 'function') {
    const s = id.toString();
    if (s && s !== '[object Object]') return s.trim();
  }
  return String(id).trim();
}

/**
 * Compares two IDs safely regardless of whether they are ObjectIds or strings.
 */
function areIdsEqual(id1, id2) {
  const norm1 = normalizeId(id1);
  const norm2 = normalizeId(id2);
  if (!norm1 || !norm2) return false;
  return norm1 === norm2;
}

/**
 * Converts valid 24-char hex string to Mongoose ObjectId safely, returning null if invalid.
 */
function toObjectIdSafely(id) {
  const norm = normalizeId(id);
  if (norm && mongoose.Types.ObjectId.isValid(norm)) {
    return new mongoose.Types.ObjectId(norm);
  }
  return null;
}

/**
 * Builds a Mongoose query filter that matches both String ID and ObjectId format.
 */
function buildIdQueryFilter(fieldName, idValue) {
  const norm = normalizeId(idValue);
  if (!norm) return {};
  const objId = toObjectIdSafely(norm);
  if (objId) {
    return { [fieldName]: { $in: [norm, objId] } };
  }
  return { [fieldName]: norm };
}

/**
 * Central Supplier Identity Resolver (Requirement 1 & 2)
 * Returns the canonical, immutable, database-backed supplierId string.
 *
 * Hierarchy:
 * 1. user.supplierId (if present and non-empty)
 * 2. user._id (canonical MongoDB identifier)
 * 3. user.id
 * 4. string / ObjectId normalized
 */
function resolveSupplierIdentity(userOrId) {
  if (!userOrId) return '';
  if (typeof userOrId === 'object') {
    if (userOrId.supplierId && typeof userOrId.supplierId === 'string' && userOrId.supplierId.trim()) {
      return userOrId.supplierId.trim();
    }
    if (userOrId._id) {
      return normalizeId(userOrId._id);
    }
    if (userOrId.id) {
      return normalizeId(userOrId.id);
    }
    if (userOrId.restaurantId) {
      return normalizeId(userOrId.restaurantId);
    }
  }
  return normalizeId(userOrId);
}

/**
 * Deterministic socket room generator for Supplier (Requirement 7)
 */
function getSupplierSocketRooms(supplierId) {
  const sId = resolveSupplierIdentity(supplierId);
  if (!sId) return [];
  return [
    `supplier:${sId}`,
    `supplier_${sId}`,
    `restaurant_${sId}`,
    `user_${sId}`,
    sId,
  ];
}

module.exports = {
  normalizeId,
  areIdsEqual,
  toObjectIdSafely,
  buildIdQueryFilter,
  resolveSupplierIdentity,
  getSupplierSocketRooms,
};
