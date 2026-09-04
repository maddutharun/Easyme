  const reconcilePostedInvoice = async (invoice, erp) => {
  if (!invoice?.posting?.erpDocumentNumber && !invoice?.erpDocument) {
    throw new Error('Invoice has no ERP document number');
  }
  const documentNumber = invoice.posting?.erpDocumentNumber ?? invoice.erpDocument;
  const erpDocument = await erp.getPostedDocument(documentNumber);
  const amountMatches = Number(erpDocument.total) === Number(invoice.amount ?? invoice.total);
  const invoiceNumberMatches = erpDocument.invoiceNumber === invoice.invoiceNumber;
  return {
    reconciled: amountMatches && invoiceNumberMatches,
    checks: { amountMatches, invoiceNumberMatches },
    erpDocumentNo: documentNumber
  };
};

module.exports = { reconcilePostedInvoice };