function parseEinvoicePayload(raw) {
  let data = raw;
  if (Buffer.isBuffer(raw) || typeof raw === 'string') {
    try {
      data = JSON.parse(String(raw));
    } catch (error) {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const doc = data.invoice || data.IrnDtls || data;
  const irn = data.irn || data.IRN || doc.irn || doc.IRN || null;
  const seller = data.seller || data.SellerDtls || data.supplier || {};
  const buyer = data.buyer || data.BuyerDtls || {};
  const value = data.value || data.ValDtls || {};
  const itemList = data.itemList || data.ItemList || data.lineItems || [];
  if (!irn && !seller.Gstin && !seller.gstin && !data.invoiceNumber && !doc.invoiceNumber) return null;
  return {
    source: 'e_invoice',
    irn,
    vendor: seller.LglNm || seller.name || seller.legalName || data.vendor || null,
    supplierGstin: seller.Gstin || seller.gstin || null,
    supplierName: seller.LglNm || seller.name || null,
    invoiceNumber: data.DocNo || data.invoiceNumber || doc.No || doc.invoiceNumber || null,
    date: data.DocDt || data.date || doc.Dt || null,
    amount: Number(value.TotInvVal || value.total || data.amount || 0),
    tax: Number(value.IgstVal || value.CgstVal || 0) + Number(value.SgstVal || 0),
    po: data.po || data.PoRef || 'N/A',
    hsnCode: itemList[0]?.HsnCd || itemList[0]?.hsnCode || null,
    lineItems: itemList.map((item) => ({
      sku: item.PrdDesc || item.sku || null,
      description: item.PrdDesc || item.description || null,
      hsnCode: item.HsnCd || item.hsnCode || null,
      quantity: Number(item.Qty || item.quantity || 0),
      unitPrice: Number(item.UnitPrice || item.unitPrice || 0),
      amount: Number(item.TotAmt || item.amount || 0)
    })),
    buyerGstin: buyer.Gstin || buyer.gstin || null,
    shipToDetails: [data.shipTo?.LglNm || data.ShipDtls?.LglNm, data.shipTo?.Addr1 || data.ShipDtls?.Addr1].filter(Boolean).join(', ') || null,
    readable: true
  };
}

function einvoiceToExtracted(parsed) {
  if (!parsed) return null;
  return {
    vendor: parsed.vendor || 'Unknown vendor',
    supplierName: parsed.supplierName || parsed.vendor,
    supplierGstin: parsed.supplierGstin,
    invoiceNumber: parsed.invoiceNumber,
    date: parsed.date,
    amount: parsed.amount,
    tax: parsed.tax,
    po: parsed.po || 'N/A',
    currency: 'INR',
    hsnCode: parsed.hsnCode,
    lineItems: parsed.lineItems || [],
    lineItemCount: (parsed.lineItems || []).length,
    quantity: (parsed.lineItems || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0),
    totalQuantity: (parsed.lineItems || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0),
    taxableAmount: Number(parsed.amount || 0) - Number(parsed.tax || 0),
    shipToDetails: parsed.shipToDetails,
    buyerGstin: parsed.buyerGstin,
    businessUnit: {
      name: null,
      companyCode: parsed.buyerGstin ? `IN${String(parsed.buyerGstin).slice(0, 2)}` : null,
      plant: parsed.shipToDetails || null,
      source: parsed.buyerGstin ? 'buyer_gstin' : 'e_invoice'
    },
    irn: parsed.irn,
    readable: true,
    extractionIssue: null,
    pipeline: { documentType: 'e_invoice', status: 'ready_for_matching', source: 'irn_json' },
    readyForMatching: true,
    needsReview: false,
    fieldConfidence: { vendor: 0.99, invoiceNumber: 0.99, amount: 0.99, tax: 0.95, po: parsed.po && parsed.po !== 'N/A' ? 0.9 : 0.4, date: 0.9, hsnCode: parsed.hsnCode ? 0.9 : 0.4 }
  };
}

module.exports = { parseEinvoicePayload, einvoiceToExtracted };
