const mongoose = require('mongoose');

const videoWatchLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sourceType: { type: String, enum: ['ad_network', 'sponsored'], required: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    businessDate: { type: String, required: true },
    watchedAt: { type: Date, default: Date.now },
    isCompleted: { type: Boolean, default: false },
    rewardCredited: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Fast lookups for "how many rewarded videos has this user completed today"
videoWatchLogSchema.index({ userId: 1, watchedAt: 1 });
videoWatchLogSchema.index(
  { userId: 1, sourceType: 1, sourceId: 1, businessDate: 1 },
  { unique: true, partialFilterExpression: { businessDate: { $type: 'string' } } }
);

module.exports = mongoose.model('VideoWatchLog', videoWatchLogSchema);
