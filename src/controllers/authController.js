const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const RefreshToken = require('../models/RefreshToken');
const generateReferralCode = require('../utils/generateReferralCode');
const { normalizeMobileNumber, sendOtp } = require('../utils/otpDelivery');
const { hashRefreshToken, issueSessionTokens, REFRESH_TOKEN_TTL_DAYS } = require('../utils/authSessions');

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const OTP_WINDOW_MS = 60 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS_PER_HOUR = 5;
const BCRYPT_ROUNDS = 12;

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function tokenResponse(tokens) {
  return { ...tokens };
}

async function sendUserOtp(user, otpCode, channel) {
  try {
    await sendOtp({ channel, email: user.email, mobileNumber: user.mobileNumber, code: otpCode });
    return true;
  } catch (error) {
    console.error(`[auth] ${channel} OTP delivery failed:`, error.message);
    return false;
  }
}

async function register(req, res) {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body.password;
    const channel = req.body.otpChannel || 'email';
    if (!email || !req.body.mobileNumber || typeof password !== 'string') {
      return res.status(400).json({ error: 'mobileNumber, email, and password are required' });
    }
    if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email address is required' });
    if (Buffer.byteLength(password, 'utf8') > 72 || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and no more than 72 bytes' });
    }
    if (!['email', 'sms'].includes(channel)) {
      return res.status(400).json({ error: 'otpChannel must be email or sms' });
    }

    let mobileNumber;
    try {
      mobileNumber = normalizeMobileNumber(req.body.mobileNumber);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const existing = await User.findOne({ $or: [{ email }, { mobileNumber }] });
    if (existing) return res.status(409).json({ error: 'Account with this email or mobile number already exists' });

    let referredBy = null;
    if (req.body.referralCode) {
      const referrer = await User.findOne({ referralCode: req.body.referralCode });
      if (referrer) referredBy = referrer._id;
    }

    const otpCode = createOtp();
    const now = new Date();
    let referralCode;
    do {
      referralCode = generateReferralCode();
    } while (await User.exists({ referralCode }));

    const user = await User.create({
      mobileNumber,
      email,
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      referredBy,
      referralCode,
      otpCodeHash: await bcrypt.hash(otpCode, 10),
      otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
      otpAttempts: 0,
      otpSentAt: now,
      otpWindowStartedAt: now,
      otpSendCount: 1,
      otpChannel: channel,
    });

    if (!(await sendUserOtp(user, otpCode, channel))) {
      return res.status(503).json({
        error: 'Verification code could not be delivered. Retry using the resend endpoint.',
        userId: user._id,
      });
    }

    return res.status(201).json({ message: 'Verification code sent', userId: user._id, expiresInSeconds: 600 });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'Account with this email or mobile number already exists' });
    console.error('[auth] Registration failed:', error.message);
    return res.status(500).json({ error: 'Unable to register account' });
  }
}

async function verifyOtp(req, res) {
  const { userId, otpCode } = req.body;
  if (!mongoose.isValidObjectId(userId) || !/^\d{6}$/.test(otpCode || '')) {
    return res.status(400).json({ error: 'Invalid or expired verification code' });
  }

  const now = new Date();
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      isVerified: false,
      otpExpiresAt: { $gt: now },
      otpAttempts: { $lt: OTP_MAX_ATTEMPTS },
      otpCodeHash: { $ne: null },
    },
    { $inc: { otpAttempts: 1 } },
    { new: true }
  ).select('+otpCodeHash');
  if (!user || !(await bcrypt.compare(otpCode, user.otpCodeHash))) {
    return res.status(400).json({ error: 'Invalid or expired verification code' });
  }

  const session = await mongoose.startSession();
  let verifiedUser;
  let tokens;
  try {
    await session.withTransaction(async () => {
      verifiedUser = await User.findOneAndUpdate(
        {
          _id: user._id,
          isVerified: false,
          otpCodeHash: user.otpCodeHash,
          otpExpiresAt: { $gt: new Date() },
        },
        {
          $set: { isVerified: true },
          $unset: { otpCodeHash: 1, otpExpiresAt: 1, otpAttempts: 1 },
        },
        { new: true, session }
      );
      if (!verifiedUser) return;

      await Wallet.updateOne(
        { userId: verifiedUser._id },
        { $setOnInsert: { userId: verifiedUser._id, currency: 'USD' } },
        { upsert: true, session }
      );
      tokens = await issueSessionTokens(verifiedUser, 'user', undefined, session);
    });
  } catch (error) {
    console.error('[auth] OTP verification transaction failed:', error.message);
    return res.status(503).json({ error: 'Unable to complete account verification' });
  } finally {
    await session.endSession();
  }

  if (!verifiedUser || !tokens) return res.status(400).json({ error: 'Verification code has already been used' });
  return res.json({ message: 'Account verified', ...tokenResponse(tokens) });
}

