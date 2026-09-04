const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileInvoiceAgainstErp, detectIndiaCompliance, detectIndiaComplianceV2 } = require('../../backend/services/invoice-engine');

 test('rules engine computes TDS and GST from configured profiles', () => {
  const compliance = detectIndiaComplianceV2({
    amount: 450000,
    vendorCategory: 'services_professional',
    hsnCode: '998311',
    vendorStateCode: 'KA',
    buyerStateCode: 'MH',
    panAvailable: true,
    serviceType: 'professional'
  });

  assert.equal(compliance.tds.section, '194J');
  assert.equal(compliance.tds.status, 'applicable');
  assert.equal(compliance.tds.tds_amount, 45000);
  assert.equal(compliance.gst.status, 'computed');
  assert.equal(compliance.gst.igst, 81000);
});

 test('reconcileInvoiceAgainstErp includes explainable reasoning and compliance summary', () => {
  const result = reconcileInvoiceAgainstErp(
    { vendor: 'Northstar Office Co.', amount: 12480, po: 'PO-4500188', duplicate: false, totalValid: true, quantity: 120, mode: '3-way', tax: 0 },
    { vendors: [{ id: 'V-1042', name: 'Northstar Office Co.', status: 'Active' }], transactions: [{ po: 'PO-4500188', vendorId: 'V-1042', vendor: 'Northstar Office Co.', receipt: 'GR-88021', received: 120, poTotal: 12480 }] }
  );
  assert.ok(Array.isArray(result.reasoning));
  assert.ok(result.reasoning.length > 0);
  assert.ok(result.compliance && typeof result.compliance === 'object');
  assert.ok(result.compliance.gst && result.compliance.tds && result.compliance.eInvoice);
});

test('detectIndiaCompliance flags TDS section for large service invoices', () => {
  const compliance = detectIndiaCompliance({ amount: 450000, vendor: 'Northstar Office Co.', tax: 45000, irn: 'IRN-XYZ', hsnCode: '9983' });
  assert.equal(compliance.tds.section, '194J');
  assert.equal(compliance.eInvoice.status, 'verified');
  assert.equal(compliance.gst.status, 'ready');
});

test('extractInvoiceData does not invent vendor data for a generic file name', async () => {
  const { extractInvoiceData } = require('../../backend/services/invoice-engine');
  const extracted = await extractInvoiceData({ originalname: '174.pdf', buffer: Buffer.from('') });
  assert.equal(extracted.vendor, 'Unknown vendor');
  assert.equal(extracted.invoiceNumber, '174');
  assert.equal(extracted.po, 'N/A');
});

test('extractInvoiceData flags unreadable files instead of defaulting to fake invoice data', async () => {
  const { extractInvoiceData } = require('../../backend/services/invoice-engine');
  const extracted = await extractInvoiceData({ originalname: 'invoice.pdf', buffer: Buffer.from([0, 0, 0, 0, 0, 0, 0]) });
  assert.equal(extracted.vendor, 'Unknown vendor');
  assert.equal(extracted.readable, false);
  assert.equal(extracted.amount, 0);
  assert.equal(extracted.po, 'N/A');
});

test('extractInvoiceData prefers the real supplier and invoice values from the PDF text', async () => {
  const { extractInvoiceData } = require('../../backend/services/invoice-engine');
  const extracted = await extractInvoiceData({ originalname: 'invoice.pdf', mimetype: 'application/pdf', buffer: Buffer.from('\nAjro Private Limited\nInvoice No: AJ-2048\nInvoice Date: 18-Aug-2026\nPO Number: PO-4502187\nTotal Amount: $12,480.00\nGST: $1,200.00\nHSN/SAC: 998314\n') });
  assert.equal(extracted.vendor, 'Ajro Private Limited');
  assert.equal(extracted.invoiceNumber, 'AJ-2048');
  assert.equal(extracted.date, '2026-08-18');
  assert.equal(extracted.po, 'PO-4502187');
  assert.equal(extracted.amount, 12480);
  assert.equal(extracted.tax, 1200);
});

