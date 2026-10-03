const mongoose = require('mongoose');
const DepositOption = require('../models/DepositOption');
const { storeImage, deleteStoredImage } = require('../utils/imageUploads');

const MAX_DEPOSIT_OPTIONS = 10;

function publicApiBaseUrl() {
  return (process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');
}

function isValidUpiId(value) {
  return /^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,64}$/.test(value);
}

async function getActiveDepositOption(req, res) {
  try {
    const option = await DepositOption.findOne({ isActive: true })
      .select('displayName upiId qrCodeUrl')
      .lean();
    if (!option) return res.json({ option: null });

    return res.json({
      option: {
        id: String(option._id),
        displayName: option.displayName,
        upiId: option.upiId,
        qrCodeUrl: option.qrCodeUrl,
      },
    });
  } catch (error) {
    console.error('[deposit] Active option lookup failed:', error.message);
    return res.status(500).json({ error: 'Unable to load UPI deposit option' });
  }
}

async function listDepositOptions(req, res) {
  try {
    const options = await DepositOption.find()
      .select('displayName upiId qrCodeUrl isActive createdAt')
      .sort({ isActive: -1, createdAt: -1 })
      .lean();
    return res.json({ options });
  } catch (error) {
    console.error('[deposit] Option listing failed:', error.message);
    return res.status(500).json({ error: 'Unable to load deposit options' });
  }
}

async function createDepositOption(req, res) {
  let storedImage;
  try {
    const displayName = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : '';
    const upiId = typeof req.body.upiId === 'string' ? req.body.upiId.trim() : '';
    if (!displayName || displayName.length > 60) {
      return res.status(400).json({ error: 'displayName is required and must be at most 60 characters' });
    }
    if (!isValidUpiId(upiId)) {
      return res.status(400).json({ error: 'Enter a valid UPI ID' });
    }
    if (!req.file) return res.status(400).json({ error: 'QR code image is required' });

    const optionCount = await DepositOption.countDocuments();
    if (optionCount >= MAX_DEPOSIT_OPTIONS) {
      return res.status(409).json({ error: `A maximum of ${MAX_DEPOSIT_OPTIONS} deposit options is allowed` });
    }

    storedImage = await storeImage(req.file, 'deposit-qr');
    const option = await DepositOption.create({
      displayName,
      upiId,
      qrCodeUrl: `${publicApiBaseUrl()}/uploads/deposit-qr/${storedImage.fileName}`,
      qrFilePath: storedImage.filePath,
      isActive: false,
      createdBy: req.user._id,
    });

    return res.status(201).json({
      option: {
        id: String(option._id),
        displayName: option.displayName,
        upiId: option.upiId,
        qrCodeUrl: option.qrCodeUrl,
        isActive: option.isActive,
        createdAt: option.createdAt,
      },
    });
  } catch (error) {
    if (storedImage) await deleteStoredImage(storedImage.filePath).catch(() => {});
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    if (error.code === 11000) return res.status(409).json({ error: 'A deposit option is already active' });
    if (error instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({ error: 'Invalid deposit option details' });
    }
    console.error('[deposit] Option creation failed:', error.message);
    return res.status(500).json({ error: 'Unable to save deposit option' });
  }
}

async function setActiveDepositOption(req, res) {
  const { id } = req.params;
  const { isActive } = req.body;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid deposit option ID' });
  if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be a boolean' });

  try {
    const selectedOption = await DepositOption.findById(id);
    if (!selectedOption) return res.status(404).json({ error: 'Deposit option not found' });

    if (!isActive) {
      selectedOption.isActive = false;
      await selectedOption.save();
    } else {
      await DepositOption.updateMany(
        { isActive: true, _id: { $ne: selectedOption._id } },
        { $set: { isActive: false } }
      );
      selectedOption.isActive = true;
      await selectedOption.save();
    }

    return res.json({
      option: {
        id: String(selectedOption._id),
        displayName: selectedOption.displayName,
        upiId: selectedOption.upiId,
        qrCodeUrl: selectedOption.qrCodeUrl,
        isActive: selectedOption.isActive,
      },
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    if (error.code === 11000) return res.status(409).json({ error: 'Another deposit option became active; retry the selection' });
    console.error('[deposit] Option activation failed:', error.message);
    return res.status(500).json({ error: 'Unable to update active deposit option' });
  }
}

module.exports = {
  getActiveDepositOption,
  listDepositOptions,
  createDepositOption,
  setActiveDepositOption,
};