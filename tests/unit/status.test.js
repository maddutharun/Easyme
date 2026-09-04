const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStatus, isException, isPosted, decorateInvoice, STATUSES } = require('../../backend/src/status');

test('normalizes legacy invoice statuses into a single vocabulary', () => {
  assert.equal(normalizeStatus('Auto-posted'), STATUSES.POSTED);
  assert.equal(normalizeStatus('On hold'), STATUSES.ON_HOLD);
  assert.equal(normalizeStatus('likely_reject'), STATUSES.REJECTED);
  assert.equal(normalizeStatus('pending_vendor_correction'), STATUSES.QUERY_OPEN);
});

test('exception and posted classifiers use canonical statuses', () => {
  assert.equal(isPosted('posted'), true);
  assert.equal(isPosted('ready_to_post'), false);
  assert.equal(isException('pending_review'), true);
  assert.equal(isException('posted'), false);
  assert.equal(decorateInvoice({ id: '1', status: 'Auto-posted' }).status, STATUSES.POSTED);
});
