const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const { extractInvoiceData, reconcileInvoiceAgainstErp } = require('../backend/services/invoice-engine');

test('extractInvoiceData reads invoice metadata from uploaded file names', async () => {
  const file = {
    originalname: 'Northstar-Office-NS-88214-2026-08-26.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nInvoice Number NS-88214\nVendor Northstar Office Co.\nAmount $12,480')
  };

  const result = await extractInvoiceData(file);

  assert.equal(result.vendor, 'Northstar Office Co.');
  assert.equal(result.invoiceNumber, 'NS-88214');
  assert.equal(result.date, '2026-08-26');
  assert.equal(result.amount, 12480);
  assert.equal(result.currency, 'USD');
  assert.equal(result.po, 'N/A');
});

test('extractInvoiceData reads core invoice fields from invoice text content', async () => {
  const file = {
    originalname: 'invoice-2048.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from(`
      Northstar Office Co.
      Invoice # INV-2048
      PO No. PO-4500191
      Invoice Date: 2026-08-14
      Due Date: 2026-09-13
      Amount Due: $12,096.00
      GST: $896.00
      HSN/SAC: 998314
    `)
  };

  const result = await extractInvoiceData(file);

  assert.equal(result.vendor, 'Northstar Office Co.');
  assert.equal(result.invoiceNumber, 'INV-2048');
  assert.equal(result.date, '2026-08-14');
  assert.equal(result.dueDate, '2026-09-13');
  assert.equal(result.po, 'PO-4500191');
  assert.equal(result.amount, 12096);
  assert.equal(result.tax, 896);
  assert.equal(result.currency, 'USD');
  assert.equal(result.hsnCode, '998314');
});

test('extractInvoiceData reads Indian tax invoice fields from real invoice text', async () => {
  const file = {
    originalname: '174.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from(`
      Tax Invoice
      Cultsport Private Limited
      GSTIN/UIN: 09AAHCC1095P1Z3
      State Name : Uttar Pradesh, Code : 09
      Invoice No. UP1470740
      Date 14-Aug-26
      1 Cult Tummy Trimmer CST701STBKNA
      HSN/SAC 9506990
      GST 18%
      Output GST UP 1,811.52
      Total 1,811.52
    `)
  };

  const result = await extractInvoiceData(file);

  assert.equal(result.vendor, 'Cultsport Private Limited');
  assert.equal(result.invoiceNumber, 'UP1470740');
  assert.equal(result.date, '2026-08-14');
  assert.equal(result.amount, 1811.52);
  assert.equal(result.tax, 1811.52);
  assert.equal(result.currency, 'INR');
  assert.equal(result.hsnCode, '9506990');
  assert.match(result.description || '', /Cult Tummy Trimmer/i);
});

test('extractInvoiceData reads invoice data from Excel files', async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Tax Invoice', ''],
    ['Vendor', 'Cultsport Private Limited'],
    ['Invoice No.', 'UP1470740'],
    ['Date', '14-Aug-26'],
    ['HSN/SAC', '9506990'],
    ['GST', '1,811.52'],
    ['Total', '1,811.52'],
    ['Item', 'Cult Tummy Trimmer CST701STBKNA']
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Invoice');

  const file = {
    originalname: 'invoice.xlsx',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  };

  const result = await extractInvoiceData(file);

  assert.equal(result.vendor, 'Cultsport Private Limited');
  assert.equal(result.invoiceNumber, 'UP1470740');
  assert.equal(result.date, '2026-08-14');
  assert.equal(result.amount, 1811.52);
  assert.equal(result.currency, 'INR');
  assert.equal(result.hsnCode, '9506990');
  assert.match(result.description || '', /Cult Tummy Trimmer/i);
});

test('reconcileInvoiceAgainstErp validates invoice data against ERP records', () => {
  const result = reconcileInvoiceAgainstErp({
    vendor: 'Northstar Office Co.',
    invoiceNumber: 'NS-88214',
    date: '2026-08-26',
    amount: 12480,
    currency: 'USD',
    po: 'PO-4500188',
    mode: '3-way',
    quantity: 120,
    tax: 0
  }, {
    invoices: [],
    transactions: [
      { po: 'PO-4500188', vendorId: 'V-1042', vendor: 'Northstar Office Co.', receipt: 'GR-88021', received: 120, poTotal: 12480 }
    ],
    vendors: [
      { id: 'V-1042', name: 'Northstar Office Co.', status: 'Active' }
    ]
  });

  assert.equal(result.vendorMatch, true);
  assert.equal(result.poMatch, true);
  assert.equal(result.status, 'Auto-posted');
  assert.ok(result.checks.some((check) => check.name === 'Purchase order'));
  assert.ok(result.checks.some((check) => check.name === 'Receipt match'));
});
