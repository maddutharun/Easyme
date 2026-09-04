const express = require('express');
const router = express.Router();
// Canonical vendor APIs live in backend/app.js. This router is kept for compatibility tests only.
const { vendors, transactions } = require('../backend/data/seed');

router.get('/', (req, res) => {
  res.json({ vendors, total: vendors.length });
});

router.get('/:id', (req, res) => {
  const vendor = vendors.find(v => v.id === req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Not found' });
  const vendorTransactions = transactions.filter(t => t.vendorId === vendor.id);
  res.json({ vendor, transactions: vendorTransactions });
});

module.exports = router;
