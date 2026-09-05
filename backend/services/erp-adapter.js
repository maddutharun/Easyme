class DemoErpAdapter {
  constructor({ transactions, invoices }) {
    this.transactions = transactions;
    this.invoices = invoices;
    this.posted = new Map();
    this.healthy = true;
  }

  async ping() {
    return { ok: this.healthy, provider: 'demo-erp', checkedAt: new Date().toISOString() };
  }

  async findPurchaseOrder(po) {
    return this.transactions.find((item) => item.po === po) || null;
  }

  async findExistingInvoice(vendorId, invoiceNumber) {
    return this.invoices.find((item) => item.vendorId === vendorId && item.invoiceNumber === invoiceNumber) || null;
  }

  async postInvoice(invoice) {
    const idempotencyKey = invoice.posting?.idempotencyKey || `${invoice.vendorId || 'unknown'}:${invoice.invoiceNumber || invoice.id}`;
    const existing = this.posted.get(idempotencyKey);
    if (existing) return { ...existing, duplicate: true };

    if (invoice.forceErpFailure || invoice.invoiceNumber === 'ERP-FAIL') {
      const error = { posted: false, error: 'ERP_VALIDATION_FAILED', message: 'ERP rejected the document', idempotencyKey };
      this.posted.set(idempotencyKey, error);
      const failure = new Error('ERP rejected the document');
      failure.code = 'ERP_VALIDATION_FAILED';
      failure.payload = error;
      throw failure;
    }

    const result = {
      erpDocument: `ERP-${Date.now().toString().slice(-8)}`,
      postedAt: new Date().toISOString(),
      idempotencyKey,
      status: 'posted',
      provider: 'demo-erp',
      total: Number(invoice.amount || 0),
      invoiceNumber: invoice.invoiceNumber
    };
    this.posted.set(idempotencyKey, result);
    return result;
  }

  async getPostedDocument(documentNumber) {
    for (const result of this.posted.values()) {
      if (result.erpDocument === documentNumber) {
        return {
          documentNumber,
          invoiceNumber: result.invoiceNumber,
          total: result.total,
          status: 'OPEN'
        };
      }
    }
    return {
      documentNumber,
      invoiceNumber: null,
      total: 0,
      status: 'MISSING'
    };
  }
}

class MockErpAdapter extends DemoErpAdapter {
  async postInvoice(invoice) {
    if (String(invoice.po || '').includes('CLOSED')) {
      const error = new Error('Purchase order is closed');
      error.code = 'PO_NOT_OPEN';
      throw error;
    }
    const result = await super.postInvoice(invoice);
    return { ...result, status: result.status || 'queued', provider: 'mock-erp' };
  }
}

class RestErpAdapter extends DemoErpAdapter {
  constructor(options) {
    super(options);
    this.baseUrl = process.env.ERP_BASE_URL || '';
    this.apiKey = process.env.ERP_API_KEY || '';
  }

  headers() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  async ping() {
    if (!this.baseUrl) return super.ping();
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/health`, { headers: this.headers(), signal: AbortSignal.timeout(4000) });
      return { ok: response.ok, provider: 'rest-erp', checkedAt: new Date().toISOString() };
    } catch (error) {
      return { ok: false, provider: 'rest-erp', error: error.message, checkedAt: new Date().toISOString() };
    }
  }

  async postInvoice(invoice) {
    if (!this.baseUrl) return super.postInvoice(invoice);
    const idempotencyKey = invoice.posting?.idempotencyKey || `${invoice.vendorId || 'unknown'}:${invoice.invoiceNumber || invoice.id}`;
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/invoices`, {
      method: 'POST',
      headers: { ...this.headers(), 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        vendorId: invoice.vendorId,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amount,
        po: invoice.po,
        currency: invoice.currency
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      const error = new Error(`ERP HTTP ${response.status}`);
      error.code = 'ERP_HTTP';
      throw error;
    }
    const payload = await response.json();
    const result = {
      erpDocument: payload.erpDocument || payload.id,
      postedAt: new Date().toISOString(),
      idempotencyKey,
      status: 'posted',
      provider: 'rest-erp',
      total: Number(invoice.amount || 0),
      invoiceNumber: invoice.invoiceNumber
    };
    this.posted.set(idempotencyKey, result);
    return result;
  }
}

function createErpAdapter({ transactions, invoices, mode = process.env.ERP_MODE || 'demo' } = {}) {
  if (process.env.ERP_BASE_URL) {
    return new RestErpAdapter({ transactions, invoices });
  }
  const providers = {
    demo: DemoErpAdapter,
    mock: MockErpAdapter,
    real: RestErpAdapter
  };

  const Adapter = providers[mode] || DemoErpAdapter;
  return new Adapter({ transactions, invoices });
}

module.exports = { DemoErpAdapter, MockErpAdapter, RestErpAdapter, createErpAdapter };