test('extractInvoiceData tolerates PDF OCR commas before the amount value', async () => {
  const { extractInvoiceData } = require('../../backend/services/invoice-engine');
  const extracted = await extractInvoiceData({ originalname: 'real-invoice.pdf', mimetype: 'application/pdf', buffer: Buffer.from('\nNorthstar Office Co. Invoice No. NS-88214 Date: 2026-08-26 PO No. PO-4500188 Amount Due: ,480.00 GST: ,200.00 HSN/SAC: 998314 Vendor: Northstar Office Co.\n') });
  assert.equal(extracted.vendor, 'Northstar Office Co.');
  assert.equal(extracted.invoiceNumber, 'NS-88214');
  assert.equal(extracted.amount, 480);
  assert.equal(extracted.tax, 200);
  assert.equal(extracted.readable, true);
});

test('extractInvoiceData strips filename artifacts from vendor names', async () => {
  const { extractInvoiceData } = require('../../backend/services/invoice-engine');
  const extracted = await extractInvoiceData({ originalname: 'real-invoice.pdf', buffer: Buffer.from('\nNorthstar Office Co.\nInvoice No: NS-88214\nDate: 2026-08-26\nPO No: PO-4500188\nAmount Due: ,480.00\nGST: ,200.00\nHSN/SAC: 998314\nVendor: Northstar Office Co.\n') });
  assert.equal(extracted.vendor, 'Northstar Office Co.');
  assert.equal(extracted.invoiceNumber, 'NS-88214');
  assert.equal(extracted.amount, 480);
  assert.equal(extracted.tax, 200);
});

test('extractInvoiceData exposes document classification, field confidence, validation, and matching readiness', async () => {
  const { extractInvoiceData } = require('../../backend/services/invoice-engine');
  const extracted = await extractInvoiceData({ originalname: 'real-invoice.pdf', buffer: Buffer.from('\nNorthstar Office Co.\nInvoice No: NS-88214\nDate: 2026-08-26\nPO No: PO-4500188\nAmount Due: ,480.00\nGST: ,200.00\nHSN/SAC: 998314\nVendor: Northstar Office Co.\n') });
  assert.ok(extracted.pipeline);
  assert.equal(extracted.pipeline.documentType, 'pdf_text');
  assert.ok(extracted.fieldConfidence && extracted.fieldConfidence.vendor >= 0.8);
  assert.ok(extracted.validation && Array.isArray(extracted.validation.checks));
  assert.equal(extracted.readyForMatching, false);
});

test('extractInvoiceData captures exact invoice metadata and signed document markers from PDF-like text', async () => {
  const { extractInvoiceData } = require('../../backend/services/invoice-engine');
  const text = `
  GSTIN : 09ACEPK0781A1ZT
  TAX INVOICE
  M/S PRESIDENT INTERNATIONAL
  G-126, Sector D-1 (P), Loni, Tronica City, Ghaziabad, Uttar Pradesh 201103

  Invoice No. : PINT-236/2026-27
  Dated : 14-08-2026
  Place of Supply : Maharashtra (27)
  Reverse Charge : N

  Shipped to :
  M/S CLP INFRASTRUCTURE PVT LTD
  12A, MUMBAI, INDIA

  HSN Code : 73239390
  Qty. Unit : 550.00 Pcs
  Base Amount : 2,57,950.00
  Tax Amount : 48,681.00
  Total Amount : 3,19,131.00

  Authorized Signatory
  Seal of Company
  `;

  const extracted = await extractInvoiceData({ originalname: 'PINT-236.pdf', mimetype: 'application/pdf', buffer: Buffer.from(text) });

  assert.equal(extracted.invoiceNumber, 'PINT-236/2026-27');
  assert.equal(extracted.date, '2026-08-14');
  assert.match(String(extracted.shipToDetails || ''), /CLP INFRASTRUCTURE PVT LTD/i);
  assert.equal(extracted.hsnCode, '73239390');
  assert.equal(extracted.quantity, 550);
  assert.equal(extracted.po, 'N/A');
  assert.equal(extracted.baseAmount, 257950);
  assert.equal(extracted.taxAmount, 48681);
  assert.equal(extracted.totalAmount, 319131);
  assert.equal(extracted.signaturePresent, true);
  assert.equal(extracted.sealPresent, true);
});

