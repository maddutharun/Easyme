const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

test('seeded users authenticate with hashed passwords', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyme-'));
  process.env.DB_PATH = path.join(tempDir, 'app.db');
  process.env.AUTH_REQUIRED = 'true';
  process.env.JWT_SECRET = 'test-secret';
  delete require.cache[require.resolve('../../backend/config/env')];
  delete require.cache[require.resolve('../../backend/services/database.service')];
  delete require.cache[require.resolve('../../backend/services/auth.service')];

  const { initializeDatabase } = require('../../backend/services/database.service');
  const { authenticate, signToken, verifyToken } = require('../../backend/services/auth.service');
  const { invoices } = require('../../backend/data/seed');

  await initializeDatabase(invoices);
  const user = await authenticate('finance@easyme.local', 'demo123');
  assert.ok(user);
  assert.equal(user.role, 'finance_approver');
  const token = signToken(user);
  const claims = verifyToken(token);
  assert.equal(claims.email, 'finance@easyme.local');

  const rejected = await authenticate('finance@easyme.local', 'wrong');
  assert.equal(rejected, null);
});
