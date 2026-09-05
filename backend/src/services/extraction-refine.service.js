  const COMPANY_SUFFIX = /\b(private limited|pvt\.?\s*ltd\.?|limited|ltd\.?|llc|inc\.?|co\.|company|llp|gmbh|plc)\b/i;
const STOP_LINE = /^(taxable amount|cgst|sgst|igst|utgst|grand total|total amount|amount due|net payable|output gst|freight|round off|bank details|authorized|authorised|seal of company|declaration|hsn\/sac\s*$)/i;
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function repairOcrText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/lNVOICE/gi, 'INVOICE')
    .replace(/G5TIN/gi, 'GSTIN')
    .replace(/GSIIN/gi, 'GSTIN')
    .replace(/\bS0LD\b/gi, 'SOLD')
    .replace(/\bB1LL\b/gi, 'BILL')
    .replace(/\bT0TAL\b/gi, 'TOTAL')
    .replace(/((?:amount due|total amount|grand total|tax amount|base amount|gst|invoice no\.?)\s*[:=]?\s*),+(?=\d)/gi, '$1')
    .replace(/(\d)\s+[.,]\s+(\d{2})(?!\d)/g, '$1.$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

function preferStructuredText(layoutText, rawText) {
  const layout = String(layoutText || '').trim();
  const raw = String(rawText || '').trim();
  if (!layout) return raw;
  if (!raw) return layout;
  const layoutLines = layout.split('\n').filter(Boolean).length;
  const rawLines = raw.split('\n').filter(Boolean).length;
  if (layoutLines >= rawLines && layout.length >= raw.length * 0.5) return layout;
  if (rawLines <= 2 && layoutLines > rawLines) return layout;
  return raw.length >= layout.length ? raw : layout;
}

function gstinChecksumValid(value) {
  const gstin = String(value || '').toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return false;
  let hash = 0;
  for (let index = 0; index < 14; index += 1) {
    const code = GSTIN_CHARS.indexOf(gstin[index]);
    if (code < 0) return false;
    const product = code * (index % 2 === 0 ? 1 : 2);
    hash += Math.floor(product / 36) + (product % 36);
  }
  const check = (36 - (hash % 36)) % 36;
  return GSTIN_CHARS[check] === gstin[14];
}

function extractGstin(text) {
  const matches = [...String(text || '').toUpperCase().matchAll(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/g)].map((match) => match[1]);
  if (!matches.length) return { value: null, valid: false };
  const valid = matches.find((value) => gstinChecksumValid(value));
  return { value: valid || matches[0], valid: Boolean(valid) };
}

function extractIrn(text) {
  const labeled = String(text || '').match(/(?:irn|ack\s*no|ack\s*num(?:ber)?)\s*[:#-]?\s*([A-Za-z0-9-]{16,64})/i);
  if (labeled) return labeled[1];
  const hash = String(text || '').match(/\b([a-f0-9]{64})\b/i);
  return hash ? hash[1] : null;
}

function extractLabeledAmount(text, labels) {
  const source = String(text || '');
  for (const label of labels) {
    const pattern = new RegExp(
      `(?:${label})\\s*[:=\\-]?\\s*(?:[$₹]|rs\\.?|inr|usd)?\\s*([\\d,]+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{2})?)`,
      'i'
    );
    const match = source.match(pattern);
    if (!match) continue;
    const numeric = Number(String(match[1]).replace(/,/g, ''));
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function scoreVendorCandidate(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (!name || name.length < 4) return 0;
  if (/^(invoice|tax invoice|bill to|ship to|gstin|date|total|amount|original|duplicate)$/i.test(name)) return 0;
  let score = 40;
  if (COMPANY_SUFFIX.test(name)) score += 35;
  if (/^[A-Z]/.test(name)) score += 10;
  if ((name.match(/[A-Za-z]/g) || []).length >= 8) score += 10;
  if (/\d{6,}/.test(name)) score -= 20;
  if (name.length > 80) score -= 15;
  return score;
}

function pickVendorName(text, fieldValues = {}, vendorMap = {}) {
  const lower = String(text || '').toLowerCase();
  const mapped = Object.entries(vendorMap).find(([key]) => lower.includes(key))?.[1];
  const labeled = fieldValues.vendor || fieldValues.supplierName || null;
  const gstinNeighbor = String(text || '').split(/\n|;/).map((line) => line.trim()).filter(Boolean);
  const beforeGstin = gstinNeighbor.find((line, index) => {
    const next = gstinNeighbor[index + 1] || '';
    return COMPANY_SUFFIX.test(line) && /gstin/i.test(next);
  });
  const entityLine = gstinNeighbor.find((line) => COMPANY_SUFFIX.test(line) && !/ship(?:ped)? to|bill to|buyer|consignee/i.test(line));
  const candidates = [mapped, labeled, beforeGstin, entityLine].filter(Boolean).map((value) => String(value).trim());
  const ranked = candidates
    .map((value) => ({ value, score: scoreVendorCandidate(value) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.value || labeled || mapped || null;
}

module.exports = {
  repairOcrText,
  preferStructuredText,
  gstinChecksumValid,
  extractGstin,
  extractIrn,
  extractLabeledAmount,
  pickVendorName,
  scoreVendorCandidate,
  COMPANY_SUFFIX,
  STOP_LINE
};
