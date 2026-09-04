const findDuplicates = (invoice = {}, invoices = []) => {
  const normalizedVendor = String(invoice.vendor || '').trim().toLowerCase();
  const normalizedNumber = String(invoice.invoiceNumber || '').trim().toLowerCase();
  const normalizedPo = String(invoice.po || '').trim().toLowerCase();

  const matches = invoices.filter((entry) => {
    if (!entry) return false;
    const sameVendor = normalizedVendor && String(entry.vendor || '').trim().toLowerCase() === normalizedVendor;
    const sameInvoice = normalizedNumber && String(entry.invoiceNumber || '').trim().toLowerCase() === normalizedNumber;
    const samePo = normalizedPo && String(entry.po || '').trim().toLowerCase() === normalizedPo;
    return sameVendor && (sameInvoice || samePo);
  });

  return {
    isDuplicate: matches.length > 0,
    matches,
    duplicate: matches.length > 0
  };
};

module.exports = { findDuplicates };
