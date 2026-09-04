const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const { extractInvoiceData, reconcileInvoiceAgainstErp } = require('../backend/services/invoice-engine');
const { validateInvoice } = require('../services/validation.service');
const { findDuplicates } = require('../services/duplicate.service');
const { recordAudit, getAuditFor } = require('../services/audit.service');
const { findVendor, findMatchingPo } = require('../services/invoice.service');
const { vendors, transactions } = require('../backend/data/seed');

let invoices = [];

router.post('/upload', upload.single('invoice'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required' });

  try {
    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const extracted = await extractInvoiceData(req.file);
    const vendor = findVendor(extracted.vendor, vendors);
    const matchingPo = vendor ? findMatchingPo(vendor.id, extracted.po, transactions) : null;
    const validationResult = validateInvoice(extracted);
    const duplicateResult = findDuplicates(extracted, invoices);

    const input = {
      vendorId: vendor ? vendor.id : null,
      vendor: vendor ? vendor.name : extracted.vendor,
      invoiceNumber: extracted.invoiceNumber,
      amount: Number(extracted.amount || 0),
      po: matchingPo ? matchingPo.po : 'N/A',
      tax: Number(extracted.tax || 0),
      duplicate: duplicateResult.isDuplicate,
      readable: extracted.readable,
      totalValid: extracted.totalValid !== false
    };

    const comparison = reconcileInvoiceAgainstErp(input, { vendors, transactions });
    const invoiceId = 'INV-' + Date.now().toString().slice(-8);
    const invoice = Object.assign({}, input, extracted, {
      id: invoiceId,
      fileName: req.file.originalname,
      fileHash,
      status: 'pending_review',
      validation: validationResult,
      duplicate: duplicateResult,
      confidence: comparison.confidence,
      approval: { required: true },
      posting: { posted: false },
      workflow: []
    });

    invoices.unshift(invoice);
    recordAudit('Upload', invoice, req.file.originalname, { user: 'ap', ip: req.ip });
    res.status(201).json({ invoice });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', (req, res) => {
  const query = String(req.query.search || '').toLowerCase();
  const result = invoices.filter((inv) => !query || `${inv.id} ${inv.invoiceNumber || ''} ${inv.vendor || ''}`.toLowerCase().includes(query));
  res.json({ invoices: result, total: result.length });
});

router.get('/:id', (req, res) => {
  const invoice = invoices.find((inv) => inv.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });
  res.json({ invoice });
});

router.get('/:id/audit', (req, res) => {
  const audit = getAuditFor(req.params.id, 50);
  res.json({ audit, total: audit.length });
});

module.exports = router;
module.exports.invoices = { get: () => invoices, set: (inv) => (invoices = inv) };
