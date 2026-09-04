const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { publicInvoice, isPathInsideRoot } = require('../../backend/src/services/public-invoice');
const { collectExceptionReasons } = require('../../backend/src/services/exception-reasons.service');
const { validateFileSignature } = require('../../backend/src/services/file-security.service');
const { extractLineItemsFromLayout } = require('../../backend/src/services/line-item-extraction.service');

test('publicInvoice never returns storagePath', () => {
  const view = publicInvoice({ id: 'INV-1', storagePath: '/etc/passwd', fileName: 'a.pdf' });
  assert.equal(view.storagePath, undefined);
  assert.equal(view.hasFile, true);
  assert.equal(view.id, 'INV-1');
});

test('file paths cannot escape the upload root', () => {
  const root = path.resolve('/workspace/uploads');
  assert.equal(isPathInsideRoot(path.join(root, 'a.pdf'), root), true);
  assert.equal(isPathInsideRoot('/etc/passwd', root), false);
});

test('exception reasons include duplicate and unknown vendor', () => {
  const reasons = collectExceptionReasons({
    extracted: { readable: false, invoiceNumber: 'A-1', vendor: 'Acme' },
    comparison: { checks: [{ name: 'PO', passed: false, detail: 'Purchase order not found in ERP' }] },
    duplicate: true,
    vendor: null,
    invoices: [{ invoiceNumber: 'A-1', vendor: 'Acme' }]
  });
  assert.ok(reasons.some((reason) => /duplicate/i.test(reason)));
  assert.ok(reasons.some((reason) => /not readable/i.test(reason)));
});

test('xls OLE compound files pass signature checks', () => {
  const buffer = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(16)]);
  const result = validateFileSignature({ originalname: 'legacy.xls', buffer });
  assert.equal(result.valid, true);
});

test('layout line items recover numbered HSN rows', () => {
  const items = extractLineItemsFromLayout({
    pages: [{
      rows: [{
        items: [
          { text: '1.' },
          { text: 'Consulting' },
          { text: '998314' },
          { text: '2' },
          { text: '100.00' },
          { text: '200.00' }
        ]
      }]
    }]
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].hsnCode, '998314');
});

test('protected ops APIs require a session', async () => {
  const app = require('../../backend/app');
  await app.ready;
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const build = await fetch(`http://127.0.0.1:${port}/__build`);
    const buildJson = await build.json();
    assert.equal(buildJson.build, 'premium-login');
    assert.equal(buildJson.demo, undefined);

    const obs = await fetch(`http://127.0.0.1:${port}/api/observability`);
    assert.equal(obs.status, 401);

    const queue = await fetch(`http://127.0.0.1:${port}/api/queue`);
    assert.equal(queue.status, 401);

    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
