const { extractGstin, pickVendorName, COMPANY_SUFFIX, STOP_LINE } = require('./extraction-refine.service');
const { parseMoney } = require('./line-item-extraction.service');

const TABLE_HEADER = /(?:hsn|sac).*(?:qty|quantity)|(?:qty|quantity).*(?:hsn|sac)|description.+(?:hsn|qty)/i;
const SHIP_HEADING = /^(?:ship(?:ped)?\s*to|consignee|delivered\s*to|dispatch\s*to)\b/i;
const BILL_HEADING = /^(?:bill\s*to|buyer|purchaser|customer)\b/i;
const SELLER_HEADING = /^(?:seller|supplier|vendor|bill\s*from|sold\s*by|tax\s*invoice|m\/s)\b/i;
const FOOTER_HEADING = /^(taxable\s+amount|taxable\s+value|assessable\s+value|subtotal|cgst|sgst|igst|utgst|grand\s+total|total\s+amount|amount\s+due|net\s+payable|output\s+gst|freight|round\s*off|bank\s+details)/i;

function splitLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function firstIndex(lines, predicate, from = 0) {
  const index = lines.findIndex((line, i) => i >= from && predicate(line));
  return index;
}

function sliceUntil(lines, start, stopAt) {
  if (start < 0 || start >= lines.length) return [];
  const end = stopAt.filter((index) => index > start).sort((a, b) => a - b)[0] ?? lines.length;
  return lines.slice(start, end);
}

