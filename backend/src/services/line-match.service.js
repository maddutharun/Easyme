const DEFAULT_PROFILE = { qty_tolerance_pct: 2, line_amount_tolerance_pct: 1 };

function withinPct(actual, expected, pct) {
  const right = Number(expected || 0);
  const left = Number(actual || 0);
  if (right === 0) return Math.abs(left) <= 0.01;
  return Math.abs(left - right) <= Math.max(0.01, Math.abs(right) * (Number(pct || 0) / 100));
}

function matchInvoiceLines(invoiceLines = [], po = {}, invoice = {}, profile = DEFAULT_PROFILE) {
  const poLines = Array.isArray(po.lines) && po.lines.length
    ? po.lines
    : (po.poTotal ? [{ quantity: po.received || po.quantity || 1, amount: po.poTotal, hsnCode: invoice.hsnCode, sku: null, description: po.description }] : []);
  const results = [];
  for (const line of invoiceLines || []) {
    const skuHit = poLines.find((row) => line.sku && row.sku && String(row.sku).toLowerCase() === String(line.sku).toLowerCase());
    const hsnHit = poLines.find((row) => line.hsnCode && row.hsnCode && String(row.hsnCode) === String(line.hsnCode));
    const poLine = skuHit || hsnHit || poLines[0] || null;
    const qtyOk = poLine ? withinPct(line.quantity, poLine.quantity ?? po.received, profile.qty_tolerance_pct) : false;
    const amtOk = poLine ? withinPct(line.amount, poLine.amount ?? po.poTotal, profile.line_amount_tolerance_pct) : false;
    results.push({
      sku: line.sku,
      hsnCode: line.hsnCode,
      matched: Boolean(poLine) && qtyOk && amtOk,
      quantityOk: qtyOk,
      amountOk: amtOk,
      reason: !poLine
        ? 'No PO line to match'
        : (!qtyOk ? `Qty ${line.quantity} vs PO ${poLine.quantity ?? po.received}` : (!amtOk ? `Amount ${line.amount} vs PO ${poLine.amount ?? po.poTotal}` : 'Line matched'))
    });
  }
  const matchedCount = results.filter((row) => row.matched).length;
  return {
    mode: invoice.mode || '3-way',
    po: po.po || null,
    receipt: po.receipt || null,
    lineCount: results.length,
    matchedCount,
    passed: results.length ? matchedCount === results.length : null,
    lines: results
  };
}

module.exports = { matchInvoiceLines, withinPct };
