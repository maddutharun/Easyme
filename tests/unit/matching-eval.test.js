const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileInvoiceAgainstErp } = require('../../backend/services/invoice-engine');
const { vendors, transactions } = require('../../backend/data/seed');

test('seeded Northstar invoice auto-posts against ERP master data', () => {
  const result = reconcileInvoiceAgainstErp({
    vendor: 'Northstar Office Co.',
    invoiceNumber: 'NS-88214',
    date: '2026-08-26',
    amount: 12480,
    currency: 'USD',
    po: 'PO-4500188',
    mode: '3-way',
    quantity: 120,
    tax: 0,
    duplicate: false,
    totalValid: true
  }, { vendors, transactions, invoices: [] });

  assert.equal(result.vendorMatch, true);
  assert.equal(result.poMatch, true);
  assert.ok(result.confidence >= 90);
});
