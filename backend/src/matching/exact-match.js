  const twoWayMatch = (invoice, po, tolerance = 1) => {
  if (!po) return { matched: false, reasons: ['PO_NOT_FOUND'], checks: { vendorMatch: false, currencyMatch: false, amountMatch: false, amountDifference: null } };
  const amountDifference = Math.abs(Number(invoice.total ?? invoice.amount) - Number(po.total ?? po.amount));
  const vendorMatch = invoice.vendorId === po.vendorId;
  const currencyMatch = invoice.currency === po.currency;
  const amountMatch = amountDifference <= tolerance;
  return {
    matched: vendorMatch && currencyMatch && amountMatch,
    reasons: [
      ...(vendorMatch ? [] : ['VENDOR_MISMATCH']),
      ...(currencyMatch ? [] : ['CURRENCY_MISMATCH']),
      ...(amountMatch ? [] : ['PO_INVOICE_AMOUNT_MISMATCH'])
    ],
    checks: { vendorMatch, currencyMatch, amountMatch, amountDifference }
  };
};

module.exports = { twoWayMatch };
