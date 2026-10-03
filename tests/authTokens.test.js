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

test('legacy JWT_SECRET derives separate user and admin signing keys', () => {
  const userSecret = process.env.JWT_USER_SECRET;
  const adminSecret = process.env.JWT_ADMIN_SECRET;
  process.env.JWT_SECRET = 'legacy-master-secret-for-migration-123456';
  delete process.env.JWT_USER_SECRET;
  delete process.env.JWT_ADMIN_SECRET;

  const userToken = signAccessToken({ _id: 'user-legacy' }, 'user');
  const adminToken = signAccessToken({ _id: 'admin-legacy' }, 'admin');
  assert.equal(verifyAccessToken(userToken, 'user').userId, 'user-legacy');
  assert.equal(verifyAccessToken(adminToken, 'admin').userId, 'admin-legacy');
  assert.throws(() => verifyAccessToken(userToken, 'admin'));
  assert.throws(() => verifyAccessToken(adminToken, 'user'));

  process.env.JWT_USER_SECRET = userSecret;
  process.env.JWT_ADMIN_SECRET = adminSecret;
  delete process.env.JWT_SECRET;
});