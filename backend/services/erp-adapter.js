class DemoErpAdapter {
  constructor({ transactions, invoices }) {
    this.transactions = transactions;
    this.invoices = invoices;
  }

  async findPurchaseOrder(po) {
    return this.transactions.find((item) => item.po === po) || null;
  }

  async findExistingInvoice(vendorId, invoiceNumber) {
    return this.invoices.find((item) => item.vendorId === vendorId && item.invoiceNumber === invoiceNumber) || null;
  }

  async postInvoice(invoice) {
    return {
      erpDocument: `ERP-${Date.now().toString().slice(-8)}`,
      postedAt: new Date().toISOString(),
      idempotencyKey: `${invoice.vendorId || 'unknown'}:${invoice.invoiceNumber || invoice.id}`
    };
  }
}

class MockErpAdapter extends DemoErpAdapter {
  async postInvoice(invoice) {
    const base = await super.postInvoice(invoice);
    return {
      ...base,
      status: 'queued',
      provider: 'mock-erp'
    };
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