const mongoose = require('mongoose');

const depositOptionSchema = new mongoose.Schema(
  {
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    upiId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      match: /^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,64}$/,
    },
    qrCodeUrl: { type: String, required: true },
    qrFilePath: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: false, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

depositOptionSchema.index(
  { isActive:  1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);
depositOptionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('DepositOption', depositOptionSchema);