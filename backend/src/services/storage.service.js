const fs = require('node:fs');
const path = require('node:path');
const { STORAGE_PATH } = require('../../config/env');

async function storeInvoiceFile(buffer, fileName) {
  const driver = process.env.STORAGE_DRIVER || 'local';
  const safeName = path.basename(fileName).replace(/[^A-Za-z0-9._-]/g, '_');
  if (driver === 's3' && process.env.S3_PUT_URL) {
    const response = await fetch(process.env.S3_PUT_URL.replace('{key}', encodeURIComponent(safeName)), {
      method: 'PUT',
      body: buffer,
      headers: { 'Content-Type': 'application/octet-stream' }
    });
    if (!response.ok) throw new Error('Object storage PUT failed');
    return { driver: 's3', key: safeName, url: process.env.S3_PUBLIC_URL ? `${process.env.S3_PUBLIC_URL}/${safeName}` : null };
  }
  const directory = STORAGE_PATH || path.join(__dirname, '..', '..', 'uploads');
  fs.mkdirSync(directory, { recursive: true });
  const storedPath = path.join(directory, safeName);
  fs.writeFileSync(storedPath, buffer);
  return { driver: 'local', key: safeName, path: storedPath };
}

module.exports = { storeInvoiceFile };
