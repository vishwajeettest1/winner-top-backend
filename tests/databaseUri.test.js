const test = require('node:test');
const assert = require('node:assert/strict');
const { getMongoUri } = require('../src/config/db');

test('enables replica set transactions for local MongoDB when unspecified', () => {
  const uri = new URL(getMongoUri('mongodb://127.0.0.1:27017/streamearn'));
  assert.equal(uri.searchParams.get('replicaSet'), 'rs0');
});

test('preserves an explicitly configured local replica set', () => {
  const uri = new URL(getMongoUri('mongodb://localhost:27017/streamearn?replicaSet=local-rs'));
  assert.equal(uri.searchParams.get('replicaSet'), 'local-rs');
});

test('does not rewrite remote MongoDB connection strings', () => {
  const value = 'mongodb+srv://example.invalid/streamearn';
  assert.equal(getMongoUri(value), value);
});