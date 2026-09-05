const { STOP_LINE } = require('./extraction-refine.service');
const FOOTER_HEADING_LINE = /^(taxable\s+amount|cgst|sgst|igst|grand\s+total|total\s+amount|output\s+gst|freight)/i;

const parseMoney = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith('-');
  const numeric = Number(raw.replace(/[₹$(),]/g, '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric)) return 0;
  return negative ? -numeric : numeric;
};

  const HEADER_PATTERN = /(?:sku|item\s*(?:code|no)|product\s*code|material\s*code|part\s*no|hsn|sac|description|qty|quantity|unit\s*price|rate|amount|taxable)/i;

  const normalizeInvoiceLines = (text) => {
    const sourceLines = String(text || '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const merged = [];
    for (const line of sourceLines) {
      const isNewRow = /^\d+[.)]?\s+/.test(line) || /\b(?:sku|item\s*(?:code|no)|product\s*code)\b/i.test(line);
      if (STOP_LINE.test(line) || FOOTER_HEADING_LINE.test(line)) {
        merged.push(line);
        continue;
      }
      if (!isNewRow && merged.length && !HEADER_PATTERN.test(line) && !STOP_LINE.test(merged[merged.length - 1])) {
        merged[merged.length - 1] += ` ${line}`;
      } else {
        merged.push(line);
      }
    }
    return merged;
  };

const parseLineItem = (line, continuation = '') => {
  const text = String(line || '').replace(/\s+/g, ' ').trim();
  const fullText = `${text} ${continuation}`.replace(/\s+/g, ' ').trim();
  const skuMatch = fullText.match(/(?:sku\s*id|sku|item\s*(?:code|no)|product\s*code|material\s*code|part\s*no|model\s*no)\s*[:#-]?\s*([A-Z0-9][A-Z0-9_.-]{2,})/i);
  const isNumberedRow = /^\d+[.)]?\s+/.test(text);
  if (!isNumberedRow && !skuMatch) return null;
  const hsnMatch = fullText.match(/\b(\d{4,8})\b(?!\s*%)/);
  const hsn = hsnMatch?.[1] || null;
  const numericSource = hsnMatch ? fullText.slice(hsnMatch.index + hsnMatch[0].length) : fullText;
  const numbers = [...numericSource.matchAll(/(?:₹|rs\.?|inr|usd|\$)?\s*([\d,]+(?:\.\d{1,2})?)/gi)]
    .map((match) => parseMoney(match[1]))
    .filter((value) => Number.isFinite(value));
  const assigned = assignQtyRateAmount(numbers, hsn);
  if (!assigned) return null;
  const hsnIndex = hsnMatch ? text.indexOf(hsnMatch[1]) : -1;
  const description = (hsnIndex > 0 ? text.slice(text.search(/\s/) + 1, hsnIndex) : text.replace(/^\d+[.)]?\s+/, ''))
    .replace(/\b(?:sku|item\s*(?:code|no))\s*[:#-]?\s*[A-Z0-9_.-]+/ig, ' ')
    .replace(/[\d,]+(?:\.\d{1,2})?/g, ' ')
    .replace(/\b(?:pcs|pc|nos|units?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sku = skuMatch?.[1] && !/^\d+$/.test(skuMatch[1]) ? skuMatch[1] : null;
  const gstRate = fullText.match(/(?:gst|tax)\s*(?:rate)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i)?.[1];
  return {
    sku,
    description: description || null,
    hsnCode: hsn && hsn.length >= 6 ? hsn : hsn,
    quantity: assigned.quantity,
    unitPrice: assigned.unitPrice,
    taxableAmount: assigned.amount,
    amount: assigned.amount,
    gstRate: gstRate ? Number(gstRate) : null
  };
};

function assignQtyRateAmount(numbers, hsn) {
  const values = numbers.filter((value) => value > 0 && value !== Number(hsn));
  const tryTriple = (quantity, unitPrice, amount) => {
    const expected = quantity * unitPrice;
    if (Math.abs(expected - amount) <= Math.max(1, amount * 0.02)) {
      return { quantity, unitPrice, amount };
    }
    return null;
  };
  if (values.length >= 3) {
    for (let index = 0; index <= values.length - 3; index += 1) {
      const hit = tryTriple(values[index], values[index + 1], values[index + 2]);
      if (hit) return hit;
    }
  }
  if (hsn && values.length >= 3) {
    return { quantity: values[0], unitPrice: values[1], amount: values[2] };
  }
  return null;
}

const deduplicateDocumentText = (text) => {
  const pages = String(text || '').split(/\f|(?=GSTIN\s*[:])/i).map((page) => page.trim()).filter(Boolean);
  const uniquePages = pages.filter((page, index, all) => index === all.findIndex((candidate) => candidate.replace(/original copy|duplicate copy/gi, '').trim() === page.replace(/original copy|duplicate copy/gi, '').trim()));
  return uniquePages.join('\n');
};

const extractLineItems = (text) => {
  const lines = normalizeInvoiceLines(text);
  const items = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const numbered = /^\d+[.)]?\s+/.test(line);
    const skuLine = /\b(?:sku|item\s*(?:code|no)|product\s*code)\b/i.test(line);
    if (!numbered && !skuLine) continue;
    const continuation = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      if (/^\d+[.)]?\s+/.test(lines[next])) break;
      if (STOP_LINE.test(lines[next])) break;
      continuation.push(lines[next]);
    }
    const item = parseLineItem(line, continuation.join(' '));
    if (item) items.push(item);
  }
  return dedupeLineItems(items);
};

const dedupeLineItems = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = [item.sku, item.hsnCode, item.quantity, item.amount].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const extractLineItemsFromLayout = (layout) => {
  if (!layout?.pages?.length) return [];
  const items = [];
  for (const page of layout.pages) {
    for (const row of page.rows || []) {
      const text = (row.items || []).map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
      const parsed = parseLineItem(text);
      if (parsed) items.push(parsed);
    }
  }
  return dedupeLineItems(items);
};

const detectTemplate = (text) => {
  const value = String(text || '');
  if (/tax invoice|gstin|hsn|sac/i.test(value)) return 'india-gst-table';
  if (/invoice number|bill to|ship to|subtotal/i.test(value)) return 'standard-commercial';
  if (/sku|item code|product code|material code/i.test(value)) return 'sku-table';
  return 'generic';
};

const detectColumnMap = (text) => {
  const header = String(text || '').split(/\r?\n/).find((line) => /sku|hsn|description|qty|quantity|rate|price|amount/i.test(line)) || '';
  const aliases = {
    sku: /sku|item\s*(?:code|no)|product\s*code|material\s*code|part\s*no/i,
    hsnCode: /hsn|sac/i,
    description: /description|item|product/i,
    quantity: /qty|quantity/i,
    unitPrice: /unit\s*price|rate|price/i,
    amount: /amount|value|total/i
  };
  return { header, columns: Object.fromEntries(Object.entries(aliases).map(([name, pattern]) => [name, pattern.test(header)])) };
};

const buildFieldEvidence = (values, source = 'text') => Object.fromEntries(Object.entries(values).map(([field, value]) => [field, {
  value,
  source,
  confidence: value === null || value === undefined || value === '' ? 0.2 : 0.85,
  needsReview: value === null || value === undefined || value === ''
}]));

const validateArithmetic = ({ lineItems = [], taxableAmount = 0, taxAmount = 0, charges = [], discount = 0, totalAmount = 0, tolerance = 1 }) => {
  const lineTotal = lineItems.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const chargesTotal = charges.reduce((sum, charge) => sum + Number(charge.amount || 0), 0);
  const lineMathDifference = Math.abs(lineTotal - Number(taxableAmount || 0));
  const grandTotalExpected = Number(taxableAmount || 0) + Number(taxAmount || 0) + chargesTotal - Number(discount || 0);
  const grandTotalDifference = Math.abs(grandTotalExpected - Number(totalAmount || 0));
  return {
    passed: lineMathDifference <= tolerance && grandTotalDifference <= tolerance,
    lineTotal,
    lineMathDifference,
    grandTotalExpected,
    grandTotalDifference,
    checks: { linesMatchTaxable: lineMathDifference <= tolerance, totalsMatch: grandTotalDifference <= tolerance }
  };
};

const extractTaxBreakdown = (text, taxableAmount, taxAmount) => {
  const rates = [...String(text || '').matchAll(/(?:gst|tax)\s*(?:rate)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/gi)].map((match) => Number(match[1]));
  const gstRate = rates[0] || (taxableAmount > 0 ? Number(((taxAmount / taxableAmount) * 100).toFixed(2)) : 0);
  const component = (label) => String(text || '').match(new RegExp(`\\b${label}\\b(?:\\s+\\d+(?:\\.\\d+)?\\s*%)?\\s*[:=]\\s*[₹$]?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i'))?.[1];
  const cgst = component('cgst');
  const sgst = component('sgst') || component('utgst');
  const igst = component('igst');
  return {
    gstRate,
    cgst: cgst ? parseMoney(cgst) : 0,
    sgst: sgst ? parseMoney(sgst) : 0,
    igst: igst ? parseMoney(igst) : 0,
    taxAmount: parseMoney(cgst) + parseMoney(sgst) + parseMoney(igst) || taxAmount
  };
};

const extractCharges = (text) => {
  const charges = [];
  for (const match of String(text || '').matchAll(/(freight(?:\s+(?:and|&)\s+forwarding)?(?:\s+charges?)?|shipping|handling|round(?:ed|ing)?\s*off|discount|cess|other charges?)\s*[:=]?\s*(\(\s*-\s*\))?\s*[₹$]?\s*([\d,]+(?:\.\d{1,2})?)/gi)) {
    charges.push({ type: match[1].toLowerCase(), amount: parseMoney(match[3]) * (match[2] ? -1 : 1) });
  }
  return charges;
};

const extractTaxSummary = (text) => {
  const rows = [...String(text || '').matchAll(/(\d+(?:\.\d+)?)%\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)/gi)];
  const rates = rows.map((row) => ({ rate: Number(row[1]), taxableAmount: parseMoney(row[2]), igstAmount: parseMoney(row[3]), taxAmount: parseMoney(row[4]) }));
  return { rates, taxableAmount: rates.reduce((sum, row) => sum + row.taxableAmount, 0), taxAmount: rates.reduce((sum, row) => sum + row.taxAmount, 0), igstAmount: rates.reduce((sum, row) => sum + row.igstAmount, 0) };
};

module.exports = { extractLineItems, extractLineItemsFromLayout, extractTaxBreakdown, extractCharges, extractTaxSummary, parseMoney, detectTemplate, detectColumnMap, buildFieldEvidence, validateArithmetic, normalizeInvoiceLines, deduplicateDocumentText };