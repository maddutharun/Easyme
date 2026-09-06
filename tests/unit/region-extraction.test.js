const test = require('node:test');
const assert = require('node:assert/strict');
const { extractPartyBlocks, extractFooterTotals, resolveBusinessUnit, applyRegionLocks } = require('../../backend/src/services/region-extraction.service');
const { extractInvoiceData } = require('../../backend/services/invoice-engine');

test('seller GSTIN and name stay out of the ship-to block', () => {
  const text = `
    GSTIN : 09ACEPK0781A1ZT
    M/S PRESIDENT INTERNATIONAL
    G-126, Loni, Tronica City, Ghaziabad
    Shipped to :
    M/S CLP INFRASTRUCTURE PVT LTD
    12A, MUMBAI, INDIA
    Place of Supply : Maharashtra (27)
    Taxable Amount: 1000.00
    Grand Total: 1180.00
  `;
  const parties = extractPartyBlocks(text);
  assert.match(String(parties.supplierName || ''), /PRESIDENT INTERNATIONAL/i);
  assert.equal(parties.supplierGstin, '09ACEPK0781A1ZT');
  assert.match(String(parties.shipToDetails || ''), /CLP INFRASTRUCTURE/i);
  assert.doesNotMatch(String(parties.shipToDetails || ''), /PRESIDENT INTERNATIONAL/i);
  assert.equal(parties.placeOfSupplyCode, '27');
});

test('footer totals do not use a line-row amount as grand total', () => {
  const footer = extractFooterTotals(
    'Taxable Amount: 337940.00\nCGST 9%: 30414.60\nSGST 9%: 30414.60\nGrand Total: 419269.40',
    '1 STEEL SHAKER 400 258.00 108360.00\nTaxable Amount: 337940.00\nGrand Total: 419269.40'
  );
  assert.equal(footer.taxable, 337940);
  assert.equal(footer.grand, 419269.4);
  assert.equal(footer.cgst + footer.sgst, 60829.2);
});

test('business unit comes from ship-to and place of supply, not supplier state', () => {
  const unit = resolveBusinessUnit({
    shipToDetails: 'M/S CLP INFRASTRUCTURE PVT LTD, 12A, MUMBAI',
    placeOfSupply: 'Maharashtra',
    placeOfSupplyCode: '27'
  });
  assert.equal(unit.source, 'ship_to');
  assert.equal(unit.placeOfSupplyCode, '27');
  assert.equal(unit.companyCode, 'IN27');
});

test('extractInvoiceData keeps bill-to out of supplier and sums line quantity', async () => {
  const extracted = await extractInvoiceData({
    originalname: 'mixup.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from(`
      Seller: Ajro Private Limited
      GSTIN: 09AAHCC1095P1Z3
      Bill to: Wrong Buyer Limited
      Shipped to:
      Plant Pune Warehouse
      Invoice No: AJ-9001
      Date: 18-Aug-2026
      1 Widget SKU WID-1 998314 10 Pcs 100.00 1000.00
      Taxable Amount: 1000.00
      Tax Amount: 180.00
      Grand Total: 1180.00
    `)
  });
  assert.equal(extracted.vendor, 'Ajro Private Limited');
  assert.doesNotMatch(String(extracted.vendor), /Wrong Buyer/i);
  assert.match(String(extracted.shipToDetails || ''), /Pune Warehouse/i);
  assert.equal(extracted.quantity, 10);
  assert.equal(extracted.taxableAmount, 1000);
  assert.equal(extracted.tax, 180);
  assert.equal(extracted.amount, 1180);
  assert.equal(extracted.lineItems[0].hsnCode, '998314');
  assert.equal(extracted.lineItems[0].quantity, 10);
  assert.equal(extracted.lineItems[0].amount, 1000);
  assert.equal(extracted.businessUnit.source, 'ship_to');
});

test('region locks fail when supplier GSTIN equals buyer GSTIN', () => {
  const locks = applyRegionLocks({
    supplierGstin: '09AAHCC1095P1Z3',
    buyerGstin: '09AAHCC1095P1Z3',
    lineItems: [],
    totalQuantity: 0,
    taxableAmount: 100,
    taxAmount: 18,
    totalAmount: 118
  });
  assert.equal(locks.passed, false);
  assert.equal(locks.checks.supplierGstinDistinctFromBuyer, false);
});
