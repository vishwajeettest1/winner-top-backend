const User = require('../models/User');
const AdRevenueLog = require('../models/AdRevenueLog');
const Wallet = require('../models/Wallet');

async function getReferralStats(req, res) {
  try {
    const userId = req.user._id;
    const referredUsers = await User.find({ referredBy: userId }).select(
      'email mobileNumber isVerified createdAt'
    );

    const referredIds = referredUsers.map((u) => u._id);

    // "Active" = has at least one verified ad-revenue event (i.e. actually watched something)
    const activeReferralIds = new Set(
      (await AdRevenueLog.find({ userId: { $in: referredIds } }).distinct('userId')).map(String)
    );

    const wallet = await Wallet.findOne({ userId });

    return res.json({
      referralCode: req.user.referralCode,
      referralLink: `${process.env.PUBLIC_APP_URL || 'https://app.example.com'}/r/${req.user.referralCode}`,
      totalInvites: referredUsers.length,
      pendingReferrals: referredUsers.filter((u) => !activeReferralIds.has(String(u._id))).length,
      activeReferrals: referredUsers.filter((u) => activeReferralIds.has(String(u._id))).length,
      totalReferralEarnings: wallet ? wallet.referralEarnings : 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { getReferralStats };
