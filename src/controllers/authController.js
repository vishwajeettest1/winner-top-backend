const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const generateReferralCode = require('../utils/generateReferralCode');
const { signToken } = require('../utils/jwt');

// NOTE: OTP delivery is stubbed. Wire up Twilio (SMS) / SendGrid (email) here.
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function register(req, res) {
  try {
    const { mobileNumber, email, password, referralCode } = req.body;
    if (!mobileNumber || !email || !password) {
      return res.status(400).json({ error: 'mobileNumber, email, and password are required' });
    }

    const existing = await User.findOne({ $or: [{ email }, { mobileNumber }] });
    if (existing) {
      return res.status(409).json({ error: 'Account with this email or mobile number already exists' });
    }

    let referredBy = null;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) referredBy = referrer._id;
      // Silently ignore invalid referral codes rather than blocking signup.
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otpCode = generateOtp();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    let referralCodeForUser;
    do {
      referralCodeForUser = generateReferralCode();
    } while (await User.findOne({ referralCode: referralCodeForUser }));

    const user = await User.create({
      mobileNumber,
      email,
      passwordHash,
      referredBy,
      referralCode: referralCodeForUser,
      otpCode,
      otpExpiresAt,
    });

    // TODO: send otpCode via SMS/email provider instead of returning it.
    // Returned here only to make the scaffold runnable end-to-end in dev.
    return res.status(201).json({
      message: 'Registered. Verify with the OTP sent to your mobile/email.',
      userId: user._id,
      devOtp: process.env.NODE_ENV !== 'production' ? otpCode : undefined,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function verifyOtp(req, res) {
  try {
    const { userId, otpCode } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.isVerified) {
      return res.status(400).json({ error: 'Account already verified' });
    }
    if (!user.otpCode || user.otpCode !== otpCode || user.otpExpiresAt < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    user.isVerified = true;
    user.otpCode = null;
    user.otpExpiresAt = null;
    await user.save();

    // No investment gate: wallet is created immediately on verification.
    await Wallet.create({ userId: user._id });

    const token = signToken({ userId: user._id });
    return res.json({ message: 'Account verified', token });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    if (!user.isVerified) {
      return res.status(403).json({ error: 'Account not verified' });
    }
    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Account is blocked' });
    }

    const token = signToken({ userId: user._id });
    return res.json({ token });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { register, verifyOtp, login };
