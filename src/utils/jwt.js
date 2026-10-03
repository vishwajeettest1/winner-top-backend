const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_ISSUER = 'winner-top-api';
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';

function getSecret(role) {
  const userSecret = process.env.JWT_USER_SECRET;
  const adminSecret = process.env.JWT_ADMIN_SECRET;
  if (!userSecret && !adminSecret) {
    const legacySecret = process.env.JWT_SECRET;
    if (legacySecret && legacySecret.length >= 32) {
      return crypto
        .createHmac('sha256', legacySecret)
        .update(`winner-top-api:${role}:access-v1`)
        .digest('hex');
    }
  }
  if (!userSecret || !adminSecret || userSecret.length < 32 || adminSecret.length < 32) {
    throw new Error('Configure distinct JWT_USER_SECRET and JWT_ADMIN_SECRET values of at least 32 characters');
  }
  if (userSecret === adminSecret) {
    throw new Error('JWT_USER_SECRET and JWT_ADMIN_SECRET must be different');
  }
  return role === 'admin' ? adminSecret : userSecret;
}

function audienceFor(role) {
  return role === 'admin' ? 'winner-top-admin' : 'winner-top-user';
}

function signAccessToken(user, role = user.role) {
  if (!['user', 'admin'].includes(role)) throw new Error('Invalid token role');
  return jwt.sign(
    { tokenType: 'access', role },
    getSecret(role),
    {
      subject: String(user._id || user.id),
      issuer: JWT_ISSUER,
      audience: audienceFor(role),
      expiresIn: ACCESS_TOKEN_TTL,
    }
  );
}

function verifyAccessToken(token, expectedRole) {
  if (!['user', 'admin'].includes(expectedRole)) throw new Error('Invalid expected role');
  const decoded = jwt.verify(token, getSecret(expectedRole), {
    issuer: JWT_ISSUER,
    audience: audienceFor(expectedRole),
  });
  if (decoded.tokenType !== 'access' || decoded.role !== expectedRole || !decoded.sub) {
    throw new Error('Invalid access token');
  }
  return { userId: decoded.sub, role: decoded.role };
}

module.exports = { signAccessToken, verifyAccessToken, ACCESS_TOKEN_TTL };