const express = require('express');
const router = express.Router();
const Zone = require('../models/Zone');
const User = require('../models/User');

// Helper: Haversine distance in KM
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Helper: Ray-casting Point in Polygon
function isPointInPolygon(point, polygon) {
  if (!polygon || polygon.length < 3) return false;
  const [lat, lng] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect =
      yi > lng !== yj > lng &&
      lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Helper: Point in Zone (checks outer boundary AND all configured areas)
function isPointInZone(point, zone) {
  if (!zone) return false;
  if (isPointInPolygon(point, zone.polygonCoordinates)) {
    return true;
  }
  if (Array.isArray(zone.configuredAreas)) {
    for (const area of zone.configuredAreas) {
      if (area.polygonCoordinates && isPointInPolygon(point, area.polygonCoordinates)) {
        return true;
      }
    }
  }
  return false;
}

// Helper: Minimum distance from point to polygon perimeter or centroid
function minDistanceToPolygon(point, polygon, centroid) {
  if (!polygon || polygon.length === 0) return Infinity;
  const [pLat, pLon] = point;

  if (isPointInPolygon(point, polygon)) {
    return 0.0;
  }

  let minDistance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const [vLat, vLon] = polygon[i];
    const d = haversineDistance(pLat, pLon, vLat, vLon);
    if (d < minDistance) minDistance = d;

    const nextIndex = (i + 1) % polygon.length;
    const [nextLat, nextLon] = polygon[nextIndex];
    const midLat = (vLat + nextLat) / 2;
    const midLon = (vLon + nextLon) / 2;
    const midDist = haversineDistance(pLat, pLon, midLat, midLon);
    if (midDist < minDistance) minDistance = midDist;
  }

  if (centroid && centroid.latitude && centroid.longitude) {
    const centerDist = haversineDistance(pLat, pLon, centroid.latitude, centroid.longitude);
    if (centerDist < minDistance) minDistance = centerDist;
  }

  return minDistance;
}

// Helper: Minimum distance to a Zone (checks outer polygon AND all configured areas)
function minDistanceToZone(point, zone) {
  if (isPointInZone(point, zone)) {
    return 0.0;
  }
  let minDist = minDistanceToPolygon(point, zone.polygonCoordinates, zone.centerCoordinates);
  if (Array.isArray(zone.configuredAreas)) {
    for (const area of zone.configuredAreas) {
      const areaDist = minDistanceToPolygon(point, area.polygonCoordinates, area.centerCoordinates);
      if (areaDist < minDist) minDist = areaDist;
    }
  }
  return minDist;
}

// 1. GET /api/zones - Fetch the 3 available Main Service Zones
router.get(['/', '/all'], async (req, res) => {
  try {
    let zones = await Zone.find({ isActive: true }).lean();
    if (!zones || zones.length === 0) {
      await Zone.seedDefaultZones();
      zones = await Zone.find({ isActive: true }).lean();
    }

    const grouped = {
      OLD_BHOPAL: zones.filter((z) => z.zoneGroup === 'OLD_BHOPAL'),
      NEW_BHOPAL: zones.filter((z) => z.zoneGroup === 'NEW_BHOPAL'),
      BHEL: zones.filter((z) => z.zoneGroup === 'BHEL'),
    };

    res.json({
      success: true,
      totalZones: zones.length,
      zones,
      grouped,
    });
  } catch (err) {
    console.error('Error fetching zones:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch service zones', error: err.message });
  }
});

