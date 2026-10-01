require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const generateReferralCode = require('../src/utils/generateReferralCode');

async function createAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
  }
  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters');
  }

  await connectDB();
  const existingAdmin = await User.findOne({ email });
  if (existingAdmin) {
    throw new Error('A user with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await User.create({
    mobileNumber: `admin-${Date.now()}`,
    email,
    passwordHash,
    isVerified: true,
    referralCode: generateReferralCode(),
    role: 'admin',
  });

  console.log(`Admin created: ${admin.email}`);
}

createAdmin()
  .catch((err) => {
    console.error(`[admin] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });