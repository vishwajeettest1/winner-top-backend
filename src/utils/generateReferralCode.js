const crypto = require('crypto');

function generateReferralCode(prefix = 'SE') {
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}${random}`;
}

module.exports = generateReferralCode;
