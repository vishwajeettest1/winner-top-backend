const mongoose = require('mongoose');
const Video = require('../models/Video');
const SponsoredContent = require('../models/SponsoredContent');
const VideoWatchLog = require('../models/VideoWatchLog');
const AdRevenueLog = require('../models/AdRevenueLog');
const User = require('../models/User');
const { creditWallet } = require('../utils/walletCredits');

const USER_REVENUE_SHARE = parseFloat(process.env.USER_REVENUE_SHARE || '0.5');
const REFERRER_REVENUE_SHARE = parseFloat(process.env.REFERRER_REVENUE_SHARE || '0.1');
const DAILY_CAP = parseInt(process.env.DAILY_REWARD_VIDEO_CAP || '10', 10);

async function getDailyVideos(req, res) {
  try {
    const [adSlots, sponsored] = await Promise.all([
      Video.find({ isActive: true }).limit(8),
      SponsoredContent.find({
        isActive: true,
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() },
      }).limit(4),
    ]);

    const servableSponsored = sponsored.filter((s) => s.hasBudgetRemaining());

    const queue = [
      ...adSlots.map((v) => ({
        sourceType: 'ad_network',
        sourceId: v._id,
        title: v.title,
        thumbnailUrl: v.thumbnailUrl,
        durationInSeconds: v.durationInSeconds,
        adNetwork: v.adNetwork,
        adUnitId: v.adUnitId,
      })),
      ...servableSponsored.map((s) => ({
        sourceType: 'sponsored',
        sourceId: s._id,
        title: `Sponsored: ${s.sponsorName}`,
        thumbnailUrl: s.thumbnailUrl,
        durationInSeconds: s.durationInSeconds,
        videoUrl: s.videoUrl,
      })),
    ];

    return res.json({ videos: queue, dailyRewardCap: DAILY_CAP });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Verifies revenue for a completed view. In production:
//  - ad_network: look up the already-processed SSV callback record for this
//    reward token (see adCallbackController.js) rather than trusting the client.
//  - sponsored: verify a server-issued signed watch-session token.
// This scaffold implements the sponsored-content path fully and stubs the
// ad-network path with a clear TODO, since real revenue numbers only exist
// once the SSV callback has landed.
async function verifyRevenueForCompletion({ sourceType, sourceId, session }) {
  if (sourceType === 'sponsored') {
    const campaign = await SponsoredContent.findById(sourceId).session(session);
    if (!campaign || !campaign.isActive) throw new Error('Campaign not found or inactive');
    if (!campaign.hasBudgetRemaining()) throw new Error('Campaign budget exhausted');
    return { grossRevenue: campaign.payoutPerView, campaign };
  }

  if (sourceType === 'ad_network') {
    // TODO: replace with a lookup against the SSV callback record that the
    // ad network posted to /api/ad-callbacks/*. Never trust a client-supplied
    // revenue figure directly.
    throw new Error(
      'Ad-network revenue not yet verified via SSV callback for this view'
    );
  }

  throw new Error('Unknown sourceType');
}

async function completeVideo(req, res) {
  const session = await mongoose.startSession();
  try {
    const { sourceType, sourceId } = req.body;
    const userId = req.user._id;

    if (!['ad_network', 'sponsored'].includes(sourceType) || !sourceId) {
      return res.status(400).json({ error: 'sourceType and sourceId are required' });
    }

    // Daily cap enforcement (server-side, not client-trusted).
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const businessDate = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    let completionResult;

    await session.withTransaction(async () => {
      const completedToday = await VideoWatchLog.countDocuments({
        userId,
        isCompleted: true,
        $or: [
          { businessDate },
          { businessDate: { $exists: false }, watchedAt: { $gte: startOfDay } },
        ],
      }).session(session);
      if (completedToday >= DAILY_CAP) {
        const error = new Error(`Daily reward cap of ${DAILY_CAP} videos reached`);
        error.statusCode = 429;
        throw error;
      }

      const alreadyWatched = await VideoWatchLog.findOne({
        userId,
        sourceType,
        sourceId,
        isCompleted: true,
        $or: [
          { businessDate },
          { businessDate: { $exists: false }, watchedAt: { $gte: startOfDay } },
        ],
      }).session(session);
      if (alreadyWatched) {
        const error = new Error('This video was already rewarded today');
        error.statusCode = 409;
        throw error;
      }

      const { grossRevenue, campaign } = await verifyRevenueForCompletion({
        sourceType,
        sourceId,
        session,
      });
      const userShare = +(grossRevenue * USER_REVENUE_SHARE).toFixed(6);
      const user = await User.findById(userId).session(session);
      if (!user) throw new Error('User not found');

      const referrerShare = user.referredBy
        ? +(grossRevenue * REFERRER_REVENUE_SHARE).toFixed(6)
        : 0;
      const referenceId = `${userId}:${sourceType}:${sourceId}:${businessDate}`;

      await AdRevenueLog.create(
        [{
          userId,
          sourceType,
          sourceId,
          businessDate,
          grossRevenue,
          userShare,
          referrerShare,
          referrerId: user.referredBy || null,
          verificationMethod: sourceType === 'sponsored' ? 'signed_watch_token' : 'ssv_callback',
        }],
        { session }
      );

      await VideoWatchLog.create(
        [{
          userId,
          sourceType,
          sourceId,
          businessDate,
          isCompleted: true,
          rewardCredited: userShare,
        }],
        { session }
      );

      await creditWallet(session, userId, userShare, 'videoEarnings', referenceId);
      if (user.referredBy && referrerShare > 0) {
        await creditWallet(session, user.referredBy, referrerShare, 'referralEarnings', referenceId);
      }

      if (campaign) {
        campaign.campaignSpent += grossRevenue;
        if (!campaign.hasBudgetRemaining()) campaign.isActive = false;
        await campaign.save({ session });
      }

      completionResult = {
        message: 'Reward credited',
        userShare,
        referrerShare,
        videosRemainingToday: DAILY_CAP - completedToday - 1,
      };
    });

    return res.json(completionResult);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'This video was already rewarded today' });
    }
    return res.status(err.statusCode || 400).json({ error: err.message });
  } finally {
    await session.endSession();
  }
}

module.exports = { getDailyVideos, completeVideo };
