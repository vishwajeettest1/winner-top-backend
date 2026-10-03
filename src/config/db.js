const mongoose = require('mongoose');

function getMongoUri(uri = process.env.MONGO_URI) {
  const connectionUri = uri || 'mongodb://localhost:27017/streamearn';
  const parsedUri = new URL(connectionUri);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

  if (localHosts.has(parsedUri.hostname) && !parsedUri.searchParams.has('replicaSet')) {
    parsedUri.searchParams.set('replicaSet', process.env.MONGO_REPLICA_SET || 'rs0');
  }

  return parsedUri.toString();
}

async function connectDB() {
  try {
    await mongoose.connect(getMongoUri());
    console.log('[db] connected to MongoDB');
  } catch (err) {
    console.error('[db] connection error:', err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
module.exports.getMongoUri = getMongoUri;
