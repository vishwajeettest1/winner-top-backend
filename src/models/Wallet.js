const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    totalBalance: { type: Number, default: 0 },
    videoEarnings: { type: Number, default: 0 },
    referralEarnings: { type: Number, default: 0 },
    pendingWithdrawal: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Wallet', walletSchema);
