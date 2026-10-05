const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    mobileNumber: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    profileImageUrl: { type: String, default: null },

    isVerified: { type: Boolean, default: false },
    otpCodeHash: { type: String, default: null, select: false },
    otpExpiresAt: { type: Date, default: null },
    otpAttempts: { type: Number, default: 0 },
    otpSentAt: { type: Date, default: null },
    otpWindowStartedAt: { type: Date, default: null },
    otpSendCount: { type: Number, default: 0 },
    otpChannel: { type: String, enum: ['email', 'sms'], default: 'email' },
    starterPlanActive: { type: Boolean, default: false },
    starterActivatedAt: { type: Date, default: null },

    referralCode: { type: String, required: true, unique: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    payoutMethod: { type: String, enum: ['UPI', 'BANK'], default: null },
    payoutDetails: { type: mongoose.Schema.Types.Mixed, default: null, select: false },

    status: { type: String, enum: ['ACTIVE', 'BLOCKED'], default: 'ACTIVE' },

    role: { type: String, enum: ['user', 'admin'], default: 'user' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
