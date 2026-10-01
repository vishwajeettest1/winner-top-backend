const Wallet = require('../models/Wallet');
const VideoWatchLog = require('../models/VideoWatchLog');
const Withdrawal = require('../models/Withdrawal');

async function getBalance(req, res) {
  try {
    const wallet = await Wallet.findOne({ userId: req.user._id });
    return res.json({ wallet: wallet || { totalBalance: 0, videoEarnings: 0, referralEarnings: 0 } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getTransactions(req, res) {
  try {
    const [watchLogs, withdrawals] = await Promise.all([
      VideoWatchLog.find({ userId: req.user._id, isCompleted: true }).sort({ watchedAt: -1 }).limit(100),
      Withdrawal.find({ userId: req.user._id }).sort({ requestedAt: -1 }).limit(50),
    ]);
    return res.json({ videoRewards: watchLogs, withdrawals });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { getBalance, getTransactions };
