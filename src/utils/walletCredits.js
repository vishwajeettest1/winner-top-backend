const WalletTransaction = require('../models/WalletTransaction');
const Wallet = require('../models/Wallet');

const MIN_WITHDRAWAL_AMOUNT = Number(process.env.MIN_WITHDRAWAL_AMOUNT || 50);
const WITHDRAWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CREDIT_TYPES = {
  videoEarnings: 'VIDEO_REWARD',
  referralEarnings: 'REFERRAL_REWARD',
  deposits: 'PAYMENT',
};

async function creditWallet(session, userId, amount, earningsField, referenceId) {
  const type = CREDIT_TYPES[earningsField];
  if (!type) {
    throw new Error('Invalid wallet earnings category');
  }
  if (!Number.isFinite(amount) || amount < 0 || !referenceId) {
    throw new Error('A valid amount and idempotency reference are required');
  }
  if (amount === 0) return false;

  const existingTransaction = await WalletTransaction.exists({ userId, type, referenceId }).session(session);
  if (existingTransaction) return false;

  await WalletTransaction.create(
    [{
      userId,
      currency: 'USD',
      type,
      direction: 'CREDIT',
      amount,
      referenceId,
    }],
    { session }
  );

  const currentBalance = { $ifNull: ['$totalBalance', 0] };
  const pendingWithdrawal = { $ifNull: ['$pendingWithdrawal', 0] };
  const nextBalance = { $add: [currentBalance, amount] };
  const currentAvailable = { $subtract: [currentBalance, pendingWithdrawal] };
  const nextAvailable = { $subtract: [nextBalance, pendingWithdrawal] };
  const hasReachedMinimum = { $gte: [nextAvailable, MIN_WITHDRAWAL_AMOUNT] };
  const windowExpired = {
    $lte: [
      { $ifNull: ['$withdrawalRequestDeadlineAt', new Date(0)] },
      '$$NOW',
    ],
  };
  const opensWindow = {
    $and: [
      hasReachedMinimum,
      {
        $or: [
          { $lt: [currentAvailable, MIN_WITHDRAWAL_AMOUNT] },
          windowExpired,
        ],
      },
    ],
  };

  await Wallet.findOneAndUpdate(
    { userId },
    [
      {
        $set: {
          totalBalance: nextBalance,
          [earningsField]: {
            $add: [{ $ifNull: [`$${earningsField}`, 0] }, amount],
          },
          currency: { $ifNull: ['$currency', 'USD'] },
          withdrawalWindowStartedAt: {
            $cond: [opensWindow, '$$NOW', { $ifNull: ['$withdrawalWindowStartedAt', null] }],
          },
          withdrawalRequestDeadlineAt: {
            $cond: [
              opensWindow,
              { $add: ['$$NOW', WITHDRAWAL_WINDOW_MS] },
              { $ifNull: ['$withdrawalRequestDeadlineAt', null] },
            ],
          },
        },
      },
    ],
    { new: true, upsert: true, session }
  );
  return true;
}

module.exports = { creditWallet };