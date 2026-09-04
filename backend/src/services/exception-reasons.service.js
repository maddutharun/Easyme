const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function collectExceptionReasons({ extracted = {}, comparison = {}, duplicate = false, vendor = null, invoices = [] } = {}) {
  const reasons = [];
  if (extracted.readable === false) reasons.push('Document was not readable; extract fields from the paper copy.');
  if (duplicate) reasons.push('Duplicate file or invoice number for this vendor.');
  if (!vendor) reasons.push('Vendor is not on the ERP master; onboard before posting.');
  if (extracted.bankChanged) reasons.push('Supplier bank details changed; confirm with treasury.');
  const gstin = extracted.supplierGstin || extracted.gstin;
  if (gstin && !GSTIN_PATTERN.test(String(gstin).toUpperCase())) {
    reasons.push('GSTIN checksum/format failed.');
  }
  if (extracted.arithmeticValidation && extracted.arithmeticValidation.passed === false) {
    reasons.push('Line items, tax, and grand total do not tie out.');
  }
  const failed = (comparison.checks || []).filter((check) => !check.passed);
  for (const check of failed.slice(0, 4)) {
    reasons.push(check.detail || check.name);
  }
  const invoiceNumber = extracted.invoiceNumber;
  const vendorName = extracted.vendor || vendor?.name;
  if (invoiceNumber && vendorName) {
    const prior = invoices.filter((item) =>
      String(item.invoiceNumber || '').toLowerCase() === String(invoiceNumber).toLowerCase()
      && String(item.vendor || '').toLowerCase() === String(vendorName).toLowerCase()
    );
    if (prior.length) reasons.push('Same vendor and invoice number already exists in EasyMe.');
  }
  return [...new Set(reasons.filter(Boolean))];
}

module.exports = { collectExceptionReasons, GSTIN_PATTERN };
