const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE, files: 1 },
  fileFilter(req, file, callback) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      const error = new Error('Upload a PNG, JPEG, or WebP image');
      error.statusCode = 400;
      return callback(error);
    }
    return callback(null, true);
  },
});

function uploadSingle(fieldName) {
  return (req, res, next) => {
    memoryUpload.single(fieldName)(req, res, (error) => {
      if (!error) return next();
      const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.statusCode || 400;
      return res.status(statusCode).json({ error: error.message || 'Invalid image upload' });
    });
  };
}

function detectImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return { extension: 'png', mimeType: 'image/png' };
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  ) return { extension: 'jpg', mimeType: 'image/jpeg' };
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return { extension: 'webp', mimeType: 'image/webp' };
  return null;
}

function validateImageFile(file) {
  if (!file?.buffer || !file.size) {
    const error = new Error('An image file is required');
    error.statusCode = 400;
    throw error;
  }
  if (file.size > MAX_IMAGE_SIZE) {
    const error = new Error('Image must be 5 MB or smaller');
    error.statusCode = 413;
    throw error;
  }
  const detected = detectImageFormat(file.buffer);
  if (!detected || detected.mimeType !== file.mimetype) {
    const error = new Error('Image content does not match an allowed image type');
    error.statusCode = 400;
    throw error;
  }
  return detected;
}

async function storeImage(file, directoryName) {
  const detected = validateImageFile(file);
  const storageDirectory = path.resolve(__dirname, '../../uploads', directoryName);
  await fs.mkdir(storageDirectory, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${detected.extension}`;
  const filePath = path.join(storageDirectory, fileName);
  await fs.writeFile(filePath, file.buffer, { flag: 'wx', mode: 0o640 });
  return { fileName, filePath, mimeType: detected.mimeType };
}

async function deleteStoredImage(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

module.exports = {
  MAX_IMAGE_SIZE,
  detectImageFormat,
  uploadSingle,
  validateImageFile,
  storeImage,
  deleteStoredImage,
};