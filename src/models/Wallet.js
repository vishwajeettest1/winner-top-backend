const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    currency: { type: String, enum: ['USD'], default: 'USD' },
    totalBalance: { type: Number, default: 0 },
    deposits: { type: Number, default: 0 },
    videoEarnings: { type: Number, default: 0 },
    referralEarnings: { type: Number, default: 0 },
    pendingWithdrawal: { type: Number, default: 0 },
    withdrawalWindowStartedAt: { type: Date, default: null },
    withdrawalRequestDeadlineAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Wallet', walletSchema);
