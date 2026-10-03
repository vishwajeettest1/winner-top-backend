const test = require('node:test');
const assert = require('node:assert/strict');
const { detectImageFormat, validateImageFile } = require('../src/utils/imageUploads');

test('detects PNG, JPEG, and WebP from file signatures', () => {
  assert.equal(detectImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])).mimeType, 'image/png');
  assert.equal(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0x00])).mimeType, 'image/jpeg');
  assert.equal(detectImageFormat(Buffer.from('RIFF0000WEBP')).mimeType, 'image/webp');
});

test('rejects unsupported or mismatched image contents', () => {
  assert.equal(detectImageFormat(Buffer.from('not an image')), null);
  assert.throws(
    () => validateImageFile({ buffer: Buffer.from([0xff, 0xd8, 0xff]), size: 3, mimetype: 'image/png' }),
    /does not match/,
  );
});