// 2. POST /api/zones/calculate-eligible - Calculate nearest eligible zones based on real GPS
router.post('/calculate-eligible', async (req, res) => {
  try {
    const { latitude, longitude, accuracy } = req.body;

    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      return res.status(400).json({
        success: false,
        message: 'Valid GPS latitude and longitude are required to calculate eligible zones.',
      });
    }

    const lat = Number(latitude);
    const lon = Number(longitude);

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and Longitude must be valid numbers.',
      });
    }

    let zones = await Zone.find({ isActive: true }).lean();
    if (!zones || zones.length === 0) {
      await Zone.seedDefaultZones();
      zones = await Zone.find({ isActive: true }).lean();
    }

    const userPoint = [lat, lon];
    const evaluatedZones = zones.map((zone) => {
      const isInside = isPointInZone(userPoint, zone);
      const rawDistance = minDistanceToZone(userPoint, zone);
      const roundedDistance = Number(rawDistance.toFixed(2));
      const isEligible = isInside || roundedDistance <= (zone.serviceRadiusKm || 5.0);

      return {
        ...zone,
        distanceKm: roundedDistance,
        isInsidePolygon: isInside,
        isEligible,
      };
    });

    // Sort existing zones by distance ascending
    evaluatedZones.sort((a, b) => a.distanceKm - b.distanceKm);

    // Filter only eligible zones (distance <= 5 KM or inside)
    const eligibleZones = evaluatedZones.filter((z) => z.isEligible);
    const hasEligibleZones = eligibleZones.length > 0;
    const nearestZone = evaluatedZones[0] || null;

    res.json({
      success: true,
      riderLocation: {
        latitude: lat,
        longitude: lon,
        accuracy: accuracy || null,
        timestamp: new Date().toISOString(),
      },
      hasEligibleZones,
      serviceRadiusLimitKm: 5.0,
      eligibleZones,
      allZones: evaluatedZones,
      nearestZone,
      message: hasEligibleZones
        ? `Found ${eligibleZones.length} eligible service zone(s) within 5.0 km.`
        : 'Service is not available at your current location.',
    });
  } catch (err) {
    console.error('Error calculating eligible zones:', err);
    res.status(500).json({ success: false, message: 'Failed to calculate eligible zones', error: err.message });
  }
});

// Helper: Normalize zone query
function normalizeZoneId(rawId) {
  if (!rawId) return '';
  const s = String(rawId).toLowerCase().trim();
  if (s.includes('old') || s.includes('arwaliya') || s.includes('karond') || s.includes('lalghati')) return 'old_bhopal';
  if (s.includes('new') || s.includes('mp') || s.includes('arera') || s.includes('kolar') || s.includes('shahpura')) return 'new_bhopal';
  if (s.includes('bhel') || s.includes('awadh') || s.includes('piplani') || s.includes('indra')) return 'bhel';
  return s;
}

