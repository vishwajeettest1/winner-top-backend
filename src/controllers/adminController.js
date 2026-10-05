const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Video = require('../models/Video');
const SponsoredContent = require('../models/SponsoredContent');
const AdRevenueLog = require('../models/AdRevenueLog');
const Withdrawal = require('../models/Withdrawal');
const Wallet = require('../models/Wallet');
const ContactRequest = require('../models/ContactRequest');
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
class ReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const WITHDRAWAL_STATUSES = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PAID'];

async function listWithdrawals(req, res) {
  const status = String(req.query.status || 'ALL').toUpperCase();
  if (status !== 'ALL' && !WITHDRAWAL_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status filter' });
  }
  const filter = status === 'ALL' ? {} : { status };
  const withdrawals = await Withdrawal.find(filter)
    .sort({ requestedAt: -1 })
    .populate('userId', 'email mobileNumber');
  return res.json({ withdrawals });
}

async function reviewWithdrawal(req, res) {
  const { action } = req.body; // action: 'APPROVE' | 'REJECT'
  const transactionRef = typeof req.body.transactionRef === 'string' ? req.body.transactionRef.trim() : '';
  const rejectionReason = typeof req.body.rejectionReason === 'string' ? req.body.rejectionReason.trim() : '';

  if (action !== 'APPROVE' && action !== 'REJECT') {
    return res.status(400).json({ error: "action must be 'APPROVE' or 'REJECT'" });
  }
  if (action === 'REJECT' && !rejectionReason) {
    return res.status(400).json({ error: 'A remark is required to reject a withdrawal' });
  }
  if (rejectionReason.length > 500 || transactionRef.length > 120) {
    return res.status(400).json({ error: 'Remark or transaction reference is too long' });
  }

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = null;
      const now = new Date();
      const update =
        action === 'APPROVE'
          ? { status: 'APPROVED', reviewedAt: now, transactionRef: transactionRef || null }
          : { status: 'REJECTED', reviewedAt: now, rejectionReason };

      // Only a request that is still open can be processed, so repeats are no-ops.
      const withdrawal = await Withdrawal.findOneAndUpdate(
        { _id: req.params.id, status: { $in: ['PENDING', 'UNDER_REVIEW'] } },
        { $set: update },
        { new: true, session }
      );
      if (!withdrawal) {
        const exists = await Withdrawal.exists({ _id: req.params.id }).session(session);
        result = exists
          ? { code: 400, body: { error: 'Withdrawal already processed' } }
          : { code: 404, body: { error: 'Withdrawal not found' } };
        return;
      }

      const walletUpdate =
        action === 'APPROVE'
          ? await Wallet.updateOne(
              { userId: withdrawal.userId, totalBalance: { $gte: withdrawal.amount } },
              { $inc: { totalBalance: -withdrawal.amount, pendingWithdrawal: -withdrawal.amount } },
              { session }
            )
          : await Wallet.updateOne(
              { userId: withdrawal.userId },
              { $inc: { pendingWithdrawal: -withdrawal.amount } },
              { session }
            );

      if (!walletUpdate.modifiedCount) {
        throw new ReviewError(409, 'Wallet balance is too low to approve this withdrawal');
      }
      result = { code: 200, body: { withdrawal } };
    });
  } catch (err) {
    if (err instanceof ReviewError) return res.status(err.code).json({ error: err.message });
    console.error('[admin] Withdrawal review failed:', err.message);
    return res.status(500).json({ error: 'Unable to review this withdrawal' });
  } finally {
    await session.endSession();
  }

  return res.status(result?.code || 500).json(result?.body || { error: 'Unable to review this withdrawal' });
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
  listContactRequests,
  replyToContactRequest,
};

// --- Contact request management ---
async function listContactRequests(req, res) {
  try {
    const status = String(req.query.status || 'ALL').toUpperCase();
    const validStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
    const filter = validStatuses.includes(status) ? { status } : {};

    const requests = await ContactRequest.find(filter).sort({ createdAt: -1 });

    const counts = {
      ALL: await ContactRequest.countDocuments(),
      OPEN: await ContactRequest.countDocuments({ status: 'OPEN' }),
      IN_PROGRESS: await ContactRequest.countDocuments({ status: 'IN_PROGRESS' }),
      RESOLVED: await ContactRequest.countDocuments({ status: 'RESOLVED' }),
    };

    return res.json({ requests, counts });
  } catch (error) {
    console.error('[admin] List contact requests failed:', error.message);
    return res.status(500).json({ error: 'Unable to fetch contact requests' });
  }
}

async function replyToContactRequest(req, res) {
  try {
    const { id } = req.params;
    const { adminReply, status } = req.body;

    if (typeof adminReply !== 'string' || adminReply.trim().length === 0) {
      return res.status(400).json({ error: 'Admin reply is required' });
    }
    if (adminReply.length > 5000) {
      return res.status(400).json({ error: 'Reply must be 5000 characters or less' });
    }

    const validStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
    const newStatus = validStatuses.includes(status) ? status : 'IN_PROGRESS';

    const request = await ContactRequest.findByIdAndUpdate(
      id,
      {
        adminReply: adminReply.trim(),
        status: newStatus,
        repliedBy: req.user._id,
        repliedAt: new Date(),
      },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ error: 'Contact request not found' });
    }

    return res.json({ message: 'Reply sent', request });
  } catch (error) {
    console.error('[admin] Reply to contact request failed:', error.message);
    return res.status(500).json({ error: 'Unable to send reply' });
  }
}

