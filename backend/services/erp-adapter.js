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

function createErpAdapter({ transactions, invoices, mode = process.env.ERP_MODE || 'demo' } = {}) {
  const providers = {
    demo: DemoErpAdapter,
    mock: MockErpAdapter,
    real: DemoErpAdapter
  };

  const Adapter = providers[mode] || DemoErpAdapter;
  return new Adapter({ transactions, invoices });
}

module.exports = { DemoErpAdapter, MockErpAdapter, createErpAdapter };
