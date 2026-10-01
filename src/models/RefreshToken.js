const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    role: { type: String, enum: ['user', 'admin'], required: true, immutable: true },
    familyId: { type: String, required: true, immutable: true },
    tokenHash: { type: String, required: true, unique: true, select: false, immutable: true },
    expiresAt: { type: Date, required: true, index: true, immutable: true },
    consumedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    replacedByHash: { type: String, default: null, select: false },
  },
  { timestamps: true }
);

refreshTokenSchema.index({ familyId: 1, revokedAt: 1 });
refreshTokenSchema.index({ userId: 1, role: 1, expiresAt: 1 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);