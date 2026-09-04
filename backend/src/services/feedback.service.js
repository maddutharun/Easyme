  const recordFeedback = (invoice, correction, actor) => {
  const event = {
    invoiceId: invoice.id,
    action: 'ACCOUNTING_CORRECTION',
    actorId: actor?.id || actor?.email || 'unknown',
    details: {
      correctedGl: correction.correctedGl || null,
      correctedCostCenter: correction.correctedCostCenter || null,
      correctedTaxCode: correction.correctedTaxCode || null,
      reason: correction.reason || 'Human correction'
    },
    createdAt: new Date().toISOString()
  };
  invoice.feedback = [...(invoice.feedback ?? []), event];
  return event;
};

module.exports = { recordFeedback };