/**
 * redactUtils.js
 * Enforces state-based location visibility (Requirement 4).
 * Strictly conceals customer drop coordinates and address from rider until order is picked up.
 */

'use strict';

function redactDropLocationForRider(bookingObj, isRiderContext = false) {
  if (!bookingObj || !isRiderContext) return bookingObj;
  const status = (bookingObj.status || '').toUpperCase();
  const deliveryStatus = (bookingObj.deliveryStatus || '').toUpperCase();
  const riderStatus = (bookingObj.riderStatus || '').toUpperCase();

  const isPickedUp = ['PICKED_UP', 'OUT_FOR_DELIVERY', 'STARTED', 'SERVICE_STARTED', 'FOOD_PICKED_UP', 'REACHED_CUSTOMER', 'DELIVERED', 'COMPLETED', 'SERVICE_COMPLETED'].includes(status) ||
                     ['OUT_FOR_DELIVERY', 'PICKED_UP', 'FOOD_PICKED_UP', 'DELIVERED', 'COMPLETED'].includes(deliveryStatus) ||
                     ['OUT_FOR_DELIVERY', 'FOOD_PICKED_UP', 'REACHED_CUSTOMER', 'DELIVERED', 'COMPLETED'].includes(riderStatus);

  if (!isPickedUp) {
    const concealedCopy = (typeof bookingObj.toObject === 'function') ? bookingObj.toObject() : { ...bookingObj };
    concealedCopy.destinationAddress = 'Concealed until order pickup';
    concealedCopy.customerAddress = 'Concealed until order pickup';
    concealedCopy.deliveryAddress = 'Concealed until order pickup';
    concealedCopy.destinationLatitude = null;
    concealedCopy.destinationLongitude = null;
    concealedCopy.customerLatitude = null;
    concealedCopy.customerLongitude = null;
    concealedCopy.dropLocation = null;
    return concealedCopy;
  }
  return bookingObj;
}

module.exports = {
  redactDropLocationForRider,
};
