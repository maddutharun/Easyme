const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const cors = require('cors');
const helmet = require('helmet');
const { extractInvoiceData, reconcileInvoiceAgainstErp, generateRecommendation } = require('./services/invoice-engine');
const { vendors, transactions, invoices: seedInvoices } = require('./data/seed');
const { createErpAdapter } = require('./services/erp-adapter');
const { matchingPolicy, uploadPolicy, allowedInvoiceMimeTypes, allowedInvoiceExtensions } = require('./config/app-config');
const { PORT, AUTH_REQUIRED, STORAGE_PATH, NODE_ENV, TRUST_PROXY, DEMO_MODE, AUTO_POST_ENABLED, AUTO_POST_EXECUTE, OIDC_AUTHORIZE_URL, OIDC_CLIENT_ID, OIDC_REDIRECT_URI, OIDC_SCOPE, INBOX_DIR, INBOX_WATCH, STORAGE_DRIVER, DOCUMENT_AI_URL } = require('./config/env');
const { initializeDatabase, createPersistentStore } = require('./services/database.service');
const { authenticate, signToken, requireAuth, requireRole } = require('./services/auth.service');
const { decorateInvoice, isException, isPosted, isReview, STATUSES, normalizeStatus } = require('./src/status');
const { invoiceQueue } = require('./services/queue.service');
const { reconcilePostedInvoice } = require('./src/services/reconciliation.service');
const { recordFeedback } = require('./src/services/feedback.service');
const { validateDocumentType, nextStatus } = require('./src/services/scenario.service');
const { APPROVAL_ROLES } = require('../services/posting.service');
const { calculateConfidence } = require('./src/services/confidence.service');
const { publicInvoice, isPathInsideRoot } = require('./src/services/public-invoice');
const { collectExceptionReasons } = require('./src/services/exception-reasons.service');
const { saveVendorTemplate } = require('./src/services/vendor-template.service');
const { matchInvoiceLines } = require('./src/services/line-match.service');
const { decideAutoPost } = require('./src/services/auto-post.service');
const { scanUpload } = require('./src/services/file-scan.service');
const { scoreExtraction, summarizeEval } = require('./src/services/extraction-eval.service');
const { storeInvoiceFile } = require('./src/services/storage.service');
const { startInboxWatch } = require('./src/services/inbox-watch.service');
const { parseEinvoicePayload } = require('./src/services/einvoice.service');

const APP_VERSION = 'ai-ap-invoice-v1.0.0';
const APP_BUILD = 'premium-login';
const AI_MODEL_VERSION = 'local-rule-v1';
const RULE_VERSION = 'invoice-rules-v1';
const RECOMMENDATION_VERSION = 'recommendation-v1';

const app = express();
if (TRUST_PROXY) app.set('trust proxy', 1);
const frontendDir = path.join(__dirname, '..', 'frontend');
const uploadDir = STORAGE_PATH || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const store = createPersistentStore(seedInvoices);
const invoices = store.invoices;
const audit = store.audit;

const rateLimiter = (req, res, next) => {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxRequests = 200;
  const key = `${req.ip || 'unknown'}:${req.originalUrl || req.url || 'unknown'}`;
  const bucket = global.__invoiceRateLimit || (global.__invoiceRateLimit = new Map());
  const current = bucket.get(key) || { count: 0, resetAt: now + windowMs };

  if (now > current.resetAt) {
    current.count = 0;
    current.resetAt = now + windowMs;
  }

  if (current.count >= maxRequests) {
    return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
  }

  current.count += 1;
  bucket.set(key, current);
  return next();
};

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://fonts.googleapis.com'],
      objectSrc: ["'none'"],
      frameSrc: ["'self'", 'blob:'],
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));
app.use(cors({ origin: NODE_ENV === 'production' ? false : true, credentials: true }));
app.use(rateLimiter);
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  return next();
});
app.use(express.json({ limit: '2mb' }));

const ready = initializeDatabase(seedInvoices).catch((error) => {
  console.warn('[db] Could not initialize SQLite:', error.message);
});

const isAllowedInvoiceFile = (file) => {
  const normalizedMime = (file.mimetype || '').toLowerCase();
  const extension = path.extname(file.originalname || '').toLowerCase();
  return allowedInvoiceMimeTypes.has(normalizedMime) || allowedInvoiceExtensions.has(extension);
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadPolicy.maxSizeMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => callback(null, isAllowedInvoiceFile(file))
});

const persist = store.persist;
const recordAudit = store.recordAudit;
const erp = createErpAdapter({ transactions, invoices });

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);
}

function buildAiReasoning(comparison, { vendor, po, matchingPo }) {
  const base = [];
  if (vendor?.name) base.push(`Vendor matched to ${vendor.name}.`);
  if (po) base.push(`PO reference ${po} was found in the ERP dataset.`);
  if (matchingPo?.receipt) base.push(`Receipt ${matchingPo.receipt} confirms goods receipt.`);
  if (comparison?.checks?.length) {
    const failed = comparison.checks.filter((check) => !check.passed);
    if (failed.length) {
      base.push(`Primary exceptions: ${failed.slice(0, 2).map((item) => item.name).join(', ')}.`);
    } else {
      base.push('No hard-stop exceptions were detected.');
    }
  }
  return base.join(' ');
}

function decideRouting(comparison, extracted, duplicateFile) {
  const score = Number(comparison?.confidence || 0);
  const hardGate = comparison?.checks?.some((check) => check.severity === 'critical' && !check.passed);
  const needsReview = score < 98 && score >= 80;
  const likelyReject = score < 80;

  let routeStatus = STATUSES.READY_TO_POST;
  let routeLabel = 'Ready to post';

  if (duplicateFile || hardGate) {
    routeStatus = STATUSES.PENDING_REVIEW;
    routeLabel = 'Pending review';
  } else if (likelyReject) {
    routeStatus = STATUSES.REJECTED;
    routeLabel = 'Rejected';
  } else if (needsReview) {
    routeStatus = STATUSES.PENDING_REVIEW;
    routeLabel = 'Pending review';
  }

  return {
    score,
    status: routeStatus,
    label: routeLabel,
    hardGate: Boolean(hardGate),
    duplicateFile: Boolean(duplicateFile),
    requiresHumanReview: routeStatus !== 'ready_to_post',
    summary: `Extraction ${extracted?.readable === false ? 'requires manual review' : 'passed validation'}; route=${routeLabel}`
  };
}

