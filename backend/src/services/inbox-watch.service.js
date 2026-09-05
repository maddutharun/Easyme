  const fs = require('node:fs');
const path = require('node:path');

function guessMime(name) {
  const ext = path.extname(name || '').toLowerCase();
  return ({
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.json': 'application/json',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel'
  })[ext] || 'application/octet-stream';
}

function startInboxWatch({ directory, ingest, intervalMs = 8000 } = {}) {
  if (!directory || typeof ingest !== 'function') return { stop() {} };
  fs.mkdirSync(directory, { recursive: true });
  const processedDir = path.join(directory, 'processed');
  const failedDir = path.join(directory, 'failed');
  fs.mkdirSync(processedDir, { recursive: true });
  fs.mkdirSync(failedDir, { recursive: true });
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const names = fs.readdirSync(directory).filter((name) => !name.startsWith('.') && name !== 'processed' && name !== 'failed');
      for (const name of names) {
        const full = path.join(directory, name);
        let stat;
        try {
          stat = fs.statSync(full);
        } catch (error) {
          continue;
        }
        if (!stat.isFile()) continue;
        try {
          const buffer = fs.readFileSync(full);
          await ingest({ originalname: name, mimetype: guessMime(name), buffer }, { sourceChannel: 'mailbox' });
          fs.renameSync(full, path.join(processedDir, `${Date.now()}-${name}`));
        } catch (error) {
          console.warn('[inbox] failed to ingest', name, error.message);
          try {
            fs.renameSync(full, path.join(failedDir, `${Date.now()}-${name}`));
          } catch (moveError) {
            console.warn('[inbox] could not quarantine', name, moveError.message);
          }
        }
      }
    } catch (error) {
      console.warn('[inbox] watch cycle failed:', error.message);
    } finally {
      busy = false;
    }
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return { stop() { clearInterval(timer); } };
}

module.exports = { startInboxWatch, guessMime };