test('extractInvoiceData includes supplier and business details from invoice text', async () => {
  const { extractInvoiceData } = require('../../backend/services/invoice-engine');
  const text = `
  GSTIN : 09ACEPK0781A1ZT
  PAN : ACEPK0781A
  M/S PRESIDENT INTERNATIONAL
  G-126, Sector D-1 (P), Loni, Tronica City, Ghaziabad, Uttar Pradesh 201103
  State : Uttar Pradesh

  Invoice No. : PINT-236/2026-27
  Dated : 14-08-2026
  Shipped to :
  M/S CLP INFRASTRUCTURE PVT LTD
  12A, MUMBAI, INDIA
  Place of Supply : Maharashtra (27)
  `;

  const extracted = await extractInvoiceData({ originalname: 'PINT-236.pdf', mimetype: 'application/pdf', buffer: Buffer.from(text) });

  assert.equal(extracted.supplierName, 'PRESIDENT INTERNATIONAL');
  assert.equal(extracted.supplierGstin, '09ACEPK0781A1ZT');
  assert.equal(extracted.supplierPan, 'ACEPK0781A');
  assert.match(String(extracted.supplierAddress || ''), /Loni, Tronica City/i);
  assert.match(String(extracted.supplierState || ''), /Uttar Pradesh/i);
  assert.match(String(extracted.shipToDetails || ''), /CLP INFRASTRUCTURE PVT LTD/i);
});

test('generateRecommendation returns explainable GL, cost center, and confidence from historical patterns', () => {
  const { generateRecommendation } = require('../../backend/services/invoice-engine');

  const recommendation = generateRecommendation(
    { vendor: 'Northstar Office Co.', amount: 12480, hsnCode: '998314', description: 'Ergonomic monitor arms', po: 'PO-4500188' },
    {
      vendors: [{ id: 'V-1042', name: 'Northstar Office Co.', category: 'Office supplies' }],
      transactions: [
        { vendorId: 'V-1042', vendor: 'Northstar Office Co.', po: 'PO-4500188', poTotal: 12480, description: 'Ergonomic monitor arms', glAccount: '620010', costCenter: 'IT001', taxCode: 'GST18' },
        { vendorId: 'V-1042', vendor: 'Northstar Office Co.', po: 'PO-4500102', poTotal: 11000, description: 'Monitor arms', glAccount: '620010', costCenter: 'IT001', taxCode: 'GST18' },
        { vendorId: 'V-1042', vendor: 'Northstar Office Co.', po: 'PO-4500110', poTotal: 13000, description: 'Office equipment', glAccount: '620010', costCenter: 'IT001', taxCode: 'GST18' }
      ]
    }
  );

  assert.equal(recommendation.glAccount, '620010');
  assert.equal(recommendation.costCenter, 'IT001');
  assert.equal(recommendation.taxCode, 'GST18');
  assert.ok(recommendation.confidence > 85);
  assert.ok(Array.isArray(recommendation.explainability.reasons));
  assert.ok(Array.isArray(recommendation.similarTransactions));
});

