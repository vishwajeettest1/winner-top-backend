require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const connectDB = require('./src/config/db');

const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const videoRoutes = require('./src/routes/videoRoutes');
const walletRoutes = require('./src/routes/walletRoutes');
const referralRoutes = require('./src/routes/referralRoutes');
const withdrawalRoutes = require('./src/routes/withdrawalRoutes');
const adCallbackRoutes = require('./src/routes/adCallbackRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const currencyRoutes = require('./src/routes/currencyRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const depositOptionRoutes = require('./src/routes/depositOptionRoutes');

const app = express();

app.use(cors());
app.use(express.json({
  verify(req, res, buffer) {
    if (req.originalUrl.startsWith('/api/payments/webhook')) {
      req.rawBody = Buffer.from(buffer);
    }
  },
}));
app.use(
  '/uploads/deposit-qr',
  express.static(path.join(__dirname, 'uploads', 'deposit-qr'), {
    dotfiles: 'deny',
    index: false,
    maxAge: '1h',
  })
);

// Basic abuse protection on auth endpoints.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
app.use('/api/auth', authLimiter, authRoutes);
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
app.use('/api/admin/login', adminLoginLimiter);

app.use('/api/user', userRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/ad-callbacks', adCallbackRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/currency', currencyRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/deposit-options', depositOptionRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`[server] StreamEarn API listening on port ${PORT}`));
});

module.exports = app;
