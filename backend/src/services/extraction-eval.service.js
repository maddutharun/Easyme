function scoreField(actual, expected, { numeric = false, tolerance = 0.01 } = {}) {
  if (expected === undefined) return { scored: false };
  if (numeric) {
    const delta = Math.abs(Number(actual || 0) - Number(expected || 0));
    return { scored: true, match: delta <= tolerance, actual, expected, delta };
  }
  const left = String(actual ?? '').trim().toLowerCase();
  const right = String(expected ?? '').trim().toLowerCase();
  return { scored: true, match: left === right, actual, expected };
}

function scoreExtraction(extracted, expected = {}) {
  const fields = {
    vendor: scoreField(extracted.vendor, expected.vendor),
    invoiceNumber: scoreField(extracted.invoiceNumber, expected.invoiceNumber),
    po: scoreField(extracted.po, expected.po),
    date: scoreField(extracted.date, expected.date),
    amount: scoreField(extracted.amount, expected.amount, { numeric: true, tolerance: expected.amountTolerance ?? 0.01 }),
    tax: scoreField(extracted.tax, expected.tax, { numeric: true, tolerance: expected.taxTolerance ?? 0.01 }),
    hsnCode: scoreField(extracted.hsnCode, expected.hsnCode)
  };
  const scored = Object.values(fields).filter((item) => item.scored);
  const matches = scored.filter((item) => item.match);
  const lineExpected = Number(expected.lineItemCount);
  const lineActual = Number(extracted.lineItemCount || extracted.lineItems?.length || 0);
  const lineMatch = Number.isFinite(lineExpected) ? lineActual === lineExpected : null;
  return {
    fields,
    fieldAccuracy: scored.length ? Number((matches.length / scored.length).toFixed(4)) : 0,
    lineItemCount: { actual: lineActual, expected: lineExpected, match: lineMatch },
    readyForMatching: extracted.readyForMatching !== false
  };
}

function summarizeEval(results = []) {
  const total = results.length;
  const avg = total ? results.reduce((sum, item) => sum + Number(item.fieldAccuracy || 0), 0) / total : 0;
  return {
    invoices: total,
    averageFieldAccuracy: Number(avg.toFixed(4)),
    perfect: results.filter((item) => item.fieldAccuracy === 1).length
  };
}

module.exports = { scoreField, scoreExtraction, summarizeEval };
