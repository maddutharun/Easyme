const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFileSignature } = require('../../backend/src/services/file-security.service');
const { decideAutoPost } = require('../../backend/src/services/auto-post.service');
const { generateRecommendation } = require('../../backend/services/invoice-engine');

test('JSON e-invoice signatures are accepted', () => {
  const result = validateFileSignature({
    originalname: 'irn.json',
    buffer: Buffer.from('{"irn":"abc","invoiceNumber":"EINV-1"}')
  });
  assert.equal(result.valid, true);
});

test('posted invoices can inform GL recommendation without changing seed PO history', () => {
  const recommendation = generateRecommendation(
    { vendor: 'Northstar Office Co.', amount: 500, hsnCode: '998314', description: 'Monitor arms' },
    {
      vendors: [{ id: 'V-1042', name: 'Northstar Office Co.' }],
      transactions: [],
      postedInvoices: [{
        status: 'posted',
        vendor: 'Northstar Office Co.',
        vendorId: 'V-1042',
        amount: 500,
        description: 'Monitor arms',
        hsnCode: '998314',
        aiRecommendation: { glAccount: '640020', costCenter: 'IT009', taxCode: 'GST18' }
      }]
    }
  );
  assert.equal(recommendation.glAccount, '640020');
  assert.equal(recommendation.costCenter, 'IT009');
});

test('config exposes auto-post execute as false by default', async () => {
  const app = require('../../backend/app');
  await app.ready;
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/config`);
    const payload = await response.json();
    assert.equal(payload.autoPost.execute, false);
    assert.equal(payload.autoPost.enabled, false);
    assert.equal(payload.sso.enabled, false);
    const sso = await fetch(`http://127.0.0.1:${port}/api/auth/sso`, { redirect: 'manual' });
    assert.equal(sso.status, 404);
    const evalRes = await fetch(`http://127.0.0.1:${port}/api/eval/extraction`);
    assert.equal(evalRes.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('auto-post execute remains a separate flag from eligibility', () => {
  const decision = decideAutoPost({
    enabled: true,
    templateStable: true,
    vendor: { id: 'V-1' },
    extracted: { readable: true },
    comparison: { confidence: 99, checks: [] },
    amount: 100
  });
  assert.equal(decision.eligible, true);
  assert.equal(decision.autoPosted, false);
});
