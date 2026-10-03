const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const VideoWatchLog = require('../models/VideoWatchLog');
const Withdrawal = require('../models/Withdrawal');
const PaymentProof = require('../models/PaymentProof');

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
    const [watchLogs, withdrawals, ledgerEntries, pendingProofs] = await Promise.all([
      VideoWatchLog.find({ userId: req.user._id, isCompleted: true }).sort({ watchedAt: -1 }).limit(100),
      Withdrawal.find({ userId: req.user._id }).sort({ requestedAt: -1 }).limit(50),
      WalletTransaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100),
      PaymentProof.find({
        userId: req.user._id,
        status: { $in: ['PENDING_REVIEW', 'UNDER_REVIEW', 'REJECTED', 'CANCELLED'] },
      }).sort({ createdAt: -1 }).limit(50),
    ]);
    const deposits = [
      ...pendingProofs.map((proof) => ({
        id: String(proof._id),
        amount: proof.amountUsd,
        status: proof.status,
        utrNumber: proof.utrNumber,
        createdAt: proof.createdAt,
      })),
      ...ledgerEntries
        .filter((entry) => entry.type === 'PAYMENT')
        .map((entry) => ({
          id: String(entry._id),
          amount: entry.amount,
          status: 'APPROVED',
          createdAt: entry.createdAt,
          direction: entry.direction,
        })),
    ].sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
    return res.json({ deposits, videoRewards: watchLogs, withdrawals, ledgerEntries });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { getBalance, getTransactions };
