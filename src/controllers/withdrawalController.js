const Wallet = require('../models/Wallet');
const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');

const MIN_WITHDRAWAL = parseFloat(process.env.MIN_WITHDRAWAL_AMOUNT || '50');
const WITHDRAWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function requestWithdrawal(req, res) {
  try {
    const userId = req.user._id;
    const amount = Number(req.body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'A valid positive amount is required' });
    }
    if (amount < MIN_WITHDRAWAL) {
      return res.status(400).json({ error: `Minimum withdrawal amount is ${MIN_WITHDRAWAL}` });
    }

    const user = await User.findById(userId).select('+payoutDetails');
    if (!user?.payoutMethod || !user.payoutDetails) {
      return res.status(400).json({ error: 'Add your payout details in Manage Payments before withdrawing' });
    }

    const wallet = await Wallet.findOne({ userId });
    const available = (wallet?.totalBalance || 0) - (wallet?.pendingWithdrawal || 0);
    if (available < MIN_WITHDRAWAL) {
      return res.status(400).json({ error: `Available balance must reach ${MIN_WITHDRAWAL} USD first` });
    }

    if (!wallet.withdrawalWindowStartedAt || !wallet.withdrawalRequestDeadlineAt) {
      const now = new Date();
      wallet.withdrawalWindowStartedAt = now;
      wallet.withdrawalRequestDeadlineAt = new Date(now.getTime() + WITHDRAWAL_WINDOW_MS);
      await wallet.save();
    }

    const now = new Date();
    if (now >= wallet.withdrawalRequestDeadlineAt) {
      return res.status(403).json({
        error: 'The seven-day withdrawal request window has expired',
        withdrawalRequestDeadlineAt: wallet.withdrawalRequestDeadlineAt,
      });
    }

    if (amount < MIN_WITHDRAWAL) {
      return res.status(400).json({ error: `Minimum withdrawal amount is ${MIN_WITHDRAWAL} USD` });
    }
    if (amount > available) {
      return res.status(400).json({ error: 'Amount exceeds available balance' });
    }

    const withdrawal = await Withdrawal.create({
      userId,
      amount,
      currency: 'USD',
      status: 'PENDING',
      payoutMethod: user.payoutMethod,
      payoutDetails: user.payoutDetails,
    });
    await Wallet.updateOne({ userId }, { $inc: { pendingWithdrawal: amount } });

    return res.status(201).json({
      message: 'Withdrawal requested',
      withdrawal: { ...withdrawal.toObject(), payoutDetails: undefined },
      withdrawalWindow: {
        startedAt: wallet.withdrawalWindowStartedAt,
        requestDeadlineAt: wallet.withdrawalRequestDeadlineAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getWithdrawalHistory(req, res) {
  try {
    const withdrawals = await Withdrawal.find({ userId: req.user._id })
      .select('-payoutDetails')
      .sort({ requestedAt: -1 });
    return res.json({ withdrawals });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { requestWithdrawal, getWithdrawalHistory };
