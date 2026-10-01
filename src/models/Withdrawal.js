const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['USD'], default: 'USD' },
    status: {
      type: String,
      enum: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PAID'],
      default: 'PENDING',
    },
    requestedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    transactionRef: { type: String, default: null },
    rejectionReason: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
