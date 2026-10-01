const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    product: { type: String, enum: ['STARTER_PLAN'], required: true, default: 'STARTER_PLAN' },
    amountUsd: { type: Number, required: true, immutable: true },
    amountInrPaise: { type: Number, required: true, immutable: true },
    currency: { type: String, enum: ['INR'], default: 'INR', immutable: true },
    exchangeRate: { type: Number, required: true, immutable: true },
    rateUpdatedAt: { type: String, default: null, immutable: true },
    quotedAt: { type: Date, required: true, immutable: true },
    method: { type: String, enum: ['upi', 'bank'], required: true, immutable: true },
    idempotencyKey: { type: String, required: true, immutable: true },
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    status: {
      type: String,
      enum: ['CREATING', 'CREATED', 'PAID', 'FAILED', 'EXPIRED', 'DUPLICATE_PAID'],
      default: 'CREATING',
    },
    hasOpenOrder: { type: Boolean, default: true },
    expiresAt: { type: Date, required: true },
    capturedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
  },
  { timestamps: true }
);

paymentSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ razorpayPaymentId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { hasOpenOrder: true } }
);

module.exports = mongoose.model('Payment', paymentSchema);