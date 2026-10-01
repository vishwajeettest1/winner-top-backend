const mongoose = require('mongoose');

// Represents an ad-network rewarded-video placement slot.
// Actual per-view revenue comes from the ad network's SSV callback,
// NOT from a static "rewardAmount" field here.
const videoSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    adNetwork: { type: String, enum: ['admob', 'unity_ads'], required: true },
    adUnitId: { type: String, required: true },
    thumbnailUrl: { type: String },
    durationInSeconds: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Video', videoSchema);
