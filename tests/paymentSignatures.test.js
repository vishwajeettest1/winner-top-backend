const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  verifyCheckoutSignature,
  verifyWebhookSignature,
} = require('../src/utils/paymentSignatures');

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

test('accepts a valid checkout signature', () => {
  const secret = 'razorpay-test-secret';
  const signature = sign('order_test_123|pay_test_456', secret);

  assert.equal(verifyCheckoutSignature('order_test_123', 'pay_test_456', signature, secret), true);
});

test('rejects altered checkout values and malformed signatures', () => {
  const secret = 'razorpay-test-secret';
  const signature = sign('order_test_123|pay_test_456', secret);

  assert.equal(verifyCheckoutSignature('order_other', 'pay_test_456', signature, secret), false);
  assert.equal(verifyCheckoutSignature('order_test_123', 'pay_test_456', 'not-a-signature', secret), false);
});

test('verifies the exact webhook raw bytes and rejects a modified body', () => {
  const secret = 'razorpay-webhook-secret';
  const rawBody = Buffer.from('{"event":"payment.captured"}');
  const signature = sign(rawBody, secret);

  assert.equal(verifyWebhookSignature(rawBody, signature, secret), true);
  assert.equal(verifyWebhookSignature(Buffer.from('{"event":"payment.failed"}'), signature, secret), false);
  assert.equal(verifyWebhookSignature('{"event":"payment.captured"}', signature, secret), false);
});