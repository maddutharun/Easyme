const express = require('express');
const router = express.Router({ mergeParams: true });
const { approveInvoice, postToErp, rejectInvoice } = require('../services/posting.service');
const { recordAudit } = require('../services/audit.service');

let getInvoices = null;

router.patch('/:id', (req, res) => {
  const invoices = getInvoices();
  const invoice = invoices.find((inv) => inv.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });

  const allowed = ['vendor', 'invoiceNumber', 'amount', 'tax', 'status'];
  const body = req.body || {};
  for (const key in body) {
    if (allowed.includes(key)) invoice[key] = body[key];
  }

  recordAudit('Review', invoice, 'Corrections', { user: 'reviewer', ip: req.ip });
  res.json({ invoice });
});

router.post('/:id/approve', async (req, res) => {
  const invoices = getInvoices();
  const invoice = invoices.find((inv) => inv.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });

  try {
    const reviewer = (req.body && req.body.reviewer) || 'system';
    const role = (req.body && req.body.role) || 'ap_manager';
    await approveInvoice(invoice, { reviewer, role, ip: req.ip });
    res.json({ invoice });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/post', async (req, res) => {
  const invoices = getInvoices();
  const invoice = invoices.find((inv) => inv.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });

  if (invoice.status !== 'approved' && invoice.status !== 'ready_to_post') {
    return res.status(400).json({ error: 'Must be approved first' });
  }

  try {
    const reviewer = (req.body && req.body.reviewer) || 'system';
    const role = (req.body && req.body.role) || 'finance_approver';
    await postToErp(invoice, { reviewer, role, ip: req.ip });
    res.json({ invoice });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/reject', async (req, res) => {
  const invoices = getInvoices();
  const invoice = invoices.find((inv) => inv.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });

  try {
    const body = req.body || {};
    const reason = body.reason || 'Rejected';
    const reviewer = body.reviewer || 'system';
    const role = body.role || 'ap_manager';
    await rejectInvoice(invoice, reason, { reviewer, role, ip: req.ip });
    res.json({ invoice });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = { router, setGetInvoices: (fn) => (getInvoices = fn) };
