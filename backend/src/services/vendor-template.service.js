  const crypto = require('node:crypto');

let dbRun;
let dbAll;

function attachDatabase({ run, all }) {
  dbRun = run;
  dbAll = all;
}

async function ensureVendorTemplateTable() {
  if (!dbRun) return;
  await dbRun(`
    CREATE TABLE IF NOT EXISTS vendor_templates (
      id TEXT PRIMARY KEY,
      gstin TEXT,
      vendor TEXT,
      column_map TEXT,
      updated_at TEXT
    )
  `);
}

async function saveVendorTemplate({ gstin, vendor, columnMap }) {
  if (!dbRun || (!gstin && !vendor)) return null;
  await ensureVendorTemplateTable();
  const id = crypto.createHash('sha1').update(`${gstin || ''}|${vendor || ''}`).digest('hex').slice(0, 16);
  await dbRun(
    `INSERT INTO vendor_templates (id, gstin, vendor, column_map, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET column_map = excluded.column_map, vendor = excluded.vendor, gstin = excluded.gstin, updated_at = excluded.updated_at`,
    [id, gstin || null, vendor || null, JSON.stringify(columnMap || {}), new Date().toISOString()]
  );
  return { id, gstin, vendor, columnMap };
}

async function findVendorTemplate({ gstin, vendor }) {
  if (!dbAll) return null;
  await ensureVendorTemplateTable();
  const rows = await dbAll(
    'SELECT * FROM vendor_templates WHERE (gstin IS NOT NULL AND gstin = ?) OR (vendor IS NOT NULL AND lower(vendor) = lower(?)) LIMIT 1',
    [gstin || '', vendor || '']
  );
  const row = rows[0];
  if (!row) return null;
  try {
    return { id: row.id, gstin: row.gstin, vendor: row.vendor, columnMap: JSON.parse(row.column_map || '{}') };
  } catch (error) {
    return { id: row.id, gstin: row.gstin, vendor: row.vendor, columnMap: {} };
  }
}

module.exports = { attachDatabase, ensureVendorTemplateTable, saveVendorTemplate, findVendorTemplate };
