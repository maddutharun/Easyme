const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sqlite3 = require('sqlite3').verbose();
const { DB_PATH } = require('../config/env');
const { decorateInvoice, normalizeStatus } = require('../src/status');
const { attachDatabase, ensureVendorTemplateTable } = require('../src/services/vendor-template.service');

let db;
const invoices = [];
const audit = [];

const ensureDirectory = (targetPath) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  if (!String(stored).startsWith('scrypt$')) return String(password) === String(stored);
  const parts = String(stored).split('$');
  if (parts.length !== 3) return false;
  const derived = crypto.scryptSync(String(password), parts[1], 64);
  const expected = Buffer.from(parts[2], 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function openDatabase() {
  if (db) return db;
  ensureDirectory(DB_PATH);
  db = new sqlite3.Database(DB_PATH);
  return db;
}

async function persistNow() {
  if (!db) return;
  await run('BEGIN IMMEDIATE');
  try {
    await run('DELETE FROM invoices');
    await run('DELETE FROM audit_logs');
    for (const invoice of invoices) {
      const normalized = decorateInvoice(invoice);
      invoice.status = normalized.status;
      await run(
        `INSERT INTO invoices (id, vendor, invoice_number, amount, currency, po, status, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoice.id,
          invoice.vendor || null,
          invoice.invoiceNumber || null,
          Number(invoice.amount || 0),
          invoice.currency || 'USD',
          invoice.po || null,
          invoice.status,
          JSON.stringify(invoice),
          invoice.createdAt || new Date().toISOString(),
          new Date().toISOString()
        ]
      );
    }
    for (const entry of audit) {
      await run(
        `INSERT INTO audit_logs (id, invoice_id, action, actor, details, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          entry.invoiceId || entry.entityId || null,
          entry.action,
          entry.actor || entry.user || 'system',
          entry.detail || '',
          JSON.stringify(entry),
          entry.timestamp || entry.at || new Date().toISOString()
        ]
      );
    }
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK').catch(() => {});
    throw error;
  }
}

let persistChain = Promise.resolve();
async function persist() {
  persistChain = persistChain.then(persistNow, persistNow);
  return persistChain;
}

function createPersistentStore(seedInvoices = []) {
  return {
    get invoices() { return invoices; },
    get audit() { return audit; },
    addInvoice(invoice) {
      invoices.unshift(decorateInvoice(invoice));
      persist().catch((error) => console.warn('[db] persist failed', error.message));
    },
    recordAudit(action, invoice, detail, metadata = {}) {
      const entry = {
        id: crypto.randomUUID(),
        action,
        user: metadata.user || metadata.actor || 'system',
        actor: metadata.actor || metadata.user || 'system',
        entity: metadata.entity || 'invoice',
        entityId: invoice?.id || metadata.entityId || null,
        invoiceId: invoice?.id || null,
        detail: typeof detail === 'string' ? detail : JSON.stringify(detail ?? {}),
        details: typeof detail === 'object' && detail !== null ? detail : null,
        oldValue: metadata.oldValue ?? null,
        newValue: metadata.newValue ?? null,
        reason: metadata.reason || (typeof detail === 'string' ? detail : null),
        ip: metadata.ip || 'local',
        timestamp: new Date().toISOString(),
        at: new Date().toISOString(),
        model_version: metadata.model_version || metadata.aiVersion || 'local-rule-v1',
        ai_version: metadata.ai_version || metadata.aiVersion || 'local-rule-v1',
        rule_version: metadata.rule_version || metadata.ruleVersion || 'invoice-rules-v1',
        recommendation_version: metadata.recommendation_version || metadata.recommendationVersion || 'recommendation-v1',
        agent: metadata.agent || 'invoice-intelligence-mvp',
        metadata
      };
      audit.push(entry);
      persist().catch((error) => console.warn('[db] persist failed', error.message));
      return entry;
    },
    persist: () => persist().catch((error) => console.warn('[db] persist failed', error.message))
  };
}

async function hydrateFromDisk(seedInvoices = []) {
  const jsonDir = path.join(__dirname, '..', 'data');
  const invoiceFile = path.join(jsonDir, 'invoices.json');
  const auditFile = path.join(jsonDir, 'audit.json');

  const rows = await all('SELECT payload, status FROM invoices ORDER BY updated_at DESC');
  invoices.splice(0, invoices.length);
  if (rows.length) {
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.payload || '{}');
        invoices.push(decorateInvoice({ ...parsed, status: row.status || parsed.status }));
      } catch (error) {
        console.warn('[db] skipped unreadable invoice row', error.message);
      }
    }
  } else if (fs.existsSync(invoiceFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(invoiceFile, 'utf8'));
      const list = Array.isArray(parsed) ? parsed : parsed.invoices || [];
      invoices.push(...list.map((item) => decorateInvoice(item)));
    } catch (error) {
      console.warn('[db] json invoice migrate failed', error.message);
    }
  }

  if (!invoices.length && Array.isArray(seedInvoices)) {
    invoices.push(...seedInvoices.map((item) => decorateInvoice({
      ...item,
      status: normalizeStatus(item.status),
      createdAt: item.createdAt || new Date().toISOString()
    })));
  }

  const auditRows = await all('SELECT metadata FROM audit_logs ORDER BY created_at ASC');
  audit.splice(0, audit.length);
  if (auditRows.length) {
    for (const row of auditRows) {
      try {
        audit.push(JSON.parse(row.metadata || '{}'));
      } catch (error) {
        console.warn('[db] skipped unreadable audit row', error.message);
      }
    }
  } else if (fs.existsSync(auditFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
      if (Array.isArray(parsed)) audit.push(...parsed);
    } catch (error) {
      console.warn('[db] json audit migrate failed', error.message);
    }
  }

  await persist();
}

