const mongoose = require('mongoose');
const path = require('node:path');
const DepositOption = require('../models/DepositOption');
const PaymentProof = require('../models/PaymentProof');
const User = require('../models/User');
const { creditWallet } = require('../utils/walletCredits');
const { storeImage, deleteStoredImage } = require('../utils/imageUploads');

const STARTER_AMOUNT_USD = 25;
const MIN_DEPOSIT_AMOUNT_USD = 25;

async function submitProof(req, res) {
  let storedImage;
  try {
    const depositOptionId = req.body.depositOptionId;
    const utrNumber = typeof req.body.utrNumber === 'string' ? req.body.utrNumber.trim().toUpperCase() : '';
    const amountUsd = Number(req.body.amount);
    const purpose = req.body.purpose || 'WALLET_TOPUP';

    if (!mongoose.isValidObjectId(depositOptionId)) {
      return res.status(400).json({ error: 'A valid deposit option is required' });
    }
    if (!Number.isFinite(amountUsd) || amountUsd < MIN_DEPOSIT_AMOUNT_USD || amountUsd > 1000000) {
      return res.status(400).json({ error: `amount must be between ${MIN_DEPOSIT_AMOUNT_USD} and 1000000 USD` });
    }
    if (!/^[A-Z0-9-]{6,50}$/.test(utrNumber)) {
      return res.status(400).json({ error: 'Enter a valid UTR or transaction reference' });
    }
    if (!['WALLET_TOPUP', 'STARTER_PLAN'].includes(purpose)) {
      return res.status(400).json({ error: 'purpose must be WALLET_TOPUP or STARTER_PLAN' });
    }
    if (purpose === 'STARTER_PLAN' && amountUsd !== STARTER_AMOUNT_USD) {
      return res.status(400).json({ error: `Starter plan payment must be exactly ${STARTER_AMOUNT_USD} USD` });
    }
    if (!req.file) return res.status(400).json({ error: 'Payment screenshot is required' });

    const option = await DepositOption.findOne({ _id: depositOptionId, isActive: true }).select('_id');
    if (!option) return res.status(409).json({ error: 'The selected UPI option is no longer active' });
    if (purpose === 'STARTER_PLAN' && req.user.starterPlanActive) {
      return res.status(409).json({ error: 'Starter plan is already active' });
    }

    storedImage = await storeImage(req.file, 'payment-proofs');
    const proof = await PaymentProof.create({
      userId: req.user._id,
      depositOptionId: option._id,
      purpose,
      amountUsd: Number(amountUsd.toFixed(2)),
      utrNumber,
      screenshotPath: storedImage.filePath,
      screenshotMimeType: storedImage.mimeType,
      status: 'PENDING_REVIEW',
    });

    return res.status(201).json({
      payment: {
        id: String(proof._id),
        amount: proof.amountUsd,
        utrNumber: proof.utrNumber,
        status: proof.status,
        createdAt: proof.createdAt,
      },
    });
  } catch (error) {
    if (storedImage) await deleteStoredImage(storedImage.filePath).catch(() => {});
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    if (error.code === 11000) return res.status(409).json({ error: 'This UTR has already been submitted' });
    console.error('[payment-proof] Submission failed:', error.message);
    return res.status(500).json({ error: 'Unable to submit payment proof' });
  }
}

async function listPaymentProofs(req, res) {
  const status = req.query.status || 'PENDING_REVIEW';
  if (!['ALL', 'PENDING_REVIEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid payment proof status' });
  }
  try {
    const filter = status === 'ALL' ? {} : { status };
    const proofs = await PaymentProof.find(filter)
      .populate('userId', 'email mobileNumber')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({
      payments: proofs.map((proof) => ({
        id: String(proof._id),
        user: { email: proof.userId?.email || '', mobileNumber: proof.userId?.mobileNumber || '' },
        amount: proof.amountUsd,
        utrNumber: proof.utrNumber,
        status: proof.status,
        purpose: proof.purpose,
        createdAt: proof.createdAt,
        rejectionReason: proof.rejectionReason,
      })),
    });
  } catch (error) {
    console.error('[payment-proof] Listing failed:', error.message);
    return res.status(500).json({ error: 'Unable to load payment proofs' });
  }
}

async function getPaymentProofScreenshot(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid payment proof ID' });
  try {
    const proof = await PaymentProof.findById(req.params.id).select('+screenshotPath +screenshotMimeType');
    if (!proof) return res.status(404).json({ error: 'Payment proof not found' });
    res.set('Cache-Control', 'private, no-store');
    res.type(proof.screenshotMimeType);
    return res.sendFile(path.resolve(proof.screenshotPath), (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: 'Payment screenshot not found' });
    });
  } catch (error) {
    console.error('[payment-proof] Screenshot request failed:', error.message);
    return res.status(500).json({ error: 'Unable to load payment screenshot' });
  }
}

async function reviewPaymentProof(req, res) {
  const { id } = req.params;
  const { action } = req.body;
  const rejectionReason = typeof req.body.rejectionReason === 'string'
    ? req.body.rejectionReason.trim().slice(0, 300)
    : '';
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid payment proof ID' });
  if (!['APPROVE', 'REVIEW', 'CANCEL', 'REJECT'].includes(action)) {
    return res.status(400).json({ error: 'action must be APPROVE, REVIEW, or CANCEL' });
  }

  const session = await mongoose.startSession();
  let reviewedProof;
  try {
    await session.withTransaction(async () => {
      const proof = await PaymentProof.findById(id).session(session);
      if (!proof) {
        const error = new Error('Payment proof not found');
        error.statusCode = 404;
        throw error;
      }
      if (!['PENDING_REVIEW', 'UNDER_REVIEW'].includes(proof.status)) {
        const error = new Error('Payment proof has already been reviewed');
        error.statusCode = 409;
        throw error;
      }

      if (action === 'APPROVE') {
        const user = await User.findById(proof.userId).session(session);
        if (!user) throw new Error('Payment user not found');
        if (proof.purpose === 'STARTER_PLAN' && user.starterPlanActive) {
          const error = new Error('Starter plan is already active; reject this duplicate proof');
          error.statusCode = 409;
          throw error;
        }
        await creditWallet(
          session,
          proof.userId,
          proof.amountUsd,
          'deposits',
          `upi-proof:${proof._id}`,
        );
        if (proof.purpose === 'STARTER_PLAN') {
          user.starterPlanActive = true;
          user.starterActivatedAt = new Date();
          await user.save({ session });
        }
        proof.status = 'APPROVED';
        proof.rejectionReason = null;
      } else if (action === 'REVIEW') {
        proof.status = 'UNDER_REVIEW';
      } else {
        proof.status = action === 'CANCEL' ? 'CANCELLED' : 'REJECTED';
        proof.rejectionReason = rejectionReason || (action === 'CANCEL' ? 'Cancelled by administrator' : 'Not verified');
      }

      proof.reviewedBy = req.user._id;
      proof.reviewedAt = new Date();
      await proof.save({ session });
      reviewedProof = proof;
    });

    return res.json({
      payment: {
        id: String(reviewedProof._id),
        status: reviewedProof.status,
        reviewedAt: reviewedProof.reviewedAt,
      },
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    if (error.code === 11000) return res.status(409).json({ error: 'Payment was already credited' });
    console.error('[payment-proof] Review failed:', error.message);
    return res.status(500).json({ error: 'Unable to review payment proof' });
  } finally {
    await session.endSession();
  }
}

module.exports = {
  submitProof,
  listPaymentProofs,
  getPaymentProofScreenshot,
  reviewPaymentProof,
};