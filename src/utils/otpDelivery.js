const nodemailer = require('nodemailer');
const twilio = require('twilio');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

function normalizeMobileNumber(value) {
  const phone = parsePhoneNumberFromString(value, process.env.PHONE_DEFAULT_REGION || 'IN');
  if (!phone || !phone.isValid()) throw new RangeError('mobileNumber must be a valid phone number');
  return phone.number;
}

async function sendOtpEmail(email, code) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, OTP_FROM_EMAIL } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !OTP_FROM_EMAIL) {
    throw new Error('Email OTP delivery is not configured');
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });

  await transporter.sendMail({
    from: OTP_FROM_EMAIL,
    to: email,
    subject: 'Your Winner Top verification code',
    text: `Your verification code is ${code}. It expires in 10 minutes. Do not share this code.`,
  });
}

async function sendOtpSms(mobileNumber, code) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error('SMS OTP delivery is not configured');
  }

  await twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN).messages.create({
    body: `Your Winner Top verification code is ${code}. It expires in 10 minutes. Do not share this code.`,
    from: TWILIO_FROM_NUMBER,
    to: mobileNumber,
  });
}

async function sendOtp({ channel, email, mobileNumber, code }) {
  if (channel === 'email') return sendOtpEmail(email, code);
  if (channel === 'sms') return sendOtpSms(mobileNumber, code);
  throw new RangeError('otpChannel must be email or sms');
}

module.exports = { normalizeMobileNumber, sendOtp };