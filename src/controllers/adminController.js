const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Video = require('../models/Video');
const SponsoredContent = require('../models/SponsoredContent');
const AdRevenueLog = require('../models/AdRevenueLog');
const Withdrawal = require('../models/Withdrawal');
const Wallet = require('../models/Wallet');
const { issueSessionTokens } = require('../utils/authSessions');

async function adminLogin(req, res) {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const admin = await User.findOne({ email, role: 'admin' }).select('+passwordHash');
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    if (admin.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Admin account is blocked' });
    }

    return res.json(await issueSessionTokens(admin, 'admin'));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// --- Video (ad-network placement slot) management ---
async function listVideos(req, res) {
  const videos = await Video.find().sort({ createdAt: -1 });
  return res.json({ videos });
}
async function createVideo(req, res) {
  const video = await Video.create(req.body);
  return res.status(201).json({ video });
}
async function updateVideo(req, res) {
  const video = await Video.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!video) return res.status(404).json({ error: 'Video not found' });
  return res.json({ video });
}

// --- Sponsored content (brand campaign) management ---
async function listSponsoredContent(req, res) {
  const campaigns = await SponsoredContent.find().sort({ createdAt: -1 });
  return res.json({ campaigns });
}
async function createSponsoredContent(req, res) {
  const campaign = await SponsoredContent.create(req.body);
  return res.status(201).json({ campaign });
}
async function updateSponsoredContent(req, res) {
  const campaign = await SponsoredContent.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  return res.json({ campaign });
}

// --- User management ---
async function listUsers(req, res) {
  const { status, search } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { email: new RegExp(search, 'i') },
      { mobileNumber: new RegExp(search, 'i') },
    ];
  }
  const users = await User.find(filter)
    .select('-passwordHash -otpCode -otpCodeHash -otpAttempts -otpSentAt -otpWindowStartedAt -otpSendCount')
    .sort({ createdAt: -1 });
  return res.json({ users });
}
async function setUserStatus(req, res) {
  const { status } = req.body;
  if (!['ACTIVE', 'BLOCKED'].includes(status)) {
    return res.status(400).json({ error: 'status must be ACTIVE or BLOCKED' });
  }
  const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user });
}

// --- Financial ledger ---
async function getLedger(req, res) {
  const [totals] = await AdRevenueLog.aggregate([
    {
      $group: {
        _id: null,
        totalGrossRevenue: { $sum: '$grossRevenue' },
        totalUserPayouts: { $sum: '$userShare' },
        totalReferrerPayouts: { $sum: '$referrerShare' },
      },
    },
  ]);

  const adRevenue = await AdRevenueLog.aggregate([
    { $match: { sourceType: 'ad_network' } },
    { $group: { _id: null, sum: { $sum: '$grossRevenue' } } },
  ]);
  const sponsorRevenue = await AdRevenueLog.aggregate([
    { $match: { sourceType: 'sponsored' } },
    { $group: { _id: null, sum: { $sum: '$grossRevenue' } } },
  ]);

  const summary = totals || { totalGrossRevenue: 0, totalUserPayouts: 0, totalReferrerPayouts: 0 };
  const platformMargin =
    summary.totalGrossRevenue - summary.totalUserPayouts - summary.totalReferrerPayouts;

  return res.json({
    adNetworkRevenue: adRevenue[0]?.sum || 0,
    sponsoredRevenue: sponsorRevenue[0]?.sum || 0,
    totalGrossRevenue: summary.totalGrossRevenue,
    totalPaidToUsers: summary.totalUserPayouts,
    totalPaidToReferrers: summary.totalReferrerPayouts,
    platformMargin,
  });
}

// --- Withdrawal approvals ---
async function listWithdrawals(req, res) {
  const { status = 'PENDING' } = req.query;
  const withdrawals = await Withdrawal.find({ status }).populate('userId', 'email mobileNumber');
  return res.json({ withdrawals });
}

async function reviewWithdrawal(req, res) {
  try {
    const { action, transactionRef, rejectionReason } = req.body; // action: 'APPROVE' | 'REJECT'
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
    if (withdrawal.status !== 'PENDING' && withdrawal.status !== 'UNDER_REVIEW') {
      return res.status(400).json({ error: 'Withdrawal already processed' });
    }

    if (action === 'APPROVE') {
      withdrawal.status = 'PAID';
      withdrawal.reviewedAt = new Date();
      withdrawal.paidAt = new Date();
      withdrawal.transactionRef = transactionRef || null;
      await withdrawal.save();
      await Wallet.updateOne(
        { userId: withdrawal.userId },
        { $inc: { totalBalance: -withdrawal.amount, pendingWithdrawal: -withdrawal.amount } }
      );
    } else if (action === 'REJECT') {
      withdrawal.status = 'REJECTED';
      withdrawal.reviewedAt = new Date();
      withdrawal.rejectionReason = rejectionReason || 'Not specified';
      await withdrawal.save();
      await Wallet.updateOne(
        { userId: withdrawal.userId },
        { $inc: { pendingWithdrawal: -withdrawal.amount } }
      );
    } else {
      return res.status(400).json({ error: "action must be 'APPROVE' or 'REJECT'" });
    }

    return res.json({ withdrawal });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// --- Referral settings ---
async function updateReferralShare(req, res) {
  // In a full implementation this would persist to a Settings collection
  // and be read by videoController instead of process.env. Kept simple here.
  return res.status(501).json({
    error: 'Wire this up to a persisted Settings collection read by videoController',
  });
}

module.exports = {
  adminLogin,
  listVideos,
  createVideo,
  updateVideo,
  listSponsoredContent,
  createSponsoredContent,
  updateSponsoredContent,
  listUsers,
  setUserStatus,
  getLedger,
  listWithdrawals,
  reviewWithdrawal,
  updateReferralShare,
};
