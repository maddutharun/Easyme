  const normalizeText = (value) => String(value ?? '')
  .normalize('NFKC')
  .toUpperCase()
  .replace(/[^\p{L}\p{N}]/gu, '');

const normalizeInvoiceNumber = (value) => normalizeText(value)
  .replace(/^INV/, '')
  .replace(/^NO/, '');

const normalizeAmount = (value) => {
  const amount = Number(String(value ?? '').replaceAll(',', ''));
  if (!Number.isFinite(amount)) throw new Error('Invalid amount');
  return Math.round(amount * 100) / 100;
};

module.exports = { normalizeText, normalizeInvoiceNumber, normalizeAmount };
