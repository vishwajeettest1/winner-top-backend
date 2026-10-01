const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_USER_SECRET = 'user-secret-for-tests-0123456789abcdef';
process.env.JWT_ADMIN_SECRET = 'admin-secret-for-tests-0123456789abcdef';

const { signAccessToken, verifyAccessToken } = require('../src/utils/jwt');

test('user and admin access tokens cannot cross audiences', () => {
  const userToken = signAccessToken({ _id: 'user-123' }, 'user');
  const adminToken = signAccessToken({ _id: 'admin-456' }, 'admin');

  assert.equal(verifyAccessToken(userToken, 'user').userId, 'user-123');
  assert.equal(verifyAccessToken(adminToken, 'admin').userId, 'admin-456');
  assert.throws(() => verifyAccessToken(userToken, 'admin'));
  assert.throws(() => verifyAccessToken(adminToken, 'user'));
});

test('JWT configuration rejects shared secrets', () => {
  const sharedSecret = 'same-secret-value-long-enough-012345';
  process.env.JWT_USER_SECRET = sharedSecret;
  process.env.JWT_ADMIN_SECRET = sharedSecret;

  assert.throws(() => signAccessToken({ _id: 'user-123' }, 'user'), /must be different/);

  process.env.JWT_USER_SECRET = 'user-secret-for-tests-0123456789abcdef';
  process.env.JWT_ADMIN_SECRET = 'admin-secret-for-tests-0123456789abcdef';
});