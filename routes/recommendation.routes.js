const express = require('express');
const router = express.Router({ mergeParams: true });
const { generateRecommendation } = require('../services/recommendation.service');
const { findSimilarTransactions } = require('../services/similarity.service');
const { recordAudit } = require('../services/audit.service');
const { transactions } = require('../backend/data/seed');

let getInvoices = null;

router.post('/:id/recommendation', (req, res) => {
  const invoices = getInvoices();
  const invoice = invoices.find((inv) => inv.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });

  const similar = findSimilarTransactions(invoice, transactions);
  const recommendation = generateRecommendation(invoice, { similarTransactions: similar });
  invoice.recommendation = recommendation;
  invoice.status = recommendation.confidence >= 95 ? 'ready_to_post' : 'pending_review';
  recordAudit('Recommendation', invoice, 'Confidence: ' + recommendation.confidence + '%', { user: 'system' });
  res.json({ recommendation, invoice });
});

router.get('/:id/similar', (req, res) => {
  const invoices = getInvoices();
  const invoice = invoices.find((inv) => inv.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });
  const similar = findSimilarTransactions(invoice, transactions);
  res.json({ similar, count: similar.length });
});

module.exports = { router, setGetInvoices: (fn) => (getInvoices = fn) };
