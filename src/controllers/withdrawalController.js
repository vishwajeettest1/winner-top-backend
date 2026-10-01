const Wallet = require('../models/Wallet');
const Withdrawal = require('../models/Withdrawal');

const MIN_WITHDRAWAL = parseFloat(process.env.MIN_WITHDRAWAL_AMOUNT || '10');

async function requestWithdrawal(req, res) {
  try {
    const userId = req.user._id;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'A positive amount is required' });
    }
    if (amount < MIN_WITHDRAWAL) {
      return res.status(400).json({ error: `Minimum withdrawal amount is ${MIN_WITHDRAWAL}` });
    }

    const wallet = await Wallet.findOne({ userId });
    const available = (wallet?.totalBalance || 0) - (wallet?.pendingWithdrawal || 0);
    if (amount > available) {
      return res.status(400).json({ error: 'Amount exceeds available balance' });
    }

    const withdrawal = await Withdrawal.create({ userId, amount, status: 'PENDING' });
    await Wallet.updateOne({ userId }, { $inc: { pendingWithdrawal: amount } });

    return res.status(201).json({ message: 'Withdrawal requested', withdrawal });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getWithdrawalHistory(req, res) {
  try {
    const withdrawals = await Withdrawal.find({ userId: req.user._id }).sort({ requestedAt: -1 });
    return res.json({ withdrawals });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { requestWithdrawal, getWithdrawalHistory };
