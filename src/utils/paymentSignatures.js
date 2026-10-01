const crypto = require('crypto');

function matchesHmacSha256(payload, signature, secret) {
  if (!payload || !secret || !/^[a-f0-9]{64}$/i.test(signature || '')) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function verifyCheckoutSignature(orderId, paymentId, signature, secret) {
  if (!orderId || !paymentId) return false;
  return matchesHmacSha256(`${orderId}|${paymentId}`, signature, secret);
}

function verifyWebhookSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return false;
  return matchesHmacSha256(rawBody, signature, secret);
}

module.exports = { verifyCheckoutSignature, verifyWebhookSignature };