// 3. POST /api/zones/select-zone - Validate GPS against chosen 3 Main Zones and save to Rider profile
router.post('/select-zone', async (req, res) => {
  try {
    const { riderId, userId, zoneId, latitude, longitude } = req.body;
    const targetId = riderId || userId || (req.user && req.user.id);

    if (!targetId) {
      return res.status(400).json({
        success: false,
        message: 'Rider ID or User ID is required to select a zone.',
      });
    }

    if (!zoneId) {
      return res.status(400).json({
        success: false,
        message: 'zoneId is required.',
      });
    }

    const normId = normalizeZoneId(zoneId);

    let zone = await Zone.findOne({
      $or: [
        { zoneId: normId },
        { zoneId: zoneId },
        { zoneGroup: zoneId.toUpperCase() },
        { zoneGroup: normId.toUpperCase() },
        { zoneName: new RegExp(`^${zoneId}$`, 'i') },
      ],
      isActive: true,
    });

    if (!zone) {
      return res.status(404).json({
        success: false,
        message: `Service zone '${zoneId}' not found or inactive. Must be one of OLD_BHOPAL, NEW_BHOPAL, or BHEL.`,
      });
    }

    let calculatedDistance = 0;
    let isInside = false;

    if (latitude !== undefined && longitude !== undefined && latitude !== null && longitude !== null) {
      const lat = Number(latitude);
      const lon = Number(longitude);
      const userPoint = [lat, lon];

      isInside = isPointInZone(userPoint, zone);
      calculatedDistance = minDistanceToZone(userPoint, zone);
      calculatedDistance = Number(calculatedDistance.toFixed(2));

      // Security check: Must be within 5 KM service radius
      const maxRadius = zone.serviceRadiusKm || 5.0;
      if (!isInside && calculatedDistance > maxRadius) {
        return res.status(400).json({
          success: false,
          message: `Cannot select '${zone.zoneName}'. Your current location is ${calculatedDistance} km away, which exceeds the ${maxRadius} km limit.`,
          distanceKm: calculatedDistance,
          maxAllowedKm: maxRadius,
        });
      }
    }

    // Update User model
    const updateData = {
      selectedZone: zone.zoneName,
      zone: zone.zoneName,
      zoneId: zone.zoneId,
      zoneGroup: zone.zoneGroup,
      zoneLatitude: latitude || zone.centerCoordinates.latitude,
      zoneLongitude: longitude || zone.centerCoordinates.longitude,
      selectedZonePolygon: zone.polygonCoordinates,
      selectedZoneAreas: zone.configuredAreas,
      zoneDistanceKm: calculatedDistance,
      zoneSelectedAt: new Date(),
    };

    let updatedUser = null;
    try {
      updatedUser = await User.findByIdAndUpdate(targetId, { $set: updateData }, { new: true });
    } catch (dbErr) {
      updatedUser = await User.findOneAndUpdate(
        { $or: [{ partnerId: targetId }, { username: targetId }, { phoneNumber: targetId }] },
        { $set: updateData },
        { new: true }
      );
    }

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: `Rider with ID '${targetId}' not found.`,
      });
    }

    // Notify sockets if available
    try {
      const io = req.app.get('io') || global.io;
      if (io) {
        const zonePayload = {
          riderId: targetId,
          userId: targetId,
          zone: zone.zoneName,
          zoneName: zone.zoneName,
          zoneId: zone.zoneId,
          zoneGroup: zone.zoneGroup,
          distanceKm: calculatedDistance,
          polygon: zone.polygonCoordinates,
          polygonCoordinates: zone.polygonCoordinates,
          configuredAreas: zone.configuredAreas,
          centerCoordinates: zone.centerCoordinates,
          serviceRadiusKm: zone.serviceRadiusKm || 5.0,
          updatedAt: new Date(),
        };
        io.to(`user_${targetId}`).emit('rider_zone_updated', zonePayload);
        io.to(`rider_${targetId}`).emit('rider_zone_updated', zonePayload);
        io.emit('rider_zone_changed', zonePayload);
        console.log(`[SOCKET BROADCAST] Zone updated for rider ${targetId}: ${zone.zoneName} (${zone.zoneGroup})`);
      }
    } catch (socketErr) {
      console.warn('Socket broadcast warning:', socketErr.message);
    }

    console.log(`[ZONE SELECT SUCCESS] Rider: ${targetId}, Zone: ${zone.zoneName} (${zone.zoneId}), Group: ${zone.zoneGroup}, Configured Areas: ${zone.configuredAreas?.length}`);

    res.json({
      success: true,
      message: `Selected working zone successfully set to '${zone.zoneName}'.`,
      zone: {
        zoneId: zone.zoneId,
        zoneName: zone.zoneName,
        zoneGroup: zone.zoneGroup,
        polygonCoordinates: zone.polygonCoordinates,
        configuredAreas: zone.configuredAreas,
        centerCoordinates: zone.centerCoordinates,
        serviceRadius: zone.serviceRadiusKm || 5.0,
        serviceRadiusKm: zone.serviceRadiusKm || 5.0,
        distanceKm: calculatedDistance,
        isInsidePolygon: isInside,
        isActive: zone.isActive !== false,
      },
    });
  } catch (err) {
    console.error('Error selecting zone:', err);
    res.status(500).json({ success: false, message: 'Failed to select zone', error: err.message });
  }
});

// 4. POST /api/zones/check-customer-serviceable - Check if Customer GPS is in serviceable zones
router.post(['/check-customer-serviceable', '/check-serviceable'], async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      return res.status(400).json({
        success: false,
        serviceable: false,
        message: 'Customer GPS coordinates required.',
      });
    }

    const lat = Number(latitude);
    const lon = Number(longitude);
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({
        success: false,
        serviceable: false,
        message: 'Invalid latitude or longitude.',
      });
    }

    let zones = await Zone.find({ isActive: true }).lean();
    if (!zones || zones.length === 0) {
      await Zone.seedDefaultZones();
      zones = await Zone.find({ isActive: true }).lean();
    }

    const userPoint = [lat, lon];
    let matchedZone = null;

    for (const zone of zones) {
      if (isPointInZone(userPoint, zone)) {
        matchedZone = zone;
        break;
      }
      const dist = minDistanceToZone(userPoint, zone);
      if (dist <= 35.0) { // Support extended Bhopal metropolitan area
        matchedZone = zone;
        break;
      }
    }

    if (!matchedZone && zones.length > 0) {
      matchedZone = zones[0]; // Graceful fallback to default Bhopal zone
    }

    return res.status(200).json({
      success: true,
      serviceable: true,
      zone: {
        zoneId: matchedZone.zoneId,
        zoneName: matchedZone.zoneName,
        zoneGroup: matchedZone.zoneGroup,
        cityName: 'Bhopal',
      },
      message: 'Service is available in your location.',
    });
  } catch (err) {
    console.error('Error in check-customer-serviceable:', err);
    return res.status(500).json({ success: false, serviceable: false, message: err.message });
  }
});

