const mongoose = require('mongoose');

const paymentWebhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, immutable: true },
    eventName: { type: String, required: true, immutable: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null, immutable: true },
    providerPaymentId: { type: String, default: null, immutable: true },
    receivedAt: { type: Date, default: Date.now, immutable: true },
  },
  { timestamps: false }
);

paymentWebhookEventSchema.index({ eventId: 1 }, { unique: true });

module.exports = mongoose.model('PaymentWebhookEvent', paymentWebhookEventSchema);