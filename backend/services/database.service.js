const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const { DB_PATH } = require('../config/env');

const ensureDirectory = (targetPath) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
};

const openDatabase = () => {
  ensureDirectory(DB_PATH);
  return new sqlite3.Database(DB_PATH);
};

const initializeDatabase = () => new Promise((resolve, reject) => {
  const db = openDatabase();

  db.serialize(() => {
    db.run(`
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
    `, (err) => {
      if (err) return reject(err);

      db.run(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          invoice_id TEXT,
          action TEXT,
          actor TEXT,
          details TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `, (dbErr) => {
        if (dbErr) return reject(dbErr);

        db.run(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            role TEXT,
            password_hash TEXT,
            name TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `, (userErr) => {
          if (userErr) return reject(userErr);

          const seedUsers = [
            ['u-ap-clerk', 'clerk@easyme.local', 'ap_clerk', 'demo123', 'AP Clerk'],
            ['u-ap-manager', 'manager@easyme.local', 'ap_manager', 'demo123', 'AP Manager'],
            ['u-finance', 'finance@easyme.local', 'finance_approver', 'demo123', 'Finance Approver'],
            ['u-admin', 'admin@easyme.local', 'admin', 'demo123', 'System Admin']
          ];

          const insertUser = (index) => {
            if (index >= seedUsers.length) {
              db.close();
              resolve();
              return;
            }

            const [id, email, role, passwordHash, name] = seedUsers[index];
            db.run(
              'INSERT OR IGNORE INTO users (id, email, role, password_hash, name) VALUES (?, ?, ?, ?, ?)',
              [id, email, role, passwordHash, name],
              (insertErr) => {
                if (insertErr) {
                  db.close();
                  reject(insertErr);
                  return;
                }
                insertUser(index + 1);
              }
            );
          };

          insertUser(0);
        });
      });
    });
  });
});

const listUsers = () => new Promise((resolve, reject) => {
  const db = openDatabase();
  db.all('SELECT id, email, role, name FROM users', (err, rows) => {
    db.close();
    if (err) reject(err);
    else resolve(rows);
  });
});

const getUserByEmail = (email) => new Promise((resolve, reject) => {
  const db = openDatabase();
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
    db.close();
    if (err) reject(err);
    else resolve(row || null);
  });
});

module.exports = {
  initializeDatabase,
  listUsers,
  getUserByEmail,
  openDatabase
};
