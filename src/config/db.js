const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/streamearn';
  try {
    await mongoose.connect(uri);
    console.log('[db] connected to MongoDB');
  } catch (err) {
    console.error('[db] connection error:', err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
