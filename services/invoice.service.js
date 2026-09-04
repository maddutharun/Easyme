const findVendor = (vendorName = '', vendors = []) => {
  const target = String(vendorName || '').trim().toLowerCase();
  if (!target) return null;
  return vendors.find((vendor) => String(vendor.name || '').trim().toLowerCase() === target) || null;
};

const findMatchingPo = (vendorId = '', poNumber = '', transactions = []) => {
  const targetPo = String(poNumber || '').trim();
  if (!targetPo) return null;

  return transactions.find((transaction) => {
    if (vendorId && transaction.vendorId && transaction.vendorId !== vendorId) return false;
    return String(transaction.po || '').trim() === targetPo;
  }) || null;
};

module.exports = { findVendor, findMatchingPo };
