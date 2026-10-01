const { verifyAccessToken } = require('../utils/jwt');
const User = require('../models/User');

async function authenticate(req, res, next, role) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing auth token' });

    const decoded = verifyAccessToken(token, role);
    const user = await User.findById(decoded.userId);
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.role !== role ||
      (role === 'user' && !user.isVerified)
    ) {
      return res.status(401).json({ error: 'Invalid or inactive account' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAuth(req, res, next) {
  return authenticate(req, res, next, 'user');
}

function requireAdminAuth(req, res, next) {
  return authenticate(req, res, next, 'admin');
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdminAuth, requireAdmin };
