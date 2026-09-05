const test = require('node:test');
const assert = require('node:assert/strict');
const { repairOcrText, extractGstin, extractIrn, pickVendorName } = require('../../backend/src/services/extraction-refine.service');
const { extractLineItems } = require('../../backend/src/services/line-item-extraction.service');
const { extractInvoiceData } = require('../../backend/services/invoice-engine');

test('repairOcrText drops a leading comma on amount fields', () => {
  const repaired = repairOcrText('Amount Due: ,480.00 GST: ,200.00');
  assert.match(repaired, /Amount Due:\s*480\.00/i);
});

test('extractGstin reads a 15-character GSTIN', () => {
  const result = extractGstin('GSTIN: 09AAHCC1095P1Z3');
  assert.equal(result.value, '09AAHCC1095P1Z3');
});

test('extractIrn reads a labeled IRN', () => {
  assert.equal(extractIrn('IRN: abcdefghijklmnopqrstuvwxyz012345'), 'abcdefghijklmnopqrstuvwxyz012345');
});

test('pickVendorName prefers a legal entity over Tax Invoice', () => {
  const vendor = pickVendorName('Tax Invoice\nAjro Private Limited\nGSTIN: 09AAHCC1095P1Z3', {}, {});
  assert.equal(vendor, 'Ajro Private Limited');
});

test('extractLineItems keeps HSN rows and ignores the tax footer', () => {
  const items = extractLineItems(`
    1 STEEL SHAKER BLUE SKU CPS30909 73239390 400 Pcs 258.00 108360.00
    Taxable Amount: 337940.00
    CGST 9%: 30414.60
  `);
  assert.equal(items.length, 1);
  assert.equal(items[0].sku, 'CPS30909');
  assert.equal(items[0].quantity, 400);
  assert.equal(items[0].unitPrice, 258);
  assert.equal(items[0].amount, 108360);
});

test('extractLineItems ignores GST rate and uses quantity, rate, and line amount', () => {
  const items = extractLineItems(`
    1 Imported Bottle HSN 95069190 GST 18% 70 Pcs 600.00 42000.00
    Taxable Amount: 42000.00
    Grand Total: 49560.00
  `);
  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 70);
  assert.equal(items[0].unitPrice, 600);
  assert.equal(items[0].amount, 42000);
});

test('extractLineItems rejects numbered non-invoice text without HSN or SKU', () => {
  const items = extractLineItems('1 Confidence Engine returns a confidence score of 95.0');
  assert.equal(items.length, 0);
});

test('extractLineItems joins a wrapped HSN onto the numbered row', async () => {
  const extracted = await extractInvoiceData({
    originalname: 'wrapped.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from(`
      Northstar Office Co.
      Invoice No: NS-9001
      Date: 2026-08-26
      1 Ergonomic arm SKU ARM-1
      HSN 998314 10 Pcs 100.00 1000.00
      Grand Total: 1000.00
    `)
  });
  assert.equal(extracted.vendor, 'Northstar Office Co.');
  assert.equal(extracted.lineItemCount, 1);
  assert.equal(extracted.lineItems[0].quantity, 10);
  assert.equal(extracted.lineItems[0].amount, 1000);
});