async function resendOtp(req, res) {
  const { userId } = req.body;
  if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ error: 'Invalid user id' });

  const existingUser = await User.findOne({ _id: userId, isVerified: false });
  if (!existingUser) return res.status(404).json({ error: 'Unverified account not found' });
  const channel = req.body.otpChannel || existingUser.otpChannel || 'email';
  if (!['email', 'sms'].includes(channel)) return res.status(400).json({ error: 'otpChannel must be email or sms' });

  const now = new Date();
  const hourAgo = new Date(now.getTime() - OTP_WINDOW_MS);
  const cooldownCutoff = new Date(now.getTime() - OTP_COOLDOWN_MS);
  const otpCode = createOtp();
  const otpCodeHash = await bcrypt.hash(otpCode, 10);
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      isVerified: false,
      $and: [
        { $or: [{ otpSentAt: null }, { otpSentAt: { $lte: cooldownCutoff } }] },
        {
          $or: [
            { otpWindowStartedAt: null },
            { otpWindowStartedAt: { $lte: hourAgo } },
            { otpSendCount: { $lt: OTP_MAX_SENDS_PER_HOUR } },
          ],
        },
      ],
    },
    [
      {
        $set: {
          otpCodeHash,
          otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
          otpAttempts: 0,
          otpSentAt: now,
          otpSendCount: {
            $cond: [
              { $lte: [{ $ifNull: ['$otpWindowStartedAt', new Date(0)] }, hourAgo] },
              1,
              { $add: [{ $ifNull: ['$otpSendCount', 0] }, 1] },
            ],
          },
          otpWindowStartedAt: {
            $cond: [
              { $lte: [{ $ifNull: ['$otpWindowStartedAt', new Date(0)] }, hourAgo] },
              now,
              '$otpWindowStartedAt',
            ],
          },
          otpChannel: channel,
        },
      },
    ],
    { new: true }
  );
  if (!user) {
    return res.status(429).json({ error: 'Please wait before requesting another code or try again later' });
  }

  if (!(await sendUserOtp(user, otpCode, channel))) {
    return res.status(503).json({ error: 'Verification code could not be delivered' });
  }
  return res.json({ message: 'Verification code resent', expiresInSeconds: 600 });
}

async function login(req, res) {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body.password;
    if (!email || typeof password !== 'string') return res.status(400).json({ error: 'email and password are required' });

    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || user.role !== 'user' || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user.isVerified) return res.status(403).json({ error: 'Account not verified' });
    if (user.status !== 'ACTIVE') return res.status(403).json({ error: 'Account is blocked' });

    return res.json(tokenResponse(await issueSessionTokens(user, 'user')));
  } catch (error) {
    console.error('[auth] Login failed:', error.message);
    return res.status(500).json({ error: 'Unable to log in' });
  }
}

async function refreshSession(req, res) {
  const token = req.body.refreshToken;
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    return res.status(400).json({ error: 'A valid refreshToken is required' });
  }

  const tokenHash = hashRefreshToken(token);
  const existing = await RefreshToken.findOne({ tokenHash }).select('+tokenHash +replacedByHash');
  if (!existing) return res.status(401).json({ error: 'Invalid refresh token' });
  if (existing.consumedAt || existing.revokedAt) {
    await RefreshToken.updateMany(
      { familyId: existing.familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    return res.status(401).json({ error: 'Refresh token reuse detected; session revoked' });
  }
  if (existing.expiresAt <= new Date()) {
    existing.revokedAt = new Date();
    await existing.save();
    return res.status(401).json({ error: 'Refresh token expired' });
  }

  const session = await mongoose.startSession();
  let tokens;
  let reused = false;
  try {
    await session.withTransaction(async () => {
      const current = await RefreshToken.findOneAndUpdate(
        {
          _id: existing._id,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        },
        { $set: { consumedAt: new Date() } },
        { new: true, session }
      ).select('+tokenHash');

      if (!current) {
        reused = true;
        return;
      }

      const user = await User.findById(current.userId).session(session);
      if (!user || user.status !== 'ACTIVE' || user.role !== current.role || (current.role === 'user' && !user.isVerified)) {
        current.revokedAt = new Date();
        await current.save({ session });
        return;
      }

      tokens = await issueSessionTokens(user, current.role, current.familyId, session);
      current.replacedByHash = hashRefreshToken(tokens.refreshToken);
      await current.save({ session });
    });
  } catch (error) {
    console.error('[auth] Refresh failed:', error.message);
    return res.status(503).json({ error: 'Unable to refresh session' });
  } finally {
    await session.endSession();
  }

  if (reused) {
    await RefreshToken.updateMany(
      { familyId: existing.familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    return res.status(401).json({ error: 'Refresh token reuse detected; session revoked' });
  }
  if (!tokens) return res.status(401).json({ error: 'Account is no longer active' });
  return res.json(tokenResponse(tokens));
}

async function logout(req, res) {
  const token = req.body.refreshToken;
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    return res.status(400).json({ error: 'A valid refreshToken is required' });
  }
  await RefreshToken.updateOne(
    { tokenHash: hashRefreshToken(token), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  return res.status(204).end();
}

module.exports = { register, verifyOtp, resendOtp, login, refreshSession, logout };
