const mongoose = require('mongoose');

const paymentProofSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    depositOptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'DepositOption', required: true, immutable: true },
    purpose: { type: String, enum: ['WALLET_TOPUP', 'STARTER_PLAN'], required: true, immutable: true },
    amountUsd: { type: Number, required: true, min: 25, immutable: true },
    utrNumber: { type: String, required: true, trim: true, uppercase: true, minlength: 6, maxlength: 50, immutable: true },
    screenshotPath: { type: String, required: true, select: false, immutable: true },
    screenshotMimeType: { type: String, required: true, select: false, immutable: true },
    status: {
      type: String,
      enum: ['PENDING_REVIEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING_REVIEW',
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null, maxlength: 300 },
  },
  { timestamps: true }
);

paymentProofSchema.index({ utrNumber: 1 }, { unique: true });
paymentProofSchema.index({ status: 1, createdAt: -1 });
paymentProofSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('PaymentProof', paymentProofSchema);