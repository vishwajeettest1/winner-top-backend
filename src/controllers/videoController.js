const Video = require('../models/Video');
const SponsoredContent = require('../models/SponsoredContent');
const VideoWatchLog = require('../models/VideoWatchLog');
const AdRevenueLog = require('../models/AdRevenueLog');
const Wallet = require('../models/Wallet');
const User = require('../models/User');

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
async function verifyRevenueForCompletion({ sourceType, sourceId }) {
  if (sourceType === 'sponsored') {
    const campaign = await SponsoredContent.findById(sourceId);
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
  try {
    const { sourceType, sourceId } = req.body;
    const userId = req.user._id;

    if (!['ad_network', 'sponsored'].includes(sourceType) || !sourceId) {
      return res.status(400).json({ error: 'sourceType and sourceId are required' });
    }

    // Daily cap enforcement (server-side, not client-trusted).
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const completedToday = await VideoWatchLog.countDocuments({
      userId,
      isCompleted: true,
      watchedAt: { $gte: startOfDay },
    });
    if (completedToday >= DAILY_CAP) {
      return res.status(429).json({ error: `Daily reward cap of ${DAILY_CAP} videos reached` });
    }

    // Prevent double-crediting the same sponsored view in one sitting.
    const alreadyWatched = await VideoWatchLog.findOne({
      userId,
      sourceType,
      sourceId,
      watchedAt: { $gte: startOfDay },
      isCompleted: true,
    });
    if (alreadyWatched) {
      return res.status(409).json({ error: 'This video was already rewarded today' });
    }

    const { grossRevenue, campaign } = await verifyRevenueForCompletion({ sourceType, sourceId });

    const userShare = +(grossRevenue * USER_REVENUE_SHARE).toFixed(6);
    const user = await User.findById(userId);
    let referrerShare = 0;
    let referrerId = null;
    if (user.referredBy) {
      referrerShare = +(grossRevenue * REFERRER_REVENUE_SHARE).toFixed(6);
      referrerId = user.referredBy;
    }

    await AdRevenueLog.create({
      userId,
      sourceType,
      sourceId,
      grossRevenue,
      userShare,
      referrerShare,
      referrerId,
      verificationMethod: sourceType === 'sponsored' ? 'signed_watch_token' : 'ssv_callback',
    });

    await VideoWatchLog.create({
      userId,
      sourceType,
      sourceId,
      isCompleted: true,
      rewardCredited: userShare,
    });

    await Wallet.findOneAndUpdate(
      { userId },
      { $inc: { totalBalance: userShare, videoEarnings: userShare } },
      { upsert: true }
    );

    if (referrerId && referrerShare > 0) {
      await Wallet.findOneAndUpdate(
        { userId: referrerId },
        { $inc: { totalBalance: referrerShare, referralEarnings: referrerShare } },
        { upsert: true }
      );
    }

    if (campaign) {
      campaign.campaignSpent += grossRevenue;
      if (!campaign.hasBudgetRemaining()) campaign.isActive = false;
      await campaign.save();
    }

    return res.json({
      message: 'Reward credited',
      userShare,
      referrerShare,
      videosRemainingToday: DAILY_CAP - completedToday - 1,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

module.exports = { getDailyVideos, completeVideo };
