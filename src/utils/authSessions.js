const crypto = require('crypto');
const RefreshToken = require('../models/RefreshToken');
const { signAccessToken, ACCESS_TOKEN_TTL } = require('./jwt');

const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueSessionTokens(user, role = user.role, familyId = crypto.randomUUID(), session = null) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const tokenHash = hashRefreshToken(refreshToken);
  const refreshTokenDoc = {
    userId: user._id,
    role,
    familyId,
    tokenHash,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
  };
  const options = session ? { session } : undefined;
  await RefreshToken.create([refreshTokenDoc], options);

  const accessToken = signAccessToken(user, role);
  return {
    accessToken,
    refreshToken,
    token: accessToken,
    tokenType: 'Bearer',
    expiresIn: ACCESS_TOKEN_TTL,
  };
}

module.exports = { hashRefreshToken, issueSessionTokens, REFRESH_TOKEN_TTL_DAYS };