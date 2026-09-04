const STATUSES = {
  PENDING_REVIEW: 'pending_review',
  READY_TO_POST: 'ready_to_post',
  APPROVED: 'approved',
  POSTED: 'posted',
  ON_HOLD: 'on_hold',
  REJECTED: 'rejected',
  QUERY_OPEN: 'query_open',
  POSTING_FAILED: 'posting_failed'
};

const LEGACY_STATUS_MAP = {
  'auto-posted': STATUSES.POSTED,
  'auto_posted': STATUSES.POSTED,
  posted: STATUSES.POSTED,
  'ready to post': STATUSES.READY_TO_POST,
  ready_to_post: STATUSES.READY_TO_POST,
  approved: STATUSES.APPROVED,
  'needs review': STATUSES.PENDING_REVIEW,
  pending_review: STATUSES.PENDING_REVIEW,
  'on hold': STATUSES.ON_HOLD,
  on_hold: STATUSES.ON_HOLD,
  hold: STATUSES.ON_HOLD,
  'likely_reject': STATUSES.REJECTED,
  'likely reject': STATUSES.REJECTED,
  rejected: STATUSES.REJECTED,
  failed: STATUSES.POSTING_FAILED,
  posting_failed: STATUSES.POSTING_FAILED,
  'query open': STATUSES.QUERY_OPEN,
  query_open: STATUSES.QUERY_OPEN,
  pending_vendor_correction: STATUSES.QUERY_OPEN
};

const EXCEPTION_STATUSES = new Set([
  STATUSES.PENDING_REVIEW,
  STATUSES.ON_HOLD,
  STATUSES.REJECTED,
  STATUSES.QUERY_OPEN,
  STATUSES.POSTING_FAILED
]);

const POSTED_STATUSES = new Set([STATUSES.POSTED]);
const REVIEW_STATUSES = new Set([STATUSES.PENDING_REVIEW, STATUSES.QUERY_OPEN]);

function normalizeStatus(status) {
  const key = String(status || '').trim().toLowerCase();
  return LEGACY_STATUS_MAP[key] || STATUSES.PENDING_REVIEW;
}

function isException(status) {
  return EXCEPTION_STATUSES.has(normalizeStatus(status));
}

function isPosted(status) {
  return POSTED_STATUSES.has(normalizeStatus(status));
}

function isReview(status) {
  return REVIEW_STATUSES.has(normalizeStatus(status));
}

function statusLabel(status) {
  const value = normalizeStatus(status).replaceAll('_', ' ');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function decorateInvoice(invoice) {
  if (!invoice || typeof invoice !== 'object') return invoice;
  const status = normalizeStatus(invoice.status);
  return {
    ...invoice,
    status,
    statusLabel: statusLabel(status),
    isException: EXCEPTION_STATUSES.has(status)
  };
}

module.exports = {
  STATUSES,
  EXCEPTION_STATUSES,
  normalizeStatus,
  isException,
  isPosted,
  isReview,
  statusLabel,
  decorateInvoice
};
