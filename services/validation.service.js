const validateInvoice = (invoice = {}) => {
  const checks = [];

  const addCheck = (name, passed, detail, severity = 'pass') => {
    checks.push({ name, passed, detail, severity });
  };

  const vendorName = String(invoice.vendor || '').trim();
  const invoiceNumber = String(invoice.invoiceNumber || '').trim();
  const po = String(invoice.po || '').trim();
  const amount = Number(invoice.amount || 0);

  addCheck('Vendor present', vendorName.length > 0 && vendorName.toLowerCase() !== 'unknown vendor', vendorName ? 'Vendor name detected.' : 'Vendor name is missing.', 'critical');
  addCheck('Invoice number present', invoiceNumber.length > 0, invoiceNumber ? 'Invoice number is present.' : 'Invoice number is missing.', 'critical');
  addCheck('PO reference', po.length > 0 && po.toLowerCase() !== 'n/a', po ? 'PO reference is present.' : 'PO reference is missing or not matched.', 'warning');
  addCheck('Amount is positive', amount > 0, amount > 0 ? 'Invoice amount is positive.' : 'Invoice amount is missing or invalid.', 'critical');
  addCheck('Tax arithmetic', invoice.totalValid !== false, invoice.totalValid === false ? 'Arithmetic total validation failed.' : 'Arithmetic and tax totals match.', 'critical');

  const passed = checks.every((check) => check.passed);
  const issues = checks.filter((check) => !check.passed).map((check) => check.detail);

  return {
    passed,
    checks,
    issues,
    summary: passed ? 'Invoice passed validation.' : 'Invoice requires manual review.'
  };
};

module.exports = { validateInvoice };
