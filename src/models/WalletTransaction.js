const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    currency: { type: String, enum: ['USD'], default: 'USD', immutable: true },
    type: {
      type: String,
      enum: ['VIDEO_REWARD', 'REFERRAL_REWARD', 'PAYMENT', 'WITHDRAWAL', 'ADJUSTMENT'],
      required: true,
      immutable: true,
    },
    direction: { type: String, enum: ['CREDIT', 'DEBIT'], required: true, immutable: true },
    amount: { type: Number, required: true, min: 0.000001, immutable: true },
    referenceId: { type: String, required: true, immutable: true },
    status: { type: String, enum: ['POSTED'], default: 'POSTED', immutable: true },
  },
  { timestamps: true }
);

walletTransactionSchema.index(
  { userId: 1, type: 1, referenceId: 1 },
  { unique: true }
);
walletTransactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);