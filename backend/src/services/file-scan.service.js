  const { validateFileSignature } = require('./file-security.service');

async function scanUpload(file) {
  const signature = validateFileSignature(file);
  if (!signature.valid) {
    return { ok: false, engine: 'magic', reason: 'File extension and content signature do not match.' };
  }
  if (process.env.CLAMAV_URL) {
    try {
      const response = await fetch(process.env.CLAMAV_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file.buffer,
        signal: AbortSignal.timeout(4000)
      });
      if (!response.ok) return { ok: false, engine: 'clamav', reason: 'Malware scanner rejected the file.' };
    } catch (error) {
      return { ok: false, engine: 'clamav', reason: 'Malware scanner unavailable.' };
    }
  }
  return { ok: true, engine: process.env.CLAMAV_URL ? 'clamav' : 'magic', reason: null };
}

module.exports = { scanUpload };
