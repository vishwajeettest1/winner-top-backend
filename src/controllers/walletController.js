const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const VideoWatchLog = require('../models/VideoWatchLog');
const Withdrawal = require('../models/Withdrawal');

async function getBalance(req, res) {
  try {
    const wallet = await Wallet.findOne({ userId: req.user._id });
    return res.json({
      wallet: wallet || {
        currency: 'USD',
        totalBalance: 0,
        deposits: 0,
        videoEarnings: 0,
        referralEarnings: 0,
        pendingWithdrawal: 0,
        withdrawalWindowStartedAt: null,
        withdrawalRequestDeadlineAt: null,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getTransactions(req, res) {
  try {
    const [watchLogs, withdrawals, ledgerEntries] = await Promise.all([
      VideoWatchLog.find({ userId: req.user._id, isCompleted: true }).sort({ watchedAt: -1 }).limit(100),
      Withdrawal.find({ userId: req.user._id }).sort({ requestedAt: -1 }).limit(50),
      WalletTransaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100),
    ]);
    return res.json({ videoRewards: watchLogs, withdrawals, ledgerEntries });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { getBalance, getTransactions };