const DEMO_USERS = [
  ['u-ap-clerk', 'clerk@easyme.local', 'ap_clerk', 'demo123', 'Priya Shah'],
  ['u-ap-manager', 'manager@easyme.local', 'ap_manager', 'demo123', 'Marcus Chen'],
  ['u-finance', 'finance@easyme.local', 'finance_approver', 'demo123', 'Amelia Rao'],
  ['u-admin', 'admin@easyme.local', 'admin', 'demo123', 'EasyMe Admin']
];

async function initializeDatabase(seedInvoices = []) {
  openDatabase();
  await run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      vendor TEXT,
      invoice_number TEXT,
      amount REAL,
      currency TEXT,
      po TEXT,
      status TEXT,
      payload TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      invoice_id TEXT,
      action TEXT,
      actor TEXT,
      details TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      role TEXT,
      password_hash TEXT,
      name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  attachDatabase({ run, all });
  await ensureVendorTemplateTable();

  for (const [id, email, role, password, name] of DEMO_USERS) {
    const existing = await get('SELECT id, password_hash FROM users WHERE email = ?', [email]);
    if (!existing) {
      await run(
        'INSERT INTO users (id, email, role, password_hash, name) VALUES (?, ?, ?, ?, ?)',
        [id, email, role, hashPassword(password), name]
      );
    } else if (!String(existing.password_hash || '').startsWith('scrypt$')) {
      await run('UPDATE users SET password_hash = ?, name = ?, role = ? WHERE id = ?', [hashPassword(password), name, role, id]);
    }
  }

  await hydrateFromDisk(seedInvoices);
}

const listUsers = () => all('SELECT id, email, role, name FROM users');
const getUserByEmail = (email) => get('SELECT * FROM users WHERE email = ?', [String(email || '').trim().toLowerCase()]);

module.exports = {
  initializeDatabase,
  listUsers,
  getUserByEmail,
  openDatabase,
  createPersistentStore,
  hashPassword,
  verifyPassword,
  persist
};
