const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/models/User');
const RefreshToken = require('../src/models/RefreshToken');
const { normalizeMobileNumber } = require('../src/utils/otpDelivery');

test('password, OTP, and refresh-token hashes are excluded from default queries', () => {
  assert.equal(User.schema.path('passwordHash').options.select, false);
  assert.equal(User.schema.path('otpCodeHash').options.select, false);
  assert.equal(RefreshToken.schema.path('tokenHash').options.select, false);
});

test('registration phone numbers normalize to E.164 and invalid numbers are rejected', () => {
  assert.equal(normalizeMobileNumber('9876543210'), '+919876543210');
  assert.throws(() => normalizeMobileNumber('not-a-phone'), RangeError);
});