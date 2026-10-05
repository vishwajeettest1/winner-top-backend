const mongoose = require('mongoose');

const contactRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userEmail: { type: String, required: true },
    userMobile: { type: String, required: true },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    category: { type: String, enum: ['ACCOUNT', 'WALLET', 'REFERRAL', 'VIDEO', 'WITHDRAWAL', 'OTHER'], default: 'OTHER' },
    status: { type: String, enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'], default: 'OPEN' },
    adminReply: { type: String, default: null },
    repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    repliedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ContactRequest', contactRequestSchema);

