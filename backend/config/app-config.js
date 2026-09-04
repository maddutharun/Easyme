const matchingPolicy = {
  minimumAutoPostConfidence: 98,
  priceVariancePercent: 2,
  totalVarianceAmount: 10,
  requireReceiptForThreeWay: true,
  highValueReviewAmount: 25000
};

const uploadPolicy = {
  maxSizeMb: 10,
  supportedTypes: ['PDF', 'PNG', 'JPG', 'TIFF', 'XLS', 'XLSX']
};

const allowedInvoiceMimeTypes = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/tiff',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

const allowedInvoiceExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.xls', '.xlsx']);

module.exports = { matchingPolicy, uploadPolicy, allowedInvoiceMimeTypes, allowedInvoiceExtensions };
