const { AIProvider } = require('./ai.provider');

class HttpDocumentAiProvider extends AIProvider {
  constructor({ url, apiKey, sendFile = false, timeoutMs = 8000 } = {}) {
    super();
    this.url = url;
    this.apiKey = apiKey;
    this.sendFile = sendFile;
    this.timeoutMs = timeoutMs;
  }

  async extractInvoice(file, baseline = {}) {
    if (!this.url) return baseline;
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const body = {
      fileName: file?.originalname,
      mimeType: file?.mimetype,
      baseline: {
        vendor: baseline.vendor,
        invoiceNumber: baseline.invoiceNumber,
        amount: baseline.amount
      }
    };
    if (this.sendFile && file?.buffer) {
      body.contentBase64 = file.buffer.toString('base64');
    }
    const response = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) return baseline;
    const payload = await response.json();
    const fields = payload.fields || payload.extracted || payload;
    return {
      ...baseline,
      ...pickKnownFields(fields),
      extractionSource: [...new Set([...(baseline.extractionSource || []), 'document-ai'])]
    };
  }
}

function pickKnownFields(fields = {}) {
  const allowed = [
    'vendor', 'invoiceNumber', 'date', 'dueDate', 'amount', 'tax', 'po', 'currency',
    'supplierGstin', 'supplierPan', 'hsnCode', 'lineItems'
  ];
  const next = {};
  for (const key of allowed) {
    if (fields[key] !== undefined && fields[key] !== null && fields[key] !== '') next[key] = fields[key];
  }
  return next;
}

module.exports = { HttpDocumentAiProvider };
