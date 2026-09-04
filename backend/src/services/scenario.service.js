  const DOCUMENT_TYPES = new Set(['STANDARD_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'ADVANCE', 'PROFORMA']);

const validateDocumentType = (invoice) => {
  const documentType = String(invoice?.documentType || 'STANDARD_INVOICE').toUpperCase();
  if (!DOCUMENT_TYPES.has(documentType)) return { allowedToPost: false, reason: 'DOCUMENT_TYPE_INVALID' };
  if (documentType === 'PROFORMA') return { allowedToPost: false, reason: 'PROFORMA_NOT_POSTABLE' };
  if (documentType === 'CREDIT_NOTE' && !invoice.referenceInvoiceNo) return { allowedToPost: false, reason: 'CREDIT_NOTE_REFERENCE_REQUIRED' };
  if (documentType === 'ADVANCE') return { allowedToPost: false, reason: 'ADVANCE_WORKFLOW_REQUIRED' };
  return { allowedToPost: true, documentType };
};

const twoWayMatch = (invoice, purchaseOrder, tolerance = 1) => {
  if (!purchaseOrder) return { passed: false, reasons: ['PO_NOT_FOUND'] };
  const vendorOk = invoice.vendorId === purchaseOrder.vendorId;
  const currencyOk = invoice.currency === purchaseOrder.currency;
  const statusOk = String(purchaseOrder.status || 'OPEN').toUpperCase() === 'OPEN';
  const expectedSubtotal = Number(purchaseOrder.expectedSubtotal ?? purchaseOrder.poTotal ?? purchaseOrder.total ?? 0);
  const subtotal = Number(invoice.subtotal ?? invoice.amount ?? invoice.total ?? 0);
  const priceOk = Math.abs(subtotal - expectedSubtotal) <= Number(purchaseOrder.toleranceAmount ?? tolerance);
  const lines = Array.isArray(invoice.lines || invoice.lineItems) ? (invoice.lines || invoice.lineItems) : [];
  const poLines = Array.isArray(purchaseOrder.lines) ? purchaseOrder.lines : [];
  const qtyOk = lines.length === 0 || lines.every((line) => {
    const poLine = poLines.find((candidate) => candidate.poLine === line.poLine);
    return poLine && Number(line.quantity || 0) <= Number(poLine.remainingQuantity ?? poLine.quantity ?? 0)
      && Math.abs(Number(line.unitPrice || 0) - Number(poLine.unitPrice || 0)) <= Number(poLine.priceTolerance ?? tolerance);
  });
  const reasons = [
    ...(vendorOk ? [] : ['VENDOR_MISMATCH']),
    ...(currencyOk ? [] : ['CURRENCY_MISMATCH']),
    ...(statusOk ? [] : ['PO_NOT_OPEN']),
    ...(priceOk ? [] : ['PRICE_VARIANCE']),
    ...(qtyOk ? [] : ['QUANTITY_VARIANCE'])
  ];
  return { passed: reasons.length === 0, vendorOk, currencyOk, statusOk, priceOk, qtyOk, reasons };
};

const decideV2 = (context) => {
  const hardStops = [
    context.duplicate,
    !context.vendorValid,
    !context.taxValid,
    !context.erpMasterDataValid,
    context.twoWayMatch?.passed === false,
    context.documentTypeBlocked,
    context.postingPeriodClosed,
    context.blockedVendor
  ].filter(Boolean);
  if (hardStops.length) return { decision: 'BLOCK_OR_REVIEW', confidence: 0, hardStops };
  if (Number(context.confidence) >= Number(context.threshold ?? 0.95) * 100
    && Number(context.fieldConfidence) >= Number(context.fieldThreshold ?? 0.95) * 100
    && Number(context.recommendationConfidence) >= Number(context.recommendationThreshold ?? 0.95) * 100) {
    return { decision: 'ELIGIBLE_FOR_AUTO_APPROVAL', confidence: Number(context.confidence), hardStops: [] };
  }
  return { decision: 'HUMAN_REVIEW', confidence: Number(context.confidence || 0), hardStops: [] };
};

const nextStatus = (status, event) => {
  const transitions = {
    RECEIVED: { extract: 'EXTRACTING' }, EXTRACTING: { extracted: 'VALIDATING', failed: 'EXTRACTION_FAILED' },
    VALIDATING: { valid: 'MATCHING', failed: 'VALIDATION_FAILED' }, MATCHING: { matched: 'RECOMMENDED', failed: 'MATCH_EXCEPTION' },
    RECOMMENDED: { approve: 'PENDING_APPROVAL', block: 'DUPLICATE_BLOCKED' }, PENDING_APPROVAL: { approved: 'APPROVED', rejected: 'APPROVAL_REJECTED' },
    APPROVED: { post: 'POSTING' }, POSTING: { posted: 'POSTED', timeout: 'ERP_TIMEOUT', unknown: 'POSTING_UNKNOWN', failed: 'ERP_VALIDATION_FAILED' },
    POSTED: { reconciled: 'RECONCILED', failed: 'RECONCILIATION_FAILED' }
  };
  return transitions[status]?.[event] || status;
};

module.exports = { DOCUMENT_TYPES, validateDocumentType, twoWayMatch, decideV2, nextStatus };