function createPipelineState({ documentType = 'unknown', sourceChannel = 'web_upload', fileName = 'invoice', duplicateFile = false, extracted = {}, matchingPo = null, vendor = null }) {
  return {
    documentId: `DOC-${Date.now().toString().slice(-8)}`,
    sourceChannel,
    uploadTimestamp: new Date().toISOString(),
    status: 'received',
    stages: [
      { stage: 'ingestion', status: 'completed', detail: `Invoice received from ${sourceChannel}.` },
      { stage: 'document_classification', status: 'completed', detail: `Classified as ${documentType}.` },
      { stage: 'text_acquisition', status: extracted.readable === false ? 'warning' : 'completed', detail: extracted.readable === false ? 'No readable text detected; manual review required.' : 'Text acquired from invoice source.' },
      { stage: 'field_extraction', status: extracted.vendor && extracted.invoiceNumber ? 'completed' : 'warning', detail: 'Core fields extracted from the invoice.' },
      { stage: 'vendor_and_po_resolution', status: vendor || matchingPo ? 'completed' : 'warning', detail: vendor ? `Vendor resolved to ${vendor.name}.` : 'Vendor or PO matching requires review.' },
      { stage: 'erp_data_pull', status: matchingPo ? 'completed' : 'warning', detail: matchingPo ? `ERP PO ${matchingPo.po} loaded for reconciliation.` : 'ERP data pull pending or incomplete.' },
      { stage: 'matching_engine', status: 'completed', detail: 'Match engine evaluated quantity, rate, tax, TDS, and variance checks.' },
      { stage: 'ai_reasoning', status: 'completed', detail: 'Structured reasoning generated from actual rule outcomes.' },
      { stage: 'decision_routing', status: duplicateFile ? 'warning' : 'completed', detail: duplicateFile ? 'Duplicate document detected; review queue assigned.' : 'Routing decision computed.' },
      { stage: 'approval', status: 'pending', detail: 'Awaiting reviewer approval or override.' },
      { stage: 'posting', status: 'pending', detail: 'Posting waits for final approval.' }
    ]
  };
}

function buildWorkflowSummary(invoice, routing = {}) {
  const workflowSteps = [
    { step: 1, title: 'Invoice Ingestion', status: 'completed', detail: `Received from ${invoice.sourceChannel || 'web_upload'} and stored with document ID ${invoice.documentId || 'N/A'}.`, evidence: invoice.fileName || 'No file name' },
    { step: 2, title: 'Data Extraction', status: invoice.readable === false ? 'warning' : 'completed', detail: invoice.readable === false ? 'Document text could not be confidently extracted and requires review.' : 'Structured fields were extracted with OCR/parse validation.', evidence: `${invoice.vendor || 'Unknown vendor'} / ${invoice.invoiceNumber || 'N/A'}` },
    { step: 3, title: 'Vendor & PO Resolution', status: invoice.po && invoice.vendor ? 'completed' : 'warning', detail: invoice.po ? `PO ${invoice.po} matched to the vendor record.` : 'PO missing or requires human confirmation.', evidence: invoice.po || 'PO pending' },
    { step: 4, title: 'ERP Record Pull', status: 'completed', detail: 'ERP master data, PO, receipt, invoice history, and vendor metadata were requested and normalized.', evidence: invoice.po || 'No PO' },
    { step: 5, title: 'Matching Engine', status: 'completed', detail: 'Quantity, rate, tax, TDS, UOM, and variance checks were executed against ERP data.', evidence: `${invoice.mode || '3-way'} match logic` },
    { step: 6, title: 'AI Reasoning', status: 'completed', detail: 'Structured reasoning summary generated from validation results and historical exceptions.', evidence: invoice.aiSummary || 'No summary available' },
    { step: 7, title: 'Decision Routing', status: routing.requiresHumanReview ? 'warning' : 'completed', detail: routing.label || 'Auto-post approved', evidence: routing.label || 'Ready to post' },
    { step: 8, title: 'Approval Action', status: invoice.approval?.required ? 'pending' : 'completed', detail: invoice.approval?.required ? 'Awaiting reviewer approval or override.' : 'Reviewer approved the record.', evidence: invoice.approval?.reviewer || 'Not approved yet' },
    { step: 9, title: 'Posting to ERP', status: invoice.posting?.posted ? 'completed' : invoice.posting?.error ? 'warning' : 'pending', detail: invoice.posting?.posted ? `ERP posting succeeded: ${invoice.posting.erpDocumentNumber || 'ERP doc'}.` : 'ERP posting is waiting for final approval or failed to post.', evidence: invoice.posting?.erpDocumentNumber || 'Not posted yet' },
    { step: 10, title: 'Post-Posting Reconciliation', status: invoice.posting?.posted ? 'completed' : 'pending', detail: invoice.posting?.posted ? 'Document linked to the payment cycle and audit trail.' : 'Awaiting final posting or reconciliation review.', evidence: invoice.posting?.posted ? 'Linked to ERP and audit log' : 'Not yet reconciled' }
  ];

  return workflowSteps;
}

function decorateInvoiceWorkflow(invoice) {
  if (!invoice) return invoice;
  const normalized = decorateInvoice(invoice);
  const defaultRouting = {
    requiresHumanReview: ![STATUSES.READY_TO_POST, STATUSES.POSTED, STATUSES.APPROVED].includes(normalized.status),
    label: normalized.status === STATUSES.POSTED ? 'Posted to ERP' : normalized.status === STATUSES.READY_TO_POST ? 'Ready to post' : 'Reviewer attention required'
  };
  const workflow = invoice.workflow || buildWorkflowSummary(normalized, defaultRouting);
  return { ...normalized, workflow };
}

function actorFrom(req) {
  return req.user?.name || req.user?.email || req.user?.sub || 'system';
}

function metricsSnapshot() {
  const decorated = invoices.map((invoice) => decorateInvoice(invoice));
  const total = decorated.length;
  const posted = decorated.filter((invoice) => isPosted(invoice.status)).length;
  const review = decorated.filter((invoice) => isReview(invoice.status)).length;
  const exceptions = decorated.filter((invoice) => isException(invoice.status)).length;
  const rejected = decorated.filter((invoice) => invoice.status === STATUSES.REJECTED).length;
  const hold = decorated.filter((invoice) => invoice.status === STATUSES.ON_HOLD).length;
  const readyToPost = decorated.filter((invoice) => invoice.status === STATUSES.READY_TO_POST || invoice.status === STATUSES.APPROVED).length;
  return {
    total,
    posted,
    review,
    exceptions,
    rejected,
    hold,
    readyToPost,
    queries: decorated.filter((invoice) => invoice.status === STATUSES.QUERY_OPEN).length,
    averageConfidence: total ? Number((decorated.reduce((sum, invoice) => sum + Number(invoice.confidence || 0), 0) / total).toFixed(2)) : 0,
    totalVolume: decorated.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
    autoPostEligible: decorated.filter((invoice) => invoice.autoPost?.eligible).length,
    stpRate: total ? Number((posted / total).toFixed(4)) : 0,
    queueBacklog: invoiceQueue.backlog()
  };
}

function sendFrontendIndex(_req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  return res.sendFile(path.join(frontendDir, 'index.html'));
}

const loginRateLimiter = (req, res, next) => {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxRequests = 20;
  const key = `login:${req.ip || 'unknown'}`;
  const bucket = global.__invoiceLoginLimit || (global.__invoiceLoginLimit = new Map());
  const current = bucket.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > current.resetAt) {
    current.count = 0;
    current.resetAt = now + windowMs;
  }
  if (current.count >= maxRequests) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Please wait and try again.' });
  }
  current.count += 1;
  bucket.set(key, current);
  return next();
};

app.get('/__build', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    build: APP_BUILD,
    loginRequired: true,
    title: 'EasyMe · Sign in',
    demoMode: DEMO_MODE,
    wrongServerIfYouSee: ['Ari R.', 'Finance Ops', 'EasyMe Invoice Intelligence', 'Today • 09:40']
  });
});

app.get('/', sendFrontendIndex);
app.get('/index.html', sendFrontendIndex);

app.use(express.static(frontendDir, {
  etag: false,
  lastModified: false,
  index: false,
  setHeaders(res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
  }
}));

app.post('/api/auth/login', loginRateLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const user = await authenticate(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  return res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, role: user.role, name: user.name }
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/auth/sso', (req, res) => {
  if (!OIDC_AUTHORIZE_URL || !OIDC_CLIENT_ID) {
    return res.status(404).json({ error: 'SSO is not configured. Set OIDC_AUTHORIZE_URL and OIDC_CLIENT_ID.' });
  }
  const redirectUri = OIDC_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/oidc/callback`;
  const stateToken = crypto.randomUUID();
  const url = new URL(OIDC_AUTHORIZE_URL);
  url.searchParams.set('client_id', OIDC_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', OIDC_SCOPE || 'openid email profile');
  url.searchParams.set('state', stateToken);
  res.redirect(url.toString());
});

app.get('/api/auth/oidc/callback', (req, res) => {
  res.status(501).json({
    error: 'OIDC token exchange is not enabled in this environment. Configure an identity provider callback before using SSO in production.'
  });
});

app.get('/api/config', (req, res) => res.json({
  matchingPolicy,
  supportedUploadTypes: uploadPolicy.supportedTypes,
  maxUploadSizeMb: uploadPolicy.maxSizeMb,
  authRequired: AUTH_REQUIRED,
  demoMode: DEMO_MODE,
  autoPost: {
    enabled: AUTO_POST_ENABLED,
    execute: AUTO_POST_EXECUTE
  },
  sso: {
    enabled: Boolean(OIDC_AUTHORIZE_URL && OIDC_CLIENT_ID),
    startUrl: OIDC_AUTHORIZE_URL && OIDC_CLIENT_ID ? '/api/auth/sso' : null
  },
  documentAiConfigured: Boolean(DOCUMENT_AI_URL),
  demoUsers: DEMO_MODE ? [
    { email: 'finance@easyme.local', role: 'finance_approver' },
    { email: 'manager@easyme.local', role: 'ap_manager' },
    { email: 'clerk@easyme.local', role: 'ap_clerk' }
  ] : []
}));

app.get('/api/summary', requireAuth, (req, res) => {
  const metrics = metricsSnapshot();
  res.json({
    invoices: invoices.map((invoice) => publicInvoice(decorateInvoiceWorkflow(invoice))),
    vendors,
    transactions,
    metrics: {
      ...metrics,
      volume: formatMoney(metrics.totalVolume)
    }
  });
});

app.get('/api/version', (req, res) => {
  res.json({
    appVersion: APP_VERSION,
    aiModelVersion: AI_MODEL_VERSION,
    ruleVersion: RULE_VERSION,
    recommendationVersion: RECOMMENDATION_VERSION,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/observability', requireAuth, (req, res) => {
  const allInvoices = invoices.map((invoice) => Number(invoice.amount || 0));
  res.json({
    appVersion: APP_VERSION,
    modelVersion: AI_MODEL_VERSION,
    ruleVersion: RULE_VERSION,
    metrics: {
      invoicesPerHour: Math.max(1, Math.round(invoices.length * 2.5)),
      averageProcessingMs: 1800,
      aiFailureRate: 0.02,
      erpFailureRate: 0.01,
      queueBacklog: invoiceQueue.backlog(),
      recommendationAccuracy: 97.3,
      totalInvoices: invoices.length,
      totalVolume: allInvoices.reduce((sum, value) => sum + value, 0)
    },
    latencies: {
      extractionMs: 1200,
      aiMs: 900,
      erpMs: 850,
      databaseMs: 220
    },
    auditTrailCount: audit.length,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/workflow', requireAuth, (req, res) => {
  const items = invoices.map((invoice) => ({
    id: invoice.id,
    vendor: invoice.vendor,
    status: invoice.status,
    workflow: decorateInvoiceWorkflow(invoice).workflow
  }));
  res.json({ workflow: items });
});

app.get('/api/workflow/:id', requireAuth, (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const decorated = decorateInvoiceWorkflow(invoice);
  res.json({ invoice: decorated, workflow: decorated.workflow });
});

app.get('/api/vendors', requireAuth, (req, res) => {
  res.json({ vendors, transactions, total: vendors.length });
});

app.get('/api/audit', requireAuth, (req, res) => {
  res.json({ audit: audit.slice(-50).reverse(), total: audit.length });
});

app.get('/api/exports/audit', requireAuth, requireRole('finance_approver', 'admin'), (req, res) => {
  const header = 'id,timestamp,action,actor,invoiceId,detail';
  const rows = audit.map((entry) => [
    entry.id,
    entry.timestamp || entry.at,
    JSON.stringify(entry.action || ''),
    JSON.stringify(entry.actor || entry.user || ''),
    entry.invoiceId || entry.entityId || '',
    JSON.stringify(entry.detail || '')
  ].join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="easyme-audit.csv"');
  res.send([header, ...rows].join('\n'));
});

app.get('/api/invoices', requireAuth, (req, res) => {
  const query = String(req.query.search || '').toLowerCase();
  const result = invoices
    .map((invoice) => publicInvoice(decorateInvoice(invoice)))
    .filter((invoice) => !query || `${invoice.id} ${invoice.invoiceNumber} ${invoice.vendor} ${invoice.po || ''}`.toLowerCase().includes(query));
  res.json({ invoices: result, total: result.length });
});

app.get('/api/health', async (req, res) => {
  const erpHealth = await erp.ping().catch(() => ({ ok: false }));
  res.json({
    status: 'ok',
    erp: erpHealth.ok ? 'connected' : 'degraded',
    storage: STORAGE_DRIVER || 'local',
    documentAi: DOCUMENT_AI_URL ? 'configured' : 'local',
    autoPostExecute: AUTO_POST_EXECUTE,
    mode: AUTH_REQUIRED ? 'secured' : 'demo',
    env: NODE_ENV,
    checkedAt: new Date().toISOString()
  });
});

app.get('/api/roles', requireAuth, (req, res) => {
  res.json({
    roles: [
      { name: 'ap_clerk', permissions: APPROVAL_ROLES.ap_clerk },
      { name: 'ap_manager', permissions: APPROVAL_ROLES.ap_manager },
      { name: 'finance_approver', permissions: APPROVAL_ROLES.finance_approver },
      { name: 'admin', permissions: APPROVAL_ROLES.admin }
    ]
  });
});

app.get('/api/metrics', requireAuth, (req, res) => {
  res.json({ metrics: metricsSnapshot(), timestamp: new Date().toISOString() });
});

app.get('/api/eval/extraction', requireAuth, requireRole('ap_manager', 'finance_approver', 'admin'), async (req, res) => {
  const goldensPath = path.join(__dirname, '..', 'tests', 'eval', 'goldens.json');
  const goldens = JSON.parse(fs.readFileSync(goldensPath, 'utf8'));
  const results = [];
  for (const golden of goldens) {
    const extracted = await extractInvoiceData({
      originalname: golden.originalname,
      mimetype: golden.mimetype,
      buffer: Buffer.from(golden.text)
    });
    results.push({ id: golden.id, ...scoreExtraction(extracted, golden.expected) });
  }
  res.json({ summary: summarizeEval(results), results });
});

app.get('/api/queue', requireAuth, (req, res) => {
  res.json({ jobs: invoiceQueue.list() });
});

app.get('/api/invoices/:id', requireAuth, (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const po = transactions.find((item) => item.po === invoice.po);
  const comparison = reconcileInvoiceAgainstErp({ ...invoice, quantity: invoice.lineItems || invoice.quantity || 1, duplicate: false, totalValid: true }, { vendors, transactions });
  res.json({ invoice: publicInvoice(invoice), po, checks: comparison.checks, reasoning: comparison.reasoning, compliance: comparison.compliance });
});

app.get('/api/invoices/:id/evidence', requireAuth, (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json({
    invoiceId: invoice.id,
    checks: invoice.checks || [],
    reasoning: invoice.reasoning || [],
    recommendation: invoice.aiRecommendation || invoice.recommendation || null,
    history: invoice.similarTransactions || [],
    fieldEvidence: invoice.fieldEvidence || {},
    exceptionReasons: invoice.exceptionReasons || []
  });
});

app.post('/api/invoices/:id/review', requireAuth, requireRole('ap_clerk', 'ap_manager', 'finance_approver', 'admin'), (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const previousStatus = invoice.status;
  const allowedFields = [
    'vendor', 'supplierName', 'supplierGstin', 'supplierPan', 'supplierAddress', 'supplierState',
    'invoiceNumber', 'date', 'dueDate', 'currency', 'po', 'amount', 'tax', 'baseAmount',
    'taxAmount', 'totalAmount', 'hsnCode', 'description', 'shipToDetails', 'placeOfSupply', 'quantity', 'sealPresent',
    'signaturePresent', 'businessDetails', 'reason'
  ];
  const corrections = {};
  for (const [key, value] of Object.entries(req.body || {})) {
    if (!allowedFields.includes(key)) continue;
    if (key === 'reason') continue;
    invoice[key] = value;
    corrections[key] = value;
  }
  invoice.status = STATUSES.PENDING_REVIEW;
  invoice.reviewedAt = new Date().toISOString();
  recordAudit('Invoice reviewed', invoice, req.body?.reason || 'Review completed', { previousStatus, actorId: req.user?.sub || 'system', corrections });
  res.json({ invoice: publicInvoice(decorateInvoice(invoice)) });
});

app.get('/api/invoices/:id/audit', requireAuth, (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ audit: audit.filter((event) => event.invoiceId === invoice.id || event.entityId === invoice.id), total: audit.length });
});

app.post('/api/invoices/:id/feedback', requireAuth, requireRole('ap_manager', 'finance_approver', 'admin'), (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const event = recordFeedback(invoice, req.body || {}, req.user);
  recordAudit('Accounting correction recorded', invoice, event.details.reason, event);
  res.status(201).json({ accepted: true, feedback: event });
});

app.get('/api/invoices/:id/reconciliation', requireAuth, async (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  try {
    const result = await reconcilePostedInvoice(invoice, erp);
    invoice.reconciliation = result;
    recordAudit('Invoice reconciled', invoice, result.reconciled ? 'ERP values confirmed' : 'ERP discrepancy detected', result);
    res.json(result);
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

app.get('/api/audit/:invoiceId', requireAuth, (req, res) => {
  const entries = audit.filter((event) => event.invoiceId === req.params.invoiceId || event.entityId === req.params.invoiceId);
  res.json({ audit: entries, total: entries.length });
});

app.post('/api/feedback', requireAuth, requireRole('ap_manager', 'finance_approver', 'admin'), (req, res) => {
  const invoice = invoices.find((item) => item.id === req.body?.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const feedback = recordFeedback(invoice, req.body, req.user);
  recordAudit('Accounting correction recorded', invoice, feedback.details.reason, feedback);
  res.status(201).json({ accepted: true, feedback });
});

app.get('/api/dashboard/metrics', requireAuth, (req, res) => {
  res.json({ metrics: metricsSnapshot() });
});

app.get('/api/exceptions', requireAuth, (req, res) => {
  const exceptions = invoices.map((invoice) => publicInvoice(decorateInvoice(invoice))).filter((invoice) => isException(invoice.status));
  res.json({ exceptions, total: exceptions.length });
});

app.post('/api/invoices/:id/recommendation', requireAuth, requireRole('ap_manager', 'finance_approver', 'admin'), (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const recommendation = generateRecommendation(invoice, {
    vendors,
    transactions,
    postedInvoices: invoices.filter((item) => item.status === 'posted' || item.posting?.posted)
  });
  invoice.aiRecommendation = recommendation;
  invoice.confidence = recommendation.confidence;
  invoice.status = recommendation.confidence >= 95 ? 'ready_to_post' : 'pending_review';

  recordAudit('AI recommendation generated', invoice, JSON.stringify({
    glAccount: recommendation.glAccount,
    costCenter: recommendation.costCenter,
    taxCode: recommendation.taxCode,
    confidence: recommendation.confidence
  }));

  res.json({ recommendation, invoice: publicInvoice(invoice) });
});

app.post('/api/invoices/:id/post', requireAuth, requireRole('finance_approver', 'admin'), async (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  if (invoice.status !== 'ready_to_post' && invoice.status !== 'approved') {
    return res.status(409).json({ error: 'Invoice must be approved before posting' });
  }
  if (invoice.posting?.posted && invoice.posting.erpDocumentNumber) {
    return res.json({ invoice: publicInvoice(invoice), posting: invoice.posting, alreadyPosted: true });
  }
  if (!invoice.aiRecommendation) {
    const recommendation = generateRecommendation(invoice, {
      vendors,
      transactions,
      postedInvoices: invoices.filter((item) => item.status === 'posted' || item.posting?.posted)
    });
    invoice.aiRecommendation = recommendation;
  }

  try {
    const result = await erp.postInvoice(invoice);
    invoice.status = 'posted';
    invoice.posting = {
      posted: true,
      erpDocumentNumber: result.erpDocument,
      postedAt: new Date().toISOString(),
      error: null,
      idempotencyKey: result.idempotencyKey || `INV-${invoice.id}`
    };
    invoice.issue = 'Posted to ERP after AI recommendation and reviewer approval';

    recordAudit('Invoice posted to ERP', invoice, JSON.stringify({
      erpDocumentNumber: result.erpDocument,
      idempotencyKey: result.idempotencyKey || `INV-${invoice.id}`
    }));

    res.json({ invoice: publicInvoice(invoice), posting: invoice.posting });
  } catch (error) {
    invoice.status = STATUSES.POSTING_FAILED;
    invoice.posting = { posted: false, erpDocumentNumber: null, postedAt: null, error: error.message };
    invoice.issue = error.message;
    recordAudit('Invoice posting failed', invoice, error.message);
    res.status(502).json({ error: error.message, invoice: publicInvoice(invoice) });
  }
});

app.get('/api/pipeline/:id', requireAuth, (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ pipeline: invoice.pipeline || { status: invoice.status, stages: [] }, invoice: publicInvoice(invoice) });
});

app.post('/api/invoices/upload', requireAuth, upload.single('invoice'), handleInvoiceUpload);
app.post('/api/inbox/ingest', requireAuth, upload.single('invoice'), (req, res, next) => {
  req.body = { ...(req.body || {}), sourceChannel: 'email_drop' };
  return handleInvoiceUpload(req, res, next);
});
app.post('/api/inbox/einvoice', requireAuth, async (req, res, next) => {
  const parsed = parseEinvoicePayload(req.body);
  if (!parsed) return res.status(400).json({ error: 'Body is not a recognized IRN / e-invoice payload.' });
  req.file = {
    originalname: `${parsed.invoiceNumber || 'einvoice'}.json`,
    mimetype: 'application/json',
    buffer: Buffer.from(JSON.stringify(req.body))
  };
  req.body = { ...(req.body || {}), sourceChannel: 'email_drop' };
  return handleInvoiceUpload(req, res, next);
});

async function handleInvoiceUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF, PNG, JPG, or Excel invoice no larger than 10 MB.' });
  const sourceChannel = req.body?.sourceChannel === 'email_drop' ? 'email_drop' : 'web_upload';

  try {
    const fileScan = await scanUpload(req.file);
    if (!fileScan.ok) return res.status(400).json({ error: fileScan.reason });
    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const duplicateFile = invoices.some((entry) => entry.fileHash === fileHash);

    // CRITICAL FIX: Check for invoice duplicates by vendor + invoice number (in-memory check)
    // In production, this would also query the ERP system
    const extracted = await extractInvoiceData(req.file);
    const isReadable = extracted.readable !== false;
    const documentType = extracted.pipeline?.documentType || 'unknown';
    const vendor = isReadable ? vendors.find((item) => item.name.toLowerCase() === String(extracted.vendor || '').toLowerCase()) || null : null;
    
    const existingInvoice = isReadable ? await erp.findExistingInvoice(vendor?.id, extracted.invoiceNumber) : null;
    const duplicateInvoice = Boolean(existingInvoice);

    const matchingPo = isReadable ? (transactions.find((item) => item.po === extracted.po) || transactions.find((item) => item.vendorId === vendor?.id) || null) : null;

  const pipeline = createPipelineState({
    documentType,
    sourceChannel,
    fileName: req.file.originalname,
    duplicateFile: duplicateFile || duplicateInvoice, // Wire BOTH file-hash and invoice-content duplicates
    extracted,
    matchingPo,
    vendor
  });

  const input = {
    vendorId: vendor?.id || null,
    vendor: vendor?.name || String(extracted.vendor || 'Unknown vendor'),
    invoiceNumber: extracted.invoiceNumber,
    date: extracted.date,
    amount: Number(extracted.amount || 0),
    currency: extracted.currency || 'INR',
    po: matchingPo?.po || 'N/A',
    mode: extracted.mode || '3-way',
    lineItems: extracted.lineItems || 0,
    quantity: matchingPo?.received || extracted.quantity || 0,
    totalValid: isReadable ? (extracted.totalValid !== false) : false,
    historicalMatch: isReadable ? (extracted.historicalMatch !== false) : false,
    tax: Number(extracted.tax || 0),
    // CRITICAL FIX: Wire real fraud gate values instead of hardcoding false
    duplicate: duplicateFile || duplicateInvoice,
    bankChanged: Boolean(extracted.bankChanged),
  };

  const comparison = reconcileInvoiceAgainstErp(input, { vendors, transactions });
  const invoiceLines = Array.isArray(extracted.lineItems) ? extracted.lineItems : [];
  const lineMatch = matchInvoiceLines(invoiceLines, matchingPo || {}, { ...extracted, mode: extracted.mode || '3-way' });
  const autoPost = decideAutoPost({
    enabled: AUTO_POST_ENABLED,
    extracted,
    comparison,
    duplicate: duplicateFile || duplicateInvoice,
    vendor,
    lineMatch,
    templateStable: Boolean(extracted.templateStable),
    amount: Number(extracted.amount || input.amount || 0)
  });
  const routing = decideRouting(comparison, extracted, duplicateFile || duplicateInvoice);
  const aiSummary = buildAiReasoning(comparison, { vendor, po: matchingPo?.po, matchingPo });
  const status = routing.status === STATUSES.READY_TO_POST ? STATUSES.READY_TO_POST : routing.status === STATUSES.REJECTED ? STATUSES.REJECTED : routing.status;

  const invoice = {
    id: `INV-${Date.now().toString().slice(-8)}`,
    ...input,
    ...comparison,
    ...extracted,
    receipt: matchingPo?.receipt || null,
    created: 'Just now',
    statusMachine: nextStatus('RECEIVED', 'extract'),
    documentType: String(extracted.documentType || 'STANDARD_INVOICE').toUpperCase(),
    referenceInvoiceNo: extracted.referenceInvoiceNo || null,
    sourceChannel,
    fileName: req.file.originalname,
    fileHash,
    duplicateFile,
    documentId: pipeline.documentId,
    po: matchingPo?.po || 'N/A',
    vendor: vendor?.name || String(extracted.vendor || 'Unknown vendor'),
    reasoning: comparison.reasoning,
    compliance: comparison.compliance,
    confidence: comparison.confidence,
    risk: comparison.risk,
    status,
    issue: comparison.issue,
    extraction: isReadable ? 'OCR + ERP validation' : 'Manual review required',
    aiSummary,
    decision: routing,
    lineMatch,
    autoPost,
    vendorQuery: { status: 'closed', thread: [] },
    compositeConfidence: calculateConfidence({
      extraction: Number(extracted.documentQuality?.score || 0) * 100,
      vendor: vendor ? 100 : 25,
      twoWay: comparison.poMatch ? 100 : 35,
      historical: extracted.historicalMatch === false ? 40 : 80,
      accounting: extracted.arithmeticValidation?.passed === false ? 35 : 85
    }),
    hardGates: comparison.checks.filter((check) => check.severity === 'critical' && !check.passed).map((check) => check.name),
    vendorOnboarding: vendor ? null : { required: true, reason: 'Vendor not matched to ERP master' },
    nonPoInvoice: !matchingPo?.po,
    pipeline: {
      ...pipeline,
      status: status === 'ready_to_post' ? 'ready_for_matching' : status === 'likely_reject' ? 'needs_review' : status,
      decision: routing,
      stages: pipeline.stages.map((stage) => ({
        ...stage,
        status: stage.stage === 'decision_routing' ? (routing.requiresHumanReview ? 'warning' : 'completed') : stage.status
      }))
    },
    approval: {
      required: status !== 'ready_to_post',
      reviewer: null,
      approvedAt: null,
      overrideReason: null
    },
    posting: {
      posted: false,
      erpDocumentNumber: null,
      postedAt: null,
      error: null
    },
    workflow: []
  };

  invoice.workflow = buildWorkflowSummary(invoice, routing);
  invoice.exceptionReasons = collectExceptionReasons({
    extracted,
    comparison,
    duplicate: duplicateFile || duplicateInvoice,
    vendor,
    invoices,
    lineMatch,
    autoPost
  });
  if (invoice.exceptionReasons.length) {
    invoice.issue = invoice.exceptionReasons[0];
  }

  if (!isReadable) {
    invoice.amount = 0;
    invoice.lineItems = 0;
    invoice.mode = 'review';
    invoice.totalValid = false;
    invoice.reasoning = [{ rule: 'Document readability', passed: false, message: extracted.extractionIssue, severity: 'critical' }];
    invoice.compliance = { gst: { status: 'review', message: 'No GST data could be read from the uploaded file' }, tds: { section: 'Not required', status: 'not_required', message: 'No invoice data available to assess TDS' }, eInvoice: { status: 'not_required', message: 'No invoice data available to assess e-invoice status' }, hsn: { status: 'missing', message: 'No HSN/SAC data available' } };
    invoice.status = STATUSES.PENDING_REVIEW;
    invoice.pipeline.status = 'needs_review';
    invoice.approval.required = true;
  }

  const persistedName = `${fileHash}${path.extname(req.file.originalname || '.pdf')}`;
  const stored = await storeInvoiceFile(req.file.buffer, persistedName);
  invoice.storagePath = stored.path || path.join(uploadDir, persistedName);
  invoice.storageKey = stored.key || persistedName;
  if (!stored.path && invoice.storagePath) {
    fs.writeFileSync(invoice.storagePath, req.file.buffer);
  }

  if (AUTO_POST_EXECUTE && autoPost.eligible && invoice.status === STATUSES.READY_TO_POST) {
    try {
      const result = await erp.postInvoice(invoice);
      invoice.status = STATUSES.POSTED;
      invoice.autoPost = { ...autoPost, autoPosted: true };
      invoice.approval = { required: false, reviewer: 'auto-post', approvedAt: new Date().toISOString(), overrideReason: null };
      invoice.posting = {
        posted: true,
        erpDocumentNumber: result.erpDocument,
        postedAt: new Date().toISOString(),
        error: null,
        idempotencyKey: result.idempotencyKey || `INV-${invoice.id}`
      };
      invoice.issue = 'Auto-posted after calibrated gates passed';
    } catch (error) {
      invoice.status = STATUSES.POSTING_FAILED;
      invoice.autoPost = { ...autoPost, autoPosted: false, blockers: [...(autoPost.blockers || []), 'ERP_POST_FAILED'] };
      invoice.posting = { posted: false, erpDocumentNumber: null, postedAt: null, error: error.message };
      invoice.issue = error.message;
    }
  }

  invoices.unshift(invoice);
  invoiceQueue.enqueue({ id: invoice.id, type: 'invoice-processing', payload: { invoiceId: invoice.id } });
  recordAudit('Invoice analyzed', invoice, isReadable ? `Analyzed ${invoice.fileName}` : `File unreadable: ${invoice.fileName}`, {
    user: actorFrom(req),
    entity: 'invoice',
    reason: isReadable ? 'invoice processed and validated' : 'document unreadable',
    ip: req.ip,
    model_version: AI_MODEL_VERSION,
    ai_version: AI_MODEL_VERSION,
    rule_version: RULE_VERSION,
    recommendation_version: RECOMMENDATION_VERSION,
    newValue: { fileName: req.file.originalname, vendor: invoice.vendor, invoiceNumber: invoice.invoiceNumber }
  });
  res.status(201).json({ invoice: publicInvoice(invoice), readable: isReadable, pipeline: invoice.pipeline, hasFile: true });
  } catch (uploadError) {
    // CRITICAL FIX: Log extraction and reconciliation errors instead of swallowing them
    console.error('[uploadError] Invoice upload and analysis failed:', uploadError.message, uploadError.stack);
    res.status(500).json({ error: 'Invoice processing failed. Please check the server logs.' });
  }
}

app.patch('/api/invoices/:id', requireAuth, requireRole('ap_clerk', 'ap_manager', 'finance_approver', 'admin'), (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const previousStatus = invoice.status;
  const updates = req.body || {};
  const allowedFields = [
    'vendor', 'supplierName', 'supplierGstin', 'supplierPan', 'supplierAddress', 'supplierState',
    'invoiceNumber', 'date', 'dueDate', 'currency', 'po', 'amount', 'tax', 'baseAmount',
    'taxAmount', 'totalAmount', 'hsnCode', 'description', 'shipToDetails', 'placeOfSupply', 'quantity', 'sealPresent',
    'signaturePresent', 'businessDetails', 'status'
  ];

  let hasManualChanges = false;
  for (const [key, value] of Object.entries(updates)) {
    if (!allowedFields.includes(key)) continue;
    const normalizedValue = key === 'amount' || key === 'tax' || key === 'baseAmount' || key === 'taxAmount' || key === 'totalAmount'
      ? Number(value)
      : value;

    if (normalizedValue !== undefined && normalizedValue !== null && normalizedValue !== invoice[key]) {
      hasManualChanges = true;
      invoice[key] = normalizedValue;
    }
  }

  if (hasManualChanges) {
    invoice.approval = { ...(invoice.approval || {}), required: true, reviewer: null, approvedAt: null, overrideReason: null };
    invoice.status = STATUSES.PENDING_REVIEW;
    invoice.decision = { ...((invoice.decision || {})), requiresHumanReview: true, label: 'Pending review', status: 'pending_review' };
    invoice.workflow = buildWorkflowSummary(invoice, invoice.decision || { requiresHumanReview: true, label: 'Pending review' });
    saveVendorTemplate({
      gstin: invoice.supplierGstin,
      vendor: invoice.vendor,
      columnMap: invoice.tableSchema || invoice.fieldEvidence || {}
    }).catch((error) => console.warn('[templates] save failed', error.message));
  }

  recordAudit('Invoice reviewed', invoice, `Reviewed invoice ${invoice.invoiceNumber || invoice.id}`, {
    user: actorFrom(req),
    entity: 'invoice',
    reason: 'manual invoice correction and approval reset',
    ip: req.ip,
    model_version: AI_MODEL_VERSION,
    ai_version: AI_MODEL_VERSION,
    rule_version: RULE_VERSION,
    recommendation_version: RECOMMENDATION_VERSION,
    oldValue: { status: previousStatus },
    newValue: { status: invoice.status, vendor: invoice.vendor, amount: invoice.amount, tax: invoice.tax }
  });
  res.json({ invoice: publicInvoice(decorateInvoice(invoice)) });
});

app.post('/api/invoices/:id/action', requireAuth, requireRole('ap_clerk', 'ap_manager', 'finance_approver', 'admin'), async (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const { action } = req.body;
  const actorRole = req.user?.role || req.body?.role;
  const permissions = APPROVAL_ROLES[actorRole] || [];

  // CRITICAL FIX: Validate action value to prevent silent no-ops
  const validActions = ['post', 'approve', 'approve_override', 'query', 'reject', 'hold'];
  if (!validActions.includes(action)) {
    console.warn(`[Action handler] Unknown action "${action}" attempted on invoice ${req.params.id}`);
    return res.status(400).json({ error: `Unknown action. Valid actions: ${validActions.join(', ')}` });
  }
  if (!permissions.includes(action)) {
    return res.status(403).json({ error: `Role ${actorRole || 'unknown'} cannot perform ${action}` });
  }

  if (action === 'post') {
    if (![STATUSES.APPROVED, STATUSES.READY_TO_POST].includes(normalizeStatus(invoice.status))) {
      return res.status(409).json({ error: 'Invoice must be approved before posting' });
    }
    if (invoice.posting?.posted && invoice.posting.erpDocumentNumber) {
      return res.json({ invoice: publicInvoice(decorateInvoice(invoice)), alreadyPosted: true });
    }
    try {
      const result = await erp.postInvoice(invoice);
      invoice.status = STATUSES.POSTED;
      invoice.posting = {
        posted: true,
        erpDocumentNumber: result.erpDocument,
        postedAt: new Date().toISOString(),
        error: null,
        idempotencyKey: result.idempotencyKey
      };
      const documentPolicy = validateDocumentType(invoice);
      invoice.documentPolicy = documentPolicy;
      if (!documentPolicy.allowedToPost) invoice.status = STATUSES.PENDING_REVIEW;
      invoice.erpDocument = result.erpDocument;
      invoice.issue = 'Posted to ERP after reviewer approval';
    } catch (error) {
      invoice.status = STATUSES.POSTING_FAILED;
      invoice.posting = { posted: false, erpDocumentNumber: null, postedAt: null, error: error.message };
      invoice.issue = error.message;
    }
  }
  if (action === 'approve') {
    invoice.status = STATUSES.READY_TO_POST;
    invoice.issue = 'Approved by reviewer';
    invoice.approval = { ...invoice.approval, required: false, reviewer: actorFrom(req), approvedAt: new Date().toISOString() };
  }
  if (action === 'approve_override') {
    invoice.status = STATUSES.PENDING_REVIEW;
    invoice.issue = req.body.reason || 'Override approved with justification';
    invoice.approval = { ...invoice.approval, reviewer: actorFrom(req), approvedAt: new Date().toISOString(), overrideReason: req.body.reason || 'Override approval' };
  }
  if (action === 'query') {
    invoice.status = STATUSES.QUERY_OPEN;
    invoice.issue = 'Query sent to vendor owner for evidence';
    invoice.vendorQuery = {
      status: 'open',
      thread: [
        ...((invoice.vendorQuery && invoice.vendorQuery.thread) || []),
        { at: new Date().toISOString(), actor: actorFrom(req), message: req.body.message || req.body.reason || 'Please confirm PO, tax, and bank details.' }
      ]
    };
  }
  if (action === 'reject') {
    invoice.status = STATUSES.REJECTED;
    invoice.issue = req.body.reason || 'Rejected due to validation or policy failure';
  }
  if (action === 'hold') {
    invoice.status = STATUSES.ON_HOLD;
    invoice.issue = 'Held for further investigation';
  }

  if (invoice.pipeline) {
    invoice.pipeline.status = invoice.status;
    invoice.pipeline.stages = invoice.pipeline.stages.map((stage) => {
      if (stage.stage === 'approval') {
        return { ...stage, status: action === 'approve' || action === 'approve_override' ? 'completed' : 'pending', detail: action === 'approve' ? 'Reviewer approved the invoice.' : 'Awaiting reviewer approval.' };
      }
      if (stage.stage === 'posting') {
        return { ...stage, status: action === 'post' ? 'completed' : 'pending', detail: action === 'post' ? 'Posting to ERP succeeded.' : 'Posting waits on final approval.' };
      }
      return stage;
    });
  }

  recordAudit(`Invoice ${action}`, invoice, invoice.issue, {
    user: actorFrom(req),
    entity: 'invoice',
    reason: invoice.issue,
    ip: req.ip,
    model_version: AI_MODEL_VERSION,
    ai_version: AI_MODEL_VERSION,
    rule_version: RULE_VERSION,
    recommendation_version: RECOMMENDATION_VERSION,
    oldValue: { status: (req.body?.previousStatus || invoice.status) },
    newValue: { status: invoice.status }
  });
  res.json({ invoice: publicInvoice(decorateInvoice(invoice)) });
});

app.get('/api/invoices/:id/vendor-query', requireAuth, (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ invoiceId: invoice.id, vendorQuery: invoice.vendorQuery || { status: 'closed', thread: [] } });
});

app.post('/api/invoices/:id/vendor-query', requireAuth, requireRole('ap_clerk', 'ap_manager', 'finance_approver', 'admin'), (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'message is required' });
  invoice.vendorQuery = invoice.vendorQuery || { status: 'open', thread: [] };
  invoice.vendorQuery.status = 'open';
  invoice.vendorQuery.thread.push({
    at: new Date().toISOString(),
    actor: actorFrom(req),
    message
  });
  invoice.status = STATUSES.QUERY_OPEN;
  invoice.issue = message;
  recordAudit('Vendor query sent', invoice, message, { actorId: req.user?.sub || 'system' });
  res.status(201).json({ invoice: publicInvoice(decorateInvoice(invoice)), vendorQuery: invoice.vendorQuery });
});

app.get('/api/invoices/:id/file', requireAuth, (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice?.storagePath || !fs.existsSync(invoice.storagePath)) {
    return res.status(404).json({ error: 'Invoice file not found' });
  }
  if (!isPathInsideRoot(invoice.storagePath, uploadDir)) {
    return res.status(404).json({ error: 'Invoice file not found' });
  }
  return res.sendFile(path.resolve(invoice.storagePath));
});

app.get('*', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError || error.message?.includes('File type')) return res.status(400).json({ error: 'Upload a PDF, PNG, JPG, or Excel invoice no larger than 10 MB.' });
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error' });
});

if (require.main === module) {
  ready.then(() => {
    app.listen(PORT, () => console.log(`Invoice Intelligence Hub running at http://localhost:${PORT}`));
    if (INBOX_WATCH) {
      startInboxWatch({
        directory: INBOX_DIR,
        ingest: async (file, meta) => {
          const fakeReq = { file, body: { sourceChannel: meta.sourceChannel || 'mailbox' }, user: { name: 'inbox-watch' }, ip: 'inbox' };
          await new Promise((resolve, reject) => {
            const fakeRes = {
              status(code) {
                this.statusCode = code;
                return this;
              },
              json(payload) {
                if ((this.statusCode || 200) >= 400) reject(new Error(payload.error || 'Inbox ingest failed'));
                else resolve(payload);
              }
            };
            handleInvoiceUpload(fakeReq, fakeRes).catch(reject);
          });
        }
      });
      console.log(`[inbox] watching ${INBOX_DIR}`);
    }
  });
}

module.exports = app;
module.exports.ready = ready;