function labeledAmount(text, labels) {
  const source = String(text || '');
  for (const label of labels) {
    const pattern = new RegExp(`(?:${label})(?:\\s+\\d+(?:\\.\\d+)?\\s*%)?\\s*[:=\\-]?\\s*(?:[$₹]|rs\\.?|inr|usd)?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
    const match = source.match(pattern);
    if (!match) continue;
    const numeric = parseMoney(match[1]);
    if (numeric > 0) return numeric;
  }
  return 0;
}

function splitInvoiceRegions(text) {
  const lines = splitLines(text);
  const shipIndex = firstIndex(lines, (line) => SHIP_HEADING.test(line) || /ship(?:ped)?\s*to\s*:/i.test(line));
  const billIndex = firstIndex(lines, (line) => BILL_HEADING.test(line) && !SHIP_HEADING.test(line));
  const tableIndex = firstIndex(lines, (line) => TABLE_HEADER.test(line) || (/^\d+[.)]?\s+/.test(line) && /\b(?:hsn|sku|sac)\b/i.test(line)));
  const numberedIndex = firstIndex(lines, (line) => /^\d+[.)]?\s+[A-Za-z]/.test(line));
  const footerIndex = firstIndex(lines, (line) => FOOTER_HEADING.test(line) || STOP_LINE.test(line));
  const tableStart = tableIndex >= 0 ? tableIndex : numberedIndex;
  const sellerEndCandidates = [shipIndex, billIndex, tableStart, footerIndex].filter((index) => index >= 0);
  const sellerEnd = sellerEndCandidates.length ? Math.min(...sellerEndCandidates) : lines.length;

  const seller = lines.slice(0, sellerEnd);
  const ship = shipIndex >= 0
    ? sliceUntil(lines, shipIndex + 1, [billIndex, tableStart, footerIndex, firstIndex(lines, (line) => /^(invoice\s*no|dated|place of supply|reverse charge|hsn|qty|base amount)/i.test(line), shipIndex + 1)])
    : [];
  const buyer = billIndex >= 0
    ? sliceUntil(lines, billIndex + 1, [shipIndex, tableStart, footerIndex])
    : [];
  const table = tableStart >= 0
    ? sliceUntil(lines, tableStart, [footerIndex >= 0 ? footerIndex : lines.length])
    : [];
  const footer = footerIndex >= 0 ? lines.slice(footerIndex) : lines.filter((line) => FOOTER_HEADING.test(line) || /grand\s+total|\btotal\b|output\s+gst|taxable/i.test(line));

  return {
    seller: seller.join('\n'),
    buyer: buyer.join('\n'),
    shipTo: ship.join('\n'),
    table: table.join('\n'),
    footer: footer.join('\n'),
    lines,
    indexes: { sellerEnd, shipIndex, billIndex, tableStart, footerIndex }
  };
}

function extractPartyBlocks(text, fieldValues = {}, vendorMap = {}) {
  const regions = splitInvoiceRegions(text);
  const sellerGstin = extractGstin(regions.seller);
  const buyerGstin = extractGstin(regions.buyer);
  const shipGstin = extractGstin(regions.shipTo);
  const fullGstin = extractGstin(text);
  const msName = regions.seller.split('\n').find((line) => /^m\/s\b/i.test(line))?.replace(/^m\/s\.?\s*/i, '').trim() || null;
  const sellerName = pickVendorName(regions.seller || text, fieldValues, vendorMap)
    || regions.seller.split('\n').find((line) => COMPANY_SUFFIX.test(line) && !/ship|bill to|buyer/i.test(line))
    || msName
    || null;
  const sellerAddress = regions.seller.split('\n').filter((line) => {
    if (!line || SELLER_HEADING.test(line) && line.length < 40) return false;
    if (/gstin|invoice|date|po\b|state name|pan\b|tax invoice|original|duplicate/i.test(line)) return false;
    if (COMPANY_SUFFIX.test(line) && line === sellerName) return false;
    return /[A-Za-z]/.test(line) && (/\d/.test(line) || /road|sector|city|nagar|street|pin|dist/i.test(line) || line.length > 18);
  }).slice(0, 4).join(', ') || null;

  const shipToDetails = regions.shipTo
    ? regions.shipTo.split('\n').filter((line) => !SHIP_HEADING.test(line) && !/gstin|place of supply|reverse charge/i.test(line)).slice(0, 4).join(', ')
    : null;
  const buyerName = regions.buyer.split('\n').find((line) => COMPANY_SUFFIX.test(line) || /^m\/s/i.test(line)) || null;
  const placeOfSupply = String(text || '').match(/place\s*of\s*supply\s*[:=]?\s*([A-Za-z\s]+?)(?:\s*\((\d+)\)|\s*$)/i);

  return {
    regions,
    supplierName: sellerName,
    supplierGstin: sellerGstin.value || (fullGstin.value && fullGstin.value !== buyerGstin.value && fullGstin.value !== shipGstin.value ? fullGstin.value : fullGstin.value),
    supplierGstinValid: sellerGstin.valid || fullGstin.valid,
    supplierAddress: sellerAddress,
    shipToDetails,
    buyerName,
    buyerGstin: buyerGstin.value && buyerGstin.value !== sellerGstin.value ? buyerGstin.value : null,
    placeOfSupply: placeOfSupply?.[1]?.trim() || null,
    placeOfSupplyCode: placeOfSupply?.[2] || null
  };
}

function extractFooterTotals(footerText, fullText) {
  const source = footerText || '';
  const taxable = labeledAmount(source, ['taxable amount', 'taxable value', 'assessable value', 'base amount', 'subtotal'])
    || labeledAmount(fullText, ['taxable amount', 'taxable value', 'assessable value', 'base amount']);
  const cgst = labeledAmount(source, ['cgst']);
  const sgst = labeledAmount(source, ['sgst', 'utgst']);
  const igst = labeledAmount(source, ['igst']);
  const componentTax = cgst + sgst + igst;
  const labeledTax = labeledAmount(source, ['tax amount', 'gst total', 'total gst', 'output gst'])
    || labeledAmount(fullText, ['tax amount', 'output gst']);
  const tax = componentTax || labeledTax;
  const grand = labeledAmount(source, ['grand total', 'net payable', 'amount payable', 'total amount', 'amount due', 'invoice total'])
    || labeledAmount(source, ['\\btotal\\b'])
    || labeledAmount(fullText, ['grand total', 'net payable', 'total amount', 'amount due']);
  return { taxable, tax, grand, cgst, sgst, igst };
}

function sumLineQuantities(lineItems = []) {
  return (lineItems || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
}

function sumLineAmounts(lineItems = []) {
  return (lineItems || []).reduce((sum, line) => sum + Number(line.amount || line.taxableAmount || 0), 0);
}

function resolveBusinessUnit({ buyerGstin, buyerName, shipToDetails, placeOfSupply, placeOfSupplyCode, po } = {}) {
  if (buyerGstin) {
    return {
      name: buyerName || null,
      companyCode: `IN${String(buyerGstin).slice(0, 2)}`,
      plant: shipToDetails || null,
      placeOfSupply: placeOfSupply || null,
      placeOfSupplyCode: placeOfSupplyCode || String(buyerGstin).slice(0, 2),
      source: 'buyer_gstin'
    };
  }
  if (shipToDetails) {
    return {
      name: buyerName || (shipToDetails.split(',')[0] || null),
      companyCode: placeOfSupplyCode ? `IN${placeOfSupplyCode}` : null,
      plant: shipToDetails,
      placeOfSupply: placeOfSupply || null,
      placeOfSupplyCode: placeOfSupplyCode || null,
      source: 'ship_to'
    };
  }
  if (po && po !== 'N/A') {
    return {
      name: buyerName || null,
      companyCode: null,
      plant: null,
      placeOfSupply: placeOfSupply || null,
      placeOfSupplyCode: placeOfSupplyCode || null,
      source: 'purchase_order',
      po
    };
  }
  return {
    name: buyerName || null,
    companyCode: placeOfSupplyCode ? `IN${placeOfSupplyCode}` : null,
    plant: null,
    placeOfSupply: placeOfSupply || null,
    placeOfSupplyCode: placeOfSupplyCode || null,
    source: 'unresolved'
  };
}

function applyRegionLocks({
  supplierGstin,
  buyerGstin,
  shipToDetails,
  lineItems = [],
  taxableAmount = 0,
  taxAmount = 0,
  totalAmount = 0,
  totalQuantity = 0,
  tolerance = 1
} = {}) {
  const lineQty = sumLineQuantities(lineItems);
  const lineAmt = sumLineAmounts(lineItems);
  const qtyOk = !lineItems.length || Math.abs(lineQty - Number(totalQuantity || 0)) <= 0.01;
  const taxableOk = !lineItems.length || Math.abs(lineAmt - Number(taxableAmount || 0)) <= tolerance || Number(taxableAmount || 0) === 0;
  const taxOk = Number(taxAmount || 0) <= Number(totalAmount || 0) * 1.05 + tolerance;
  const gstinOk = !supplierGstin || !buyerGstin || supplierGstin !== buyerGstin;
  const shipLooksLikeGstin = /[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]/.test(String(shipToDetails || ''));
  return {
    passed: qtyOk && taxOk && gstinOk && !shipLooksLikeGstin,
    checks: {
      lineQtyMatchesTotal: qtyOk,
      supplierGstinDistinctFromBuyer: gstinOk,
      shipToIsNotGstin: !shipLooksLikeGstin,
      taxNotGreaterThanTotal: taxOk,
      linesNearTaxable: taxableOk
    }
  };
}

module.exports = {
  splitInvoiceRegions,
  extractPartyBlocks,
  extractFooterTotals,
  resolveBusinessUnit,
  applyRegionLocks,
  sumLineQuantities,
  sumLineAmounts,
  labeledAmount
};
