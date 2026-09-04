const test = require('node:test');
const assert = require('node:assert/strict');
const { twoWayMatch, validateDocumentType, decideV2, nextStatus } = require('../../backend/src/services/scenario.service');
const { validateFileSignature } = require('../../backend/src/services/file-security.service');

test('V2 2-way matching blocks price, quantity, and closed PO exceptions', () => {
  const result = twoWayMatch(
    { vendorId: 'V1', currency: 'INR', subtotal: 1200, lines: [{ poLine: '10', quantity: 2, unitPrice: 600 }] },
    { vendorId: 'V1', currency: 'INR', expectedSubtotal: 1000, status: 'CLOSED', lines: [{ poLine: '10', remainingQuantity: 1, unitPrice: 500 }] }
  );
  assert.equal(result.passed, false);
  assert.deepEqual(result.reasons, ['PO_NOT_OPEN', 'PRICE_VARIANCE', 'QUANTITY_VARIANCE']);
});

test('V2 document policy blocks proforma and unreferenced credit notes', () => {
  assert.equal(validateDocumentType({ documentType: 'PROFORMA' }).reason, 'PROFORMA_NOT_POSTABLE');
  assert.equal(validateDocumentType({ documentType: 'CREDIT_NOTE' }).reason, 'CREDIT_NOTE_REFERENCE_REQUIRED');
  assert.equal(validateDocumentType({ documentType: 'STANDARD_INVOICE' }).allowedToPost, true);
});

test('V2 confidence hard stops override high confidence', () => {
  const result = decideV2({ confidence: 99, fieldConfidence: 99, recommendationConfidence: 99, duplicate: true, vendorValid: true, taxValid: true, erpMasterDataValid: true });
  assert.equal(result.decision, 'BLOCK_OR_REVIEW');
  assert.deepEqual(result.hardStops, [true]);
});

test('V2 status machine handles posting failures and reconciliation', () => {
  assert.equal(nextStatus('RECEIVED', 'extract'), 'EXTRACTING');
  assert.equal(nextStatus('POSTING', 'timeout'), 'ERP_TIMEOUT');
  assert.equal(nextStatus('POSTED', 'reconciled'), 'RECONCILED');
});

test('V2 file security validates PDF magic bytes', () => {
  assert.equal(validateFileSignature({ originalname: 'invoice.pdf', buffer: Buffer.from('%PDF-1.7') }).valid, true);
  assert.equal(validateFileSignature({ originalname: 'invoice.pdf', buffer: Buffer.from('not a pdf') }).valid, false);
});