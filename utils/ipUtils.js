/**
 * Safely extracts client IP address and IP version from HTTP request.
 * Supports reverse proxy handling (X-Forwarded-For) and direct socket connections.
 * Separates IP address from GPS location information for audit/security purposes.
 */
function getClientIp(req) {
  if (!req) return { ipAddress: '127.0.0.1', ipVersion: 'IPv4' };

  let rawIp = '';

  // 1. Check req.ip (Express parses X-Forwarded-For if trust proxy is configured)
  if (req.ip && typeof req.ip === 'string') {
    rawIp = req.ip;
  }
  // 2. Check X-Forwarded-For header fallback
  else if (req.headers && req.headers['x-forwarded-for']) {
    const forwarded = req.headers['x-forwarded-for'];
    rawIp = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : String(forwarded);
  }
  // 3. Direct socket remote address
  else if (req.socket && req.socket.remoteAddress) {
    rawIp = req.socket.remoteAddress;
  }
  // 4. Fallback connection remote address
  else if (req.connection && req.connection.remoteAddress) {
    rawIp = req.connection.remoteAddress;
  }

  // Normalize IPv6-mapped IPv4 addresses e.g. ::ffff:192.168.1.1 -> 192.168.1.1
  let cleanIp = rawIp.trim();
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.replace('::ffff:', '');
  }

  if (!cleanIp || cleanIp === '::1' || cleanIp === 'localhost') {
    cleanIp = '127.0.0.1';
  }

  const ipVersion = cleanIp.includes(':') ? 'IPv6' : 'IPv4';

  return {
    ipAddress: cleanIp,
    ipVersion,
  };
}

module.exports = { getClientIp };
