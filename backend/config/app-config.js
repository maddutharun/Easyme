const matchingPolicy = {
  minimumAutoPostConfidence: 98,
  priceVariancePercent: 2,
  totalVarianceAmount: 10,
  requireReceiptForThreeWay: true,
  highValueReviewAmount: 25000
};

const uploadPolicy = {
  maxSizeMb: 10,
  supportedTypes: ['PDF', 'PNG', 'JPG', 'XLS', 'XLSX']
};

const allowedInvoiceMimeTypes = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

const allowedInvoiceExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.xls', '.xlsx']);

module.exports = { matchingPolicy, uploadPolicy, allowedInvoiceMimeTypes, allowedInvoiceExtensions };
