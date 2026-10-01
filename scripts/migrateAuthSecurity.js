require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');

async function migrateAuthSecurity() {
  await connectDB();
  const result = await User.updateMany(
    { otpCode: { $exists: true } },
    {
      $unset: {
        otpCode: '',
        otpCodeHash: '',
        otpExpiresAt: '',
      },
      $set: {
        otpAttempts: 0,
        otpSentAt: null,
        otpWindowStartedAt: null,
        otpSendCount: 0,
      },
    }
  );
  console.log(`[auth migration] cleared legacy OTP data from ${result.modifiedCount} account(s)`);
}

migrateAuthSecurity()
  .catch((error) => {
    console.error(`[auth migration] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });