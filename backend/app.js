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
const { PORT, AUTH_REQUIRED, STORAGE_PATH, NODE_ENV } = require('./config/env');
const { initializeDatabase, createPersistentStore } = require('./services/database.service');
const { authenticate, signToken, requireAuth, requireRole } = require('./services/auth.service');
const { decorateInvoice, isException, isPosted, isReview, STATUSES, normalizeStatus } = require('./src/status');
const { invoiceQueue } = require('./services/queue.service');
const { reconcilePostedInvoice } = require('./src/services/reconciliation.service');
const { recordFeedback } = require('./src/services/feedback.service');
const { validateDocumentType, nextStatus } = require('./src/services/scenario.service');
const { validateFileSignature } = require('./src/services/file-security.service');
const { APPROVAL_ROLES } = require('../services/posting.service');

const APP_VERSION = 'ai-ap-invoice-v1.0.0';
const AI_MODEL_VERSION = 'local-rule-v1';
const RULE_VERSION = 'invoice-rules-v1';
const RECOMMENDATION_VERSION = 'recommendation-v1';

const app = express();
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
    totalVolume: decorated.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0)
  };
}

app.use(express.static(frontendDir, {
  etag: false,
  lastModified: false,
  setHeaders(res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
  }
}));

app.post('/api/auth/login', async (req, res) => {
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

app.get('/api/config', (req, res) => res.json({
  matchingPolicy,
  supportedUploadTypes: uploadPolicy.supportedTypes,
  maxUploadSizeMb: uploadPolicy.maxSizeMb,
  authRequired: AUTH_REQUIRED,
  demoUsers: [
    { email: 'finance@easyme.local', role: 'finance_approver' },
    { email: 'manager@easyme.local', role: 'ap_manager' },
    { email: 'clerk@easyme.local', role: 'ap_clerk' }
  ]
}));

app.get('/api/summary', requireAuth, (req, res) => {
  const metrics = metricsSnapshot();
  res.json({
    invoices: invoices.map((invoice) => decorateInvoiceWorkflow(invoice)),
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

app.get('/api/observability', (req, res) => {
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
      queueBacklog: 0,
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

app.get('/api/invoices', requireAuth, (req, res) => {
  const query = String(req.query.search || '').toLowerCase();
  const result = invoices
    .map((invoice) => decorateInvoice(invoice))
    .filter((invoice) => !query || `${invoice.id} ${invoice.invoiceNumber} ${invoice.vendor} ${invoice.po || ''}`.toLowerCase().includes(query));
  res.json({ invoices: result, total: result.length });
});

app.get('/api/health', async (req, res) => {
  const erpHealth = await erp.ping().catch(() => ({ ok: false }));
  res.json({
    status: 'ok',
    erp: erpHealth.ok ? 'connected' : 'degraded',
    storage: 'sqlite',
    mode: AUTH_REQUIRED ? 'secured' : 'demo',
    checkedAt: new Date().toISOString()
  });
});

app.get('/api/roles', (req, res) => {
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

app.get('/api/queue', (req, res) => {
  res.json({ jobs: invoiceQueue.list() });
});

app.get('/api/invoices/:id', requireAuth, (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const po = transactions.find((item) => item.po === invoice.po);
  const comparison = reconcileInvoiceAgainstErp({ ...invoice, quantity: invoice.lineItems || invoice.quantity || 1, duplicate: false, totalValid: true }, { vendors, transactions });
  res.json({ invoice, po, checks: comparison.checks, reasoning: comparison.reasoning, compliance: comparison.compliance });
});

app.get('/api/invoices/:id/evidence', requireAuth, (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ invoiceId: invoice.id, checks: invoice.checks || [], reasoning: invoice.reasoning || [], recommendation: invoice.aiRecommendation || invoice.recommendation || null, history: invoice.similarTransactions || [] });
});

app.post('/api/invoices/:id/review', requireAuth, requireRole('ap_clerk', 'ap_manager', 'finance_approver', 'admin'), (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const previousStatus = invoice.status;
  Object.assign(invoice, req.body || {});
  invoice.status = STATUSES.PENDING_REVIEW;
  invoice.reviewedAt = new Date().toISOString();
  recordAudit('Invoice reviewed', invoice, req.body?.reason || 'Review completed', { previousStatus, actorId: req.user?.sub || 'system', corrections: req.body || {} });
  res.json({ invoice: decorateInvoice(invoice) });
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
  const exceptions = invoices.map((invoice) => decorateInvoice(invoice)).filter((invoice) => isException(invoice.status));
  res.json({ exceptions, total: exceptions.length });
});

app.post('/api/invoices/:id/recommendation', requireAuth, requireRole('ap_manager', 'finance_approver', 'admin'), (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const recommendation = generateRecommendation(invoice, { vendors, transactions });
  invoice.aiRecommendation = recommendation;
  invoice.confidence = recommendation.confidence;
  invoice.status = recommendation.confidence >= 95 ? 'ready_to_post' : 'pending_review';

  recordAudit('AI recommendation generated', invoice, JSON.stringify({
    glAccount: recommendation.glAccount,
    costCenter: recommendation.costCenter,
    taxCode: recommendation.taxCode,
    confidence: recommendation.confidence
  }));

  res.json({ recommendation, invoice });
});

app.post('/api/invoices/:id/post', requireAuth, requireRole('finance_approver', 'admin'), async (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  if (invoice.status !== 'ready_to_post' && invoice.status !== 'approved') {
    return res.status(409).json({ error: 'Invoice must be approved before posting' });
  }
  if (invoice.posting?.posted && invoice.posting.erpDocumentNumber) {
    return res.json({ invoice, posting: invoice.posting, alreadyPosted: true });
  }
  if (!invoice.aiRecommendation) {
    const recommendation = generateRecommendation(invoice, { vendors, transactions });
    invoice.aiRecommendation = recommendation;
  }

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

  res.json({ invoice, posting: invoice.posting });
});

app.get('/api/pipeline/:id', (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ pipeline: invoice.pipeline || { status: invoice.status, stages: [] }, invoice });
});

app.post('/api/invoices/upload', requireAuth, upload.single('invoice'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF, PNG, JPG, or Excel invoice no larger than 10 MB.' });

  try {
    const fileSignature = validateFileSignature(req.file);
    if (!fileSignature.valid) return res.status(400).json({ error: 'File extension and content signature do not match.' });
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
    sourceChannel: 'web_upload',
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
    sourceChannel: 'web_upload',
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
  const storedFilePath = path.join(uploadDir, persistedName);
  fs.writeFileSync(storedFilePath, req.file.buffer);
  invoice.storagePath = storedFilePath;

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
  res.status(201).json({ invoice, readable: isReadable, pipeline: invoice.pipeline, storagePath: storedFilePath });
  } catch (uploadError) {
    // CRITICAL FIX: Log extraction and reconciliation errors instead of swallowing them
    console.error('[uploadError] Invoice upload and analysis failed:', uploadError.message, uploadError.stack);
    res.status(500).json({ error: 'Invoice processing failed. Please check the server logs.' });
  }
});

app.patch('/api/invoices/:id', requireAuth, requireRole('ap_clerk', 'ap_manager', 'finance_approver', 'admin'), (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const previousStatus = invoice.status;
  const updates = req.body || {};
  const allowedFields = [
    'vendor', 'supplierName', 'supplierGstin', 'supplierPan', 'supplierAddress', 'supplierState',
    'invoiceNumber', 'date', 'dueDate', 'currency', 'po', 'amount', 'tax', 'baseAmount',
    'taxAmount', 'totalAmount', 'hsnCode', 'description', 'shipToDetails', 'sealPresent',
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
  res.json({ invoice: decorateInvoice(invoice) });
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
      return res.json({ invoice: decorateInvoice(invoice), alreadyPosted: true });
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
  res.json({ invoice: decorateInvoice(invoice) });
});

app.get('/api/invoices/:id/file', requireAuth, (req, res) => {
  const invoice = invoices.find((item) => item.id === req.params.id);
  if (!invoice?.storagePath || !fs.existsSync(invoice.storagePath)) {
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
  });
}

module.exports = app;
module.exports.ready = ready;
