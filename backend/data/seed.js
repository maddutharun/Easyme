const vendors = [
  {
    id: 'V-1042',
    name: 'Northstar Office Co.',
    status: 'Active',
    category: 'Office supplies'
  },
  {
    id: 'V-2108',
    name: 'Cultsport Private Limited',
    status: 'Active',
    category: 'Fitness equipment'
  },
  {
    id: 'V-3310',
    name: 'President International',
    status: 'Active',
    category: 'Manufacturing'
  }
];

const transactions = [
  {
    po: 'PO-4500188',
    vendorId: 'V-1042',
    vendor: 'Northstar Office Co.',
    receipt: 'GR-88021',
    received: 120,
    poTotal: 12480,
    description: 'Ergonomic monitor arms',
    glAccount: '620010',
    costCenter: 'IT001',
    taxCode: 'GST18',
    currency: 'USD',
    lines: [{ sku: 'ARM-1', hsnCode: '998314', quantity: 120, unitPrice: 104, amount: 12480 }]
  },
  {
    po: 'PO-4500102',
    vendorId: 'V-1042',
    vendor: 'Northstar Office Co.',
    receipt: 'GR-88002',
    received: 80,
    poTotal: 11000,
    description: 'Monitor arms',
    glAccount: '620010',
    costCenter: 'IT001',
    taxCode: 'GST18',
    lines: [{ sku: 'ARM-1', hsnCode: '998314', quantity: 80, unitPrice: 137.5, amount: 11000 }]
  },
  {
    po: 'PO-4500110',
    vendorId: 'V-1042',
    vendor: 'Northstar Office Co.',
    receipt: 'GR-88010',
    received: 90,
    poTotal: 13000,
    description: 'Office equipment',
    glAccount: '620010',
    costCenter: 'IT001',
    taxCode: 'GST18'
  },
  {
    po: 'PO-4500191',
    vendorId: 'V-1042',
    vendor: 'Northstar Office Co.',
    receipt: 'GR-88031',
    received: 96,
    poTotal: 12096,
    description: 'Office furniture',
    glAccount: '620010',
    costCenter: 'IT001',
    taxCode: 'GST18'
  },
  {
    po: 'PO-7804412',
    vendorId: 'V-2108',
    vendor: 'Cultsport Private Limited',
    receipt: 'GR-99101',
    received: 12,
    poTotal: 1811.52,
    description: 'Cult Tummy Trimmer CST701STBKNA',
    glAccount: '510210',
    costCenter: 'OPS002',
    taxCode: 'GST18'
  }
];

const invoices = [
  {
    id: 'INV-88214',
    vendorId: 'V-1042',
    vendor: 'Northstar Office Co.',
    invoiceNumber: 'NS-88214',
    date: '2026-08-26',
    amount: 12480,
    currency: 'USD',
    po: 'PO-4500188',
    receipt: 'GR-88021',
    quantity: 120,
    tax: 0,
    status: 'posted',
    confidence: 96.4,
    issue: 'Matched PO, receipt, and vendor master'
  },
  {
    id: 'INV-2048',
    vendorId: 'V-1042',
    vendor: 'Northstar Office Co.',
    invoiceNumber: 'INV-2048',
    date: '2026-08-14',
    amount: 12096,
    currency: 'USD',
    po: 'PO-4500191',
    receipt: 'GR-88031',
    quantity: 96,
    tax: 896,
    status: 'pending_review',
    confidence: 81.2,
    issue: 'Tax amount requires reviewer confirmation'
  },
  {
    id: 'INV-UP1470740',
    vendorId: 'V-2108',
    vendor: 'Cultsport Private Limited',
    invoiceNumber: 'UP1470740',
    date: '2026-08-14',
    amount: 1811.52,
    currency: 'INR',
    po: 'PO-7804412',
    receipt: 'GR-99101',
    quantity: 12,
    tax: 1811.52,
    status: 'on_hold',
    confidence: 74.8,
    issue: 'GST total needs India compliance review'
  }
];

module.exports = { vendors, transactions, invoices };
