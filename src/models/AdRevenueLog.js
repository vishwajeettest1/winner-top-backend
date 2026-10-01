const mongoose = require('mongoose');

// This is the SOLE source of truth for what a view actually earned.
// Every wallet credit (user or referrer) must trace back to a row here,
// and userShare + referrerShare must never exceed grossRevenue.
const adRevenueLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sourceType: { type: String, enum: ['ad_network', 'sponsored'], required: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    businessDate: { type: String, required: true },

    grossRevenue: { type: Number, required: true, min: 0 },
    userShare: { type: Number, required: true, min: 0 },
    referrerShare: { type: Number, default: 0, min: 0 },
    referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    verificationMethod: {
      type: String,
      enum: ['ssv_callback', 'signed_watch_token'],
      required: true,
    },
    verifiedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

adRevenueLogSchema.pre('validate', function (next) {
  if (this.userShare + this.referrerShare > this.grossRevenue + 1e-9) {
    return next(new Error('Payout shares cannot exceed verified gross revenue'));
  }
  next();
});

adRevenueLogSchema.index(
  { userId: 1, sourceType: 1, sourceId: 1, businessDate: 1 },
  { unique: true, partialFilterExpression: { businessDate: { $type: 'string' } } }
);

module.exports = mongoose.model('AdRevenueLog', adRevenueLogSchema);
