const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractInvoiceData } = require('../../backend/services/invoice-engine');
const { scoreExtraction, summarizeEval } = require('../../backend/src/services/extraction-eval.service');
const { matchInvoiceLines } = require('../../backend/src/services/line-match.service');
const { decideAutoPost } = require('../../backend/src/services/auto-post.service');
const { parseEinvoicePayload, einvoiceToExtracted } = require('../../backend/src/services/einvoice.service');

const goldens = JSON.parse(fs.readFileSync(path.join(__dirname, 'goldens.json'), 'utf8'));

test('golden invoice pack scores extraction fields', async () => {
  const results = [];
  for (const golden of goldens) {
    const extracted = await extractInvoiceData({
      originalname: golden.originalname,
      mimetype: golden.mimetype,
      buffer: Buffer.from(golden.text)
    });
    const scored = scoreExtraction(extracted, golden.expected);
    results.push(scored);
    assert.equal(scored.fieldAccuracy, 1, `${golden.id} should extract every contracted field`);
  }
  const summary = summarizeEval(results);
  assert.equal(summary.invoices, goldens.length);
  assert.equal(summary.perfect, goldens.length);
});

test('line match uses PO lines and tolerances', () => {
  const result = matchInvoiceLines(
    [{ sku: 'ARM-1', hsnCode: '998314', quantity: 120, amount: 12480 }],
    { po: 'PO-4500188', received: 120, poTotal: 12480, lines: [{ sku: 'ARM-1', hsnCode: '998314', quantity: 120, amount: 12480 }] },
    { mode: '3-way' }
  );
  assert.equal(result.passed, true);
  assert.equal(result.matchedCount, 1);
});

test('auto-post stays off unless every gate passes', () => {
  const blocked = decideAutoPost({ enabled: false, vendor: { id: 'V-1' }, comparison: { confidence: 99, checks: [] } });
  assert.equal(blocked.eligible, false);
  const open = decideAutoPost({
    enabled: true,
    templateStable: true,
    vendor: { id: 'V-1' },
    duplicate: false,
    extracted: { readable: true },
    comparison: { confidence: 99, checks: [] },
    amount: 100
  });
  assert.equal(open.eligible, true);
  assert.equal(open.autoPosted, false);
});

test('e-invoice JSON skips OCR-shaped parsing', () => {
  const parsed = parseEinvoicePayload({
    irn: 'abc123irn',
    DocNo: 'EINV-1',
    DocDt: '2026-08-01',
    SellerDtls: { LglNm: 'Ajro Private Limited', Gstin: '09AAHCC1095P1Z3' },
    ValDtls: { TotInvVal: 1000, IgstVal: 180 },
    ItemList: [{ HsnCd: '998314', Qty: 1, UnitPrice: 1000, TotAmt: 1000, PrdDesc: 'Service' }]
  });
  const extracted = einvoiceToExtracted(parsed);
  assert.equal(extracted.pipeline.documentType, 'e_invoice');
  assert.equal(extracted.invoiceNumber, 'EINV-1');
  assert.equal(extracted.irn, 'abc123irn');
});
