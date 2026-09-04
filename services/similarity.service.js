const findSimilarTransactions = (invoice = {}, transactions = []) => {
  const vendor = String(invoice.vendor || '').trim().toLowerCase();
  const description = String(invoice.description || '').trim().toLowerCase();
  const hsn = String(invoice.hsnCode || '').trim();
  const po = String(invoice.po || '').trim();

  return transactions.filter((transaction) => {
    const sameVendor = !vendor || String(transaction.vendor || '').trim().toLowerCase() === vendor;
    const sameDescription = !description || String(transaction.description || '').trim().toLowerCase().includes(description) || description.includes(String(transaction.description || '').trim().toLowerCase());
    const sameHsn = !hsn || String(transaction.hsnCode || '').trim() === hsn;
    const samePo = !po || String(transaction.po || '').trim() === po;
    return sameVendor && (sameDescription || sameHsn || samePo);
  });
};

module.exports = { findSimilarTransactions };