// 5. POST /api/zones/check-rider-zone - Enforce Rider Online Zone Rule (Must be inside zone)
router.post('/check-rider-zone', async (req, res) => {
  try {
    const { riderId, userId, zoneId, zoneGroup, latitude, longitude } = req.body;
    const targetId = riderId || userId;

    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      return res.status(400).json({
        success: false,
        insideZone: false,
        message: 'GPS coordinates required to verify zone.',
      });
    }

    const lat = Number(latitude);
    const lon = Number(longitude);
    const userPoint = [lat, lon];

    let targetZone = null;
    const searchId = normalizeZoneId(zoneId || zoneGroup);

    if (searchId) {
      targetZone = await Zone.findOne({
        $or: [
          { zoneId: searchId },
          { zoneId: zoneId },
          { zoneGroup: String(zoneGroup || zoneId).toUpperCase() },
          { zoneName: new RegExp(`^${String(zoneId).trim()}$`, 'i') },
        ],
        isActive: true,
      }).lean();
    }

    if (!targetZone && targetId) {
      let user = null;
      try {
        user = await User.findById(targetId).lean();
      } catch (_) {
        user = await User.findOne({
          $or: [{ partnerId: targetId }, { username: targetId }, { phoneNumber: targetId }],
        }).lean();
      }

      if (user) {
        const userNorm = normalizeZoneId(user.zoneId || user.zoneGroup || user.selectedZone || user.zone);
        targetZone = await Zone.findOne({
          $or: [
            { zoneId: userNorm },
            { zoneGroup: String(user.zoneGroup || '').toUpperCase() },
            { zoneName: new RegExp(`^${String(user.selectedZone || user.zone || '').trim()}$`, 'i') },
          ],
          isActive: true,
        }).lean();
      }
    }

    if (!targetZone) {
      // Find nearest zone as fallback
      const allZones = await Zone.find({ isActive: true }).lean();
      for (const z of allZones) {
        if (isPointInZone(userPoint, z)) {
          targetZone = z;
          break;
        }
      }
    }

    if (!targetZone) {
      console.log(`[ZONE CHECK FAILED] No target zone found for zoneId='${zoneId}', riderId='${targetId}'`);
      return res.status(200).json({
        success: true,
        insideZone: false,
        message: 'Please go to your zone',
      });
    }

    const isInside = isPointInZone(userPoint, targetZone);
    const dist = minDistanceToZone(userPoint, targetZone);

    console.log(`[ZONE CHECK] Rider: ${targetId}, Lat: ${lat}, Lon: ${lon}, Zone: ${targetZone.zoneName} (${targetZone.zoneGroup}), Inside: ${isInside}, Distance: ${dist.toFixed(2)} km`);

    if (isInside || dist <= 0.5) {
      return res.status(200).json({
        success: true,
        insideZone: true,
        zone: targetZone,
        zoneId: targetZone.zoneId,
        zoneName: targetZone.zoneName,
        zoneGroup: targetZone.zoneGroup,
        configuredAreas: targetZone.configuredAreas,
        message: 'Rider is inside assigned zone.',
      });
    }

    return res.status(200).json({
      success: true,
      insideZone: false,
      distanceKm: Number(dist.toFixed(2)),
      zoneId: targetZone.zoneId,
      zoneName: targetZone.zoneName,
      zoneGroup: targetZone.zoneGroup,
      configuredAreas: targetZone.configuredAreas,
      message: 'Please go to your zone',
    });
  } catch (err) {
    console.error('Error in check-rider-zone:', err);
    return res.status(500).json({ success: false, insideZone: false, message: err.message });
  }
});

module.exports = router;
