const bcrypt = require('bcryptjs');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const ContactRequest = require('../models/ContactRequest');

const BCRYPT_ROUNDS = 12;

async function getProfile(req, res) {
  const {
    passwordHash,
    otpCodeHash,
    otpAttempts,
    otpSentAt,
    otpWindowStartedAt,
    otpSendCount,
    ...safeUser
  } = req.user.toObject();
  return res.json({ user: safeUser });
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }
    if (Buffer.byteLength(newPassword, 'utf8') > 72 || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and no more than 72 bytes' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from the current password' });
    }

    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await user.save();
    await RefreshToken.updateMany(
      { userId: user._id, role: 'user', revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    return res.json({ message: 'Password updated' });
  } catch (error) {
    console.error('[user] Change password failed:', error.message);
    return res.status(500).json({ error: 'Unable to change password' });
  }
}

function maskTail(value, visible = 4) {
  const text = String(value || '');
  return text.length <= visible ? text : `${'•'.repeat(text.length - visible)}${text.slice(-visible)}`;
}

function toPublicPayout(user) {
  if (!user.payoutMethod || !user.payoutDetails) return { payoutMethod: null, payoutDetails: null };
  const details = user.payoutDetails;
  return {
    payoutMethod: user.payoutMethod,
    payoutDetails:
      user.payoutMethod === 'BANK'
        ? { ...details, accountNumber: maskTail(details.accountNumber) }
        : details,
  };
}

function cleanField(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max + 1) : '';
}

async function getPayoutDetails(req, res) {
  const user = await User.findById(req.user._id).select('+payoutDetails');
  return res.json(toPublicPayout(user));
}

async function updatePayoutDetails(req, res) {
  try {
    const { payoutMethod } = req.body;
    const input = req.body.payoutDetails || {};
    let details;

    if (payoutMethod === 'UPI') {
      details = { name: cleanField(input.name, 120), upiId: cleanField(input.upiId, 120) };
      if (!/^[\w.\-]{2,}@[a-zA-Z][\w.\-]{1,}$/.test(details.upiId)) {
        return res.status(400).json({ error: 'Enter a valid UPI ID, for example name@bank' });
      }
    } else if (payoutMethod === 'BANK') {
      details = {
        accountHolderName: cleanField(input.accountHolderName, 120),
        bankName: cleanField(input.bankName, 120),
        accountNumber: cleanField(input.accountNumber, 34).replace(/\s+/g, ''),
        routingCode: cleanField(input.routingCode, 20).toUpperCase(),
      };
      if (!/^[A-Za-z0-9]{6,34}$/.test(details.accountNumber)) {
        return res.status(400).json({ error: 'Enter a valid account number' });
      }
    } else {
      return res.status(400).json({ error: 'payoutMethod must be UPI or BANK' });
    }

    if (Object.values(details).some((value) => !value || value.length > 120)) {
      return res.status(400).json({ error: 'Complete all payout details' });
    }
    if (payoutMethod === 'BANK' && details.routingCode.length > 20) {
      return res.status(400).json({ error: 'Routing code is too long' });
    }

    const user = await User.findById(req.user._id).select('+payoutDetails');
    user.payoutMethod = payoutMethod;
    user.payoutDetails = details;
    await user.save();
    return res.json({ message: 'Payout details saved', ...toPublicPayout(user) });
  } catch (error) {
    console.error('[user] Update payout details failed:', error.message);
    return res.status(500).json({ error: 'Unable to save payout details' });
  }
}

module.exports = { getProfile, changePassword, getPayoutDetails, updatePayoutDetails, submitContactRequest, getUserContactRequests };

async function submitContactRequest(req, res) {
  try {
    const { subject, message, category } = req.body;
    
    if (typeof subject !== 'string' || subject.trim().length === 0) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if (typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (subject.length > 200) {
      return res.status(400).json({ error: 'Subject must be 200 characters or less' });
    }
    if (message.length > 5000) {
      return res.status(400).json({ error: 'Message must be 5000 characters or less' });
    }

    const validCategories = ['ACCOUNT', 'WALLET', 'REFERRAL', 'VIDEO', 'WITHDRAWAL', 'OTHER'];
    const selectedCategory = validCategories.includes(category) ? category : 'OTHER';

    const contactRequest = new ContactRequest({
      userId: req.user._id,
      userEmail: req.user.email,
      userMobile: req.user.mobileNumber,
      subject: subject.trim(),
      message: message.trim(),
      category: selectedCategory,
    });

    await contactRequest.save();
    return res.status(201).json({ message: 'Contact request submitted', contactRequest });
  } catch (error) {
    console.error('[user] Submit contact request failed:', error.message);
    return res.status(500).json({ error: 'Unable to submit contact request' });
  }
}

async function getUserContactRequests(req, res) {
  try {
    const requests = await ContactRequest.find({ userId: req.user._id })
      .sort({ createdAt: -1 });

    return res.json({ requests });
  } catch (error) {
    console.error('[user] Get contact requests failed:', error.message);
    return res.status(500).json({ error: 'Unable to fetch contact requests' });
  }
}