test('extractInvoiceData returns line-level SKU, HSN, GST, taxable totals, and charges', async () => {
  const { extractInvoiceData } = require('../../backend/services/invoice-engine');
  const text = `
    M/S PRESIDENT INTERNATIONAL
    Invoice No: PINT-210/2026-27
    Date: 05-08-2026
    GSTIN: 09ACEPK0787A1ZT
    Description HSN Qty Unit Price Amount GST 18%
    1 STEEL SHAKER BLUE SKU CPS30909 73239390 400 Pcs 258.00 108360.00
    2 GALLON BOTTLE 2.2LTR PINK SKU CPS30909 39233090 100 Pcs 390.00 46020.00
    3 GALLON BOTTLE 2.2LTR PINK SKU CPS3090816 39233090 388 Pcs 370.00 143560.00
    Taxable Amount: 337940.00
    CGST 9%: 30414.60
    SGST 9%: 30414.60
    Freight and Forwarding Charges: 20500.00
    Round Off: 0.20
    Grand Total: 419269.40
  `;
  const extracted = await extractInvoiceData({ originalname: 'PINT-210.pdf', mimetype: 'application/pdf', buffer: Buffer.from(text) });
  assert.equal(extracted.lineItemCount, 3);
  assert.equal(extracted.lineItems[0].sku, 'CPS30909');
  assert.equal(extracted.lineItems[0].hsnCode, '73239390');
  assert.equal(extracted.lineItems[0].quantity, 400);
  assert.equal(extracted.lineItems[0].unitPrice, 258);
  assert.equal(extracted.lineItems[0].gstRate, 18);
  assert.equal(extracted.taxableAmount, 337940);
  assert.equal(extracted.gstRate, 18);
  assert.equal(extracted.gstBreakdown.cgst, 30414.6);
  assert.equal(extracted.totalOtherCharges, 20500.2);
  assert.equal(extracted.amountBreakdown.totalAmount, 419269.4);
  assert.equal(extracted.template, 'india-gst-table');
  assert.equal(extracted.fieldEvidence.taxableAmount.needsReview, false);
  assert.equal(extracted.arithmeticValidation.checks.linesMatchTaxable, false);
});

test('extractInvoiceData parses the real PINT-246 PDF with five rows and correct totals', async () => {
  const { extractInvoiceData } = require('../../backend/services/invoice-engine');
  const fs = require('node:fs');
  const filePath = require('node:path').join(__dirname, '..', '..', 'PINT-246 INVOICE (1).pdf');
  const extracted = await extractInvoiceData({ originalname: 'PINT-246 INVOICE (1).pdf', mimetype: 'application/pdf', buffer: fs.readFileSync(filePath) });
  assert.equal(extracted.invoiceNumber, 'PINT-246/2026-27');
  assert.equal(extracted.lineItemCount, 5);
  assert.equal(extracted.lineItems[0].sku, 'CS1.8LMGLDGY');
  assert.equal(extracted.lineItems[0].quantity, 1000);
  assert.equal(extracted.lineItems[0].amount, 430700);
  assert.equal(extracted.taxableAmount, 1094840);
  assert.equal(extracted.taxAmount, 140911.2);
  assert.equal(extracted.totalAmount, 1249751);
  assert.equal(extracted.totalOtherCharges, 13999.8);
});

test('PATCH /api/invoices/:id updates reviewed invoice fields and marks the record for approval', async () => {
  const app = require('../../backend/app');
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const seedResponse = await fetch(`http://127.0.0.1:${port}/api/invoices`);
    const seed = await seedResponse.json();
    const invoiceId = seed.invoices[0]?.id;

    assert.ok(invoiceId, 'seed data should include at least one invoice');

    const response = await fetch(`http://127.0.0.1:${port}/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor: 'Updated Vendor',
        invoiceNumber: 'INV-9001',
        amount: 12345,
        tax: 2345,
        hsnCode: '998314'
      })
    });

    assert.equal(response.status, 200, 'review update should succeed');
    const payload = await response.json();
    assert.equal(payload.invoice.vendor, 'Updated Vendor');
    assert.equal(payload.invoice.invoiceNumber, 'INV-9001');
    assert.equal(payload.invoice.amount, 12345);
    assert.equal(payload.invoice.approval.required, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
