const mongoose = require('mongoose');

// Direct brand-sponsored video campaigns. These pay a fixed per-view
// amount out of a fixed campaign budget, independent of any ad network.
const sponsoredContentSchema = new mongoose.Schema(
  {
    sponsorName: { type: String, required: true },
    videoUrl: { type: String, required: true },
    thumbnailUrl: { type: String },
    durationInSeconds: { type: Number, required: true },

    campaignBudget: { type: Number, required: true, min: 0 },
    campaignSpent: { type: Number, default: 0, min: 0 },
    payoutPerView: { type: Number, required: true, min: 0 },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// A campaign is servable only while active, within its flight dates,
// and while budget remains.
sponsoredContentSchema.methods.hasBudgetRemaining = function () {
  return this.campaignSpent + this.payoutPerView <= this.campaignBudget;
};

module.exports = mongoose.model('SponsoredContent', sponsoredContentSchema);
