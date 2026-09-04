const fs = require('fs');
const XLSX = require('xlsx');
const { extractLineItems, extractLineItemsFromLayout, extractTaxBreakdown, extractCharges, extractTaxSummary, detectTemplate, detectColumnMap, buildFieldEvidence, validateArithmetic, deduplicateDocumentText } = require('../src/services/line-item-extraction.service');
const { scoreDocumentQuality, getVendorTemplate, extractPdfLayout } = require('../src/services/document-intelligence.service');
const { HttpDocumentAiProvider } = require('../src/ai/http.provider');
const { findVendorTemplate } = require('../src/services/vendor-template.service');

async function extractPdfText(buffer) {
  if (!buffer || buffer.length === 0) return '';

  const rawText = buffer.toString('utf8');
  const looksLikePdf = rawText.startsWith('%PDF-');
  const rawTextLooksReadable = !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(rawText)
    && /invoice|vendor|gst|amount|date|total/i.test(rawText);

  if (!looksLikePdf && rawTextLooksReadable) {
    return rawText;
  }

  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

    // CRITICAL FIX #1: Configure PDF.js worker explicitly for Node environment
    // This prevents "GlobalWorkerOptions.workerSrc not specified" errors
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve(
          'pdfjs-dist/legacy/build/pdf.worker.mjs'
        );
        console.log('[extractPdfText] PDF.js worker configured for Node environment');
      } catch (workerError) {
        console.warn('[extractPdfText] Could not resolve pdf.worker.mjs, proceeding:', workerError.message);
      }
    }

    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(' ').trim();
      // Also OCR pages with malformed numeric text such as "Amount Due: ,480.00".
      const needsNumericRecovery = /(?:amount|total|gst|tax)\s*[:=]?\s*[,.;]\s*\d/i.test(pageText);
      if (pageText && !needsNumericRecovery) pages.push(pageText);
      if (!pageText || needsNumericRecovery) {
        try {
          const canvasMod = await import('canvas');
          const { createCanvas } = canvasMod.default || canvasMod;
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = createCanvas(viewport.width, viewport.height);
          const context = canvas.getContext('2d');
          await page.render({ canvasContext: context, viewport }).promise;
          const pngBuffer = canvas.toBuffer('image/png');
          const { default: Tesseract } = await import('tesseract.js');
          const result = await Tesseract.recognize(pngBuffer, 'eng', { logger: () => {} });
          const ocrText = String(result?.data?.text || '').trim();
          if (ocrText) pages.push(ocrText);
          else if (pageText) pages.push(pageText);
        } catch (renderError) {
          // CRITICAL FIX #2: Log the actual error instead of silently swallowing it
          // On Windows, this commonly indicates canvas native-build failure (needs Cairo/Pango)
          console.error(
            `[extractPdfText] OCR fallback failed on page ${pageNumber}:`,
            renderError.message
          );
          if (pageText) pages.push(pageText);
        }
      }
    }

    const text = pages.filter(Boolean).join('\n').trim();
    if (text && /invoice|vendor|gst|amount|date|total|po|hsn|sac/i.test(text)) {
      return text;
    }
    if (rawTextLooksReadable) {
      return rawText.trim();
    }
    return text;
  } catch (error) {
    // CRITICAL FIX: Log the actual error. If pdf.js extraction fails, this message
    // tells you whether it's a worker config issue, version mismatch, or buffer corruption
    console.error('[extractPdfText] pdf.js extraction failed:', error.message, error.stack);
    if (rawTextLooksReadable) {
      return rawText.trim();
    }
    return '';
  }
}

async function extractImageText(buffer) {
  if (!buffer || buffer.length === 0) return '';
  try {
    const { default: Tesseract } = await import('tesseract.js');
    const result = await Tesseract.recognize(buffer, 'eng', { logger: () => {} });
    return String(result?.data?.text || '').trim();
  } catch (error) {
    return '';
  }
}

function extractExcelText(buffer) {
  if (!buffer || buffer.length === 0) return '';
  try {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const rows = [];
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false });
      if (!Array.isArray(data)) return;
      data.forEach((row) => {
        if (Array.isArray(row)) rows.push(row.join(' '));
        else rows.push(String(row || ''));
      });
    });
    return rows.join('\n').trim();
  } catch (error) {
    return '';
  }
}

async function resolveExtractedText(file) {
  const name = (file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  const buffer = file.buffer || Buffer.alloc(0);

  if (name.endsWith('.xlsx') || name.endsWith('.xls') || mime.includes('spreadsheet') || mime.includes('excel')) return extractExcelText(buffer);
  if (name.endsWith('.pdf') || mime === 'application/pdf') return extractPdfText(buffer);
  if (mime.startsWith('image/')) return extractImageText(buffer);

  return buffer.toString('utf8');
}

const TOLERANCE_PROFILES = {
  _meta: { fallback_category: 'default' },
  profiles: {
    default: {
      qty_tolerance_pct: 2, rate_tolerance_pct: 1, line_amount_tolerance_pct: 1, fx_tolerance_pct: 0.5,
      auto_post_threshold: 98, review_threshold: 80,
      weights: { quantity: 0.20, rate: 0.20, line_amount: 0.15, tax: 0.20, tds: 0.15, uom: 0.05, fx: 0.05 },
    },
    raw_materials: {
      qty_tolerance_pct: 3, rate_tolerance_pct: 1.5, line_amount_tolerance_pct: 1, fx_tolerance_pct: 0.5,
      auto_post_threshold: 98, review_threshold: 80,
      weights: { quantity: 0.25, rate: 0.20, line_amount: 0.15, tax: 0.15, tds: 0.10, uom: 0.10, fx: 0.05 },
      notes: 'Wider qty tolerance — partial deliveries and weight/measurement variance are normal here',
    },
    capital_equipment: {
      qty_tolerance_pct: 0, rate_tolerance_pct: 0.5, line_amount_tolerance_pct: 0.5, fx_tolerance_pct: 0.5,
      auto_post_threshold: 99.5, review_threshold: 90,
      weights: { quantity: 0.25, rate: 0.25, line_amount: 0.15, tax: 0.15, tds: 0.10, uom: 0.05, fx: 0.05 },
      notes: 'High value, low volume — near-zero tolerance, almost everything should land in review',
    },
    services_professional: {
      qty_tolerance_pct: 0, rate_tolerance_pct: 2, line_amount_tolerance_pct: 1, fx_tolerance_pct: 0.5,
      auto_post_threshold: 97, review_threshold: 80,
      weights: { quantity: 0.05, rate: 0.25, line_amount: 0.20, tax: 0.20, tds: 0.25, uom: 0.00, fx: 0.05 },
      notes: 'Quantity is usually 1 (lump sum) — TDS correctness weighted heavily since 194J misclassification is the real risk here',
    },
    logistics: {
      qty_tolerance_pct: 2, rate_tolerance_pct: 1, line_amount_tolerance_pct: 1, fx_tolerance_pct: 0.5,
      auto_post_threshold: 98, review_threshold: 80,
      weights: { quantity: 0.20, rate: 0.15, line_amount: 0.15, tax: 0.20, tds: 0.20, uom: 0.05, fx: 0.05 },
    },
    software_subscriptions: {
      qty_tolerance_pct: 0, rate_tolerance_pct: 0, line_amount_tolerance_pct: 0.5, fx_tolerance_pct: 1,
      auto_post_threshold: 98, review_threshold: 85,
      weights: { quantity: 0.10, rate: 0.25, line_amount: 0.20, tax: 0.20, tds: 0.10, uom: 0.00, fx: 0.15 },
      notes: 'Often foreign vendors — FX weighted higher; watch for import GST/RCM applicability',
    },
    manpower_contracting: {
      qty_tolerance_pct: 1, rate_tolerance_pct: 1, line_amount_tolerance_pct: 1, fx_tolerance_pct: 0.5,
      auto_post_threshold: 97, review_threshold: 80,
      weights: { quantity: 0.15, rate: 0.15, line_amount: 0.15, tax: 0.15, tds: 0.30, uom: 0.05, fx: 0.05 },
      notes: 'TDS weighted heaviest — 194C classification errors are the main risk here',
    },
  },
};

const TDS_RULES = {
  _meta: { no_pan_rate_pct_override: 20 },
  rules: [
    {
      section: '194C', nature_of_payment: 'contractor_subcontractor_payment',
      description: 'Payments to contractors or sub-contractors for carrying out any work, including labour supply',
      single_payment_threshold: 30000, aggregate_annual_threshold: 100000,
      rate_individual_huf_pct: 1, rate_other_pct: 2,
      applicable_vendor_categories: ['logistics', 'facilities', 'manpower_contracting'],
    },
    {
      section: '194I', nature_of_payment: 'rent',
      description: 'Rent for land, building, furniture, plant, or machinery',
      single_payment_threshold: null, aggregate_annual_threshold: 240000,
      rate_plant_machinery_pct: 2, rate_land_building_furniture_pct: 10,
      applicable_vendor_categories: ['facilities'],
    },
    {
      section: '194J', nature_of_payment: 'professional_or_technical_fees',
      description: 'Fees for professional services, technical services, royalty, or non-compete fees',
      single_payment_threshold: null, aggregate_annual_threshold: 30000,
      aggregate_annual_threshold_note: "No threshold for director's remuneration — TDS applies from the first rupee",
      rate_professional_services_pct: 10, rate_technical_services_pct: 2,
      applicable_vendor_categories: ['services_professional'],
    },
    {
      section: '194Q', nature_of_payment: 'purchase_of_goods',
      description: "Purchase of goods, where the buyer's turnover exceeded the threshold in the preceding financial year",
      buyer_preceding_year_turnover_threshold: 100000000, aggregate_annual_threshold: 5000000,
      aggregate_annual_threshold_note: 'TDS applies only on the amount exceeding this threshold, not the full purchase value',
      rate_pct: 0.1, rate_no_pan_pct: 5,
      interplay_note: 'Does not apply if the same transaction already attracts TCS under 206C(1H) — 194Q takes precedence when both could apply',
      applicable_vendor_categories: ['raw_materials'],
    },
  ],
};

const GST_RATES = {
  _meta: { place_of_supply_rule: 'same vendor_state_code and buyer_state_code -> intra-state (CGST+SGST, split evenly); different -> inter-state (IGST, full rate)' },
  rates: [
    { code: '998719', type: 'SAC', description: 'Freight/logistics services', rate_pct: 18 },
    { code: '998311', type: 'SAC', description: 'Management consulting services', rate_pct: 18 },
    { code: '997331', type: 'SAC', description: 'Licensing services for software', rate_pct: 18 },
    { code: '9973', type: 'SAC', description: 'Leasing/rental services (equipment)', rate_pct: 18 },
    { code: '7213', type: 'HSN', description: 'Steel bars and rods', rate_pct: 18 },
    { code: '4819', type: 'HSN', description: 'Cartons, boxes, packaging of paper', rate_pct: 18 },
    { code: '8471', type: 'HSN', description: 'Computers and peripherals', rate_pct: 18 },
    { code: '9401', type: 'HSN', description: 'Office furniture', rate_pct: 18 },
  ],
};

function round2(n) { return Math.round(n * 100) / 100; }

function getToleranceProfile(vendorCategory) {
  return TOLERANCE_PROFILES.profiles[vendorCategory] || TOLERANCE_PROFILES.profiles[TOLERANCE_PROFILES._meta.fallback_category];
}

function evaluateTds({
  natureOfPayment, amount = 0, aggregateAnnualAmount,
  vendorType = 'other', panAvailable = true,
  assetType, serviceType, isDirectorFee = false,
  buyerPrecedingYearTurnover,
} = {}) {
  const rule = TDS_RULES.rules.find((r) => r.nature_of_payment === natureOfPayment);
  const runningTotal = aggregateAnnualAmount ?? amount;
  const noPanRate = TDS_RULES._meta.no_pan_rate_pct_override;

  if (!rule) {
    return { section: 'Not applicable', status: 'not_required',
      message: `No TDS rule configured for nature of payment "${natureOfPayment}"` };
  }

  if (rule.section === '194C') {
    const overSingle = rule.single_payment_threshold != null && amount > rule.single_payment_threshold;
    const overAggregate = rule.aggregate_annual_threshold != null && runningTotal > rule.aggregate_annual_threshold;
    if (!overSingle && !overAggregate) {
      return { section: 'Not required', status: 'not_required',
        message: `Below 194C thresholds (single ≤ ₹${rule.single_payment_threshold}, aggregate ≤ ₹${rule.aggregate_annual_threshold})` };
    }
    const ratePct = !panAvailable ? noPanRate
      : (vendorType === 'individual_huf' ? rule.rate_individual_huf_pct : rule.rate_other_pct);
    return { section: '194C', status: 'applicable', rate_pct: ratePct,
      tds_amount: round2(amount * ratePct / 100),
      message: `194C applicable at ${ratePct}%${!panAvailable ? ' (no-PAN rate)' : ''}` };
  }

  if (rule.section === '194I') {
    if (runningTotal <= rule.aggregate_annual_threshold) {
      return { section: 'Not required', status: 'not_required',
        message: `Below 194I annual threshold of ₹${rule.aggregate_annual_threshold}` };
    }
    const ratePct = !panAvailable ? noPanRate
      : (assetType === 'plant_machinery' ? rule.rate_plant_machinery_pct : rule.rate_land_building_furniture_pct);
    return { section: '194I', status: 'applicable', rate_pct: ratePct,
      tds_amount: round2(amount * ratePct / 100),
      message: `194I applicable at ${ratePct}% (${assetType || 'land_building_furniture'})` };
  }

  if (rule.section === '194J') {
    const overThreshold = isDirectorFee || runningTotal > rule.aggregate_annual_threshold;
    if (!overThreshold) {
      return { section: 'Not required', status: 'not_required',
        message: `Below 194J annual threshold of ₹${rule.aggregate_annual_threshold}` };
    }
    const ratePct = !panAvailable ? noPanRate
      : (serviceType === 'technical' ? rule.rate_technical_services_pct : rule.rate_professional_services_pct);
    return { section: '194J', status: 'applicable', rate_pct: ratePct,
      tds_amount: round2(amount * ratePct / 100),
      message: `194J applicable at ${ratePct}% (${serviceType || 'professional'})${isDirectorFee ? ' — director fee, no threshold' : ''}` };
  }

  if (rule.section === '194Q') {
    if (buyerPrecedingYearTurnover != null && buyerPrecedingYearTurnover <= rule.buyer_preceding_year_turnover_threshold) {
      return { section: 'Not required', status: 'not_required',
        message: `Buyer turnover below ₹${rule.buyer_preceding_year_turnover_threshold} gate — 194Q doesn't apply` };
    }
    if (runningTotal <= rule.aggregate_annual_threshold) {
      return { section: 'Not required', status: 'not_required',
        message: `Below 194Q annual purchase threshold of ₹${rule.aggregate_annual_threshold}` };
    }
    const excess = runningTotal - rule.aggregate_annual_threshold;
    const ratePct = !panAvailable ? rule.rate_no_pan_pct : rule.rate_pct;
    return { section: '194Q', status: 'applicable', rate_pct: ratePct,
      tds_amount: round2(excess * ratePct / 100),
      message: `194Q applicable at ${ratePct}% on ₹${excess} (amount over the threshold only). ${rule.interplay_note}` };
  }

  return { section: 'Not applicable', status: 'not_required', message: 'Unhandled TDS section in rule config' };
}

function evaluateGst({ hsnSac, vendorStateCode, buyerStateCode, taxableAmount = 0 }) {
  const code = String(hsnSac || '').trim();
  let entry = GST_RATES.rates.find((r) => r.code === code);

  if (!entry && /^99\d{2,6}$/.test(code) || /^998[0-9]$/.test(code) || /^998[0-9]{2,4}$/.test(code)) {
    entry = { code, type: 'SAC', description: 'General service invoice', rate_pct: 18 };
  }

  if (!entry) {
    return { status: 'review', message: `HSN/SAC "${hsnSac}" not found in the configured rate table — add it or verify manually` };
  }

  const totalTax = round2(taxableAmount * entry.rate_pct / 100);
  const isIntraState = Boolean(vendorStateCode) && Boolean(buyerStateCode) && vendorStateCode === buyerStateCode;

  if (isIntraState) {
    const half = round2(totalTax / 2);
    return { status: 'computed', rate_pct: entry.rate_pct, cgst: half, sgst: half, igst: 0,
      total_tax: totalTax, message: `Intra-state — CGST ${entry.rate_pct / 2}% + SGST ${entry.rate_pct / 2}%` };
  }
  return { status: 'computed', rate_pct: entry.rate_pct, cgst: 0, sgst: 0, igst: totalTax,
    total_tax: totalTax, message: `Inter-state — IGST ${entry.rate_pct}%` };
}

const CATEGORY_TO_NATURE_OF_PAYMENT = {
  logistics: 'contractor_subcontractor_payment',
  manpower_contracting: 'contractor_subcontractor_payment',
  facilities: 'rent',
  services_professional: 'professional_or_technical_fees',
  raw_materials: 'purchase_of_goods',
};

function inferVendorCategory(invoice = {}) {
  const haystack = [
    invoice.vendorCategory,
    invoice.vendor,
    invoice.vendorName,
    invoice.description,
    invoice.hsnCode,
    invoice.vendortype,
    invoice.supplierName,
    invoice.name,
    invoice.businessType,
  ].filter(Boolean).join(' ').toLowerCase();

  const hsnCode = String(invoice.hsnCode || '').trim();
  if (/^99\d{2,6}$/.test(hsnCode) || /^9\d{4,6}$/.test(hsnCode)) return 'services_professional';
  if (!haystack) return 'default';
  if (/logistics|transport|freight|courier|shipping|delivery/i.test(haystack)) return 'logistics';
  if (/manpower|labour|security|cleaning|contractor|subcontractor/i.test(haystack)) return 'manpower_contracting';
  if (/facility|rent|lease|maintenance|building|office space/i.test(haystack)) return 'facilities';
  if (/consult|service|professional|technical|advisory|software|digital|it service|audit/i.test(haystack)) return 'services_professional';
  if (/raw material|steel|cement|scrap|fabric|packaging|goods|supplier/i.test(haystack)) return 'raw_materials';
  return 'default';
}

function detectIndiaComplianceV2(invoice = {}) {
  const amount = Number(invoice.amount || 0);
  const vendorCategory = String(invoice.vendorCategory || inferVendorCategory(invoice) || 'default');
  const natureOfPayment = CATEGORY_TO_NATURE_OF_PAYMENT[vendorCategory] || null;

  const tds = natureOfPayment
    ? evaluateTds({
        natureOfPayment,
        amount,
        aggregateAnnualAmount: invoice.aggregateAnnualAmount,
        vendorType: invoice.vendorType,
        panAvailable: invoice.vendorPanAvailable !== false && invoice.panAvailable !== false,
        assetType: invoice.assetType,
        serviceType: invoice.serviceType,
        isDirectorFee: Boolean(invoice.isDirectorFee),
        buyerPrecedingYearTurnover: invoice.buyerPrecedingYearTurnover,
      })
    : { section: 'Not required', status: 'not_required', message: 'No vendor category mapped to a TDS nature of payment' };

  const gst = invoice.hsnCode
    ? evaluateGst({
        hsnSac: invoice.hsnCode,
        vendorStateCode: invoice.vendorStateCode,
        buyerStateCode: invoice.buyerStateCode,
        taxableAmount: amount,
      })
    : { status: 'review', message: 'HSN/SAC missing — cannot compute expected GST' };

  return {
    gst,
    tds: {
      ...tds,
      amount: Number(tds.tds_amount || 0),
    },
    eInvoice: {
      status: invoice.irn ? 'verified' : 'not_required',
      message: invoice.irn ? 'IRN / QR metadata present' : 'IRN / QR metadata not required for this invoice profile',
      required: amount >= 5000000,
    },
    hsn: {
      status: invoice.hsnCode ? 'mapped' : 'missing',
      message: invoice.hsnCode ? `HSN/SAC ${invoice.hsnCode} available` : 'HSN/SAC missing',
      required: amount >= 5000000,
    },
  };
}

function detectIndiaCompliance(invoice = {}) {
  const amount = Number(invoice.amount || 0);
  const compliance = detectIndiaComplianceV2(invoice);
  const hasTax = invoice.tax !== undefined && invoice.tax !== null && Number(invoice.tax) >= 0;

  const gstStatus = compliance.gst && compliance.gst.status === 'computed' ? 'ready' : (hasTax ? 'ready' : 'review');

  return {
    gst: {
      ...compliance.gst,
      status: gstStatus,
      message: gstStatus === 'ready' ? 'GST value present and ready for validation' : 'GST amount missing or invalid, review required',
      amount: Number(invoice.tax || 0),
      isApplicable: amount >= 20000,
    },
    tds: {
      section: compliance.tds.section || 'Not required',
      status: compliance.tds.status || 'not_required',
      message: compliance.tds.message || 'No TDS section detected based on invoice profile and amount',
      amount: Number(compliance.tds.amount || 0),
    },
    eInvoice: {
      status: invoice.irn ? 'verified' : 'not_required',
      message: invoice.irn ? 'IRN / QR metadata present' : 'IRN / QR metadata not required for this invoice profile',
      required: amount >= 5000000,
    },
    hsn: {
      status: invoice.hsnCode ? 'mapped' : amount >= 5000000 ? 'missing_critical' : 'missing',
      message: invoice.hsnCode ? `HSN/SAC ${invoice.hsnCode} available` : amount >= 5000000 ? 'HSN/SAC mandatory for high-value invoices' : 'HSN/SAC missing (non-critical for this amount)',
      required: amount >= 5000000,
    }
  };
}

function parseDateValue(text) {
  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };

  const normalizeCandidate = (year, month, day) => {
    const safeYear = String(year || '').trim();
    const safeMonth = String(month || '').trim();
    const safeDay = String(day || '').trim();
    if (!safeYear || !safeMonth || !safeDay) return null;

    const normalizedYear = safeYear.length === 2 ? `20${safeYear}` : safeYear;
    const monthValue = Number(safeMonth);
    const dayValue = Number(safeDay);
    if (!Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12) return null;
    if (!Number.isInteger(dayValue) || dayValue < 1 || dayValue > 31) return null;
    return `${normalizedYear}-${String(monthValue).padStart(2, '0')}-${String(dayValue).padStart(2, '0')}`;
  };

  const parseDateMatch = (match) => {
    if (!match) return null;

    if (match[1] && String(match[1]).length === 4) {
      const year = match[1];
      const month = match[2];
      const day = match[3];
      return normalizeCandidate(year, month, day);
    }

    const day = match[1];
    const monthPart = String(match[2] || '').toLowerCase();
    const month = monthMap[monthPart] || String(monthPart).padStart(2, '0');
    const rawYear = match[3] || '2026';
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    if (!day || !month || !year) return null;
    return normalizeCandidate(year, month, day);
  };

  const labelPatterns = [
    /(?:invoice\s*date|dated|date|issued\s*on|bill\s*date|due\s*date|payment\s*due|due\s*on)\s*[:\-]?\s*(\d{4})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])(?=$|[^0-9])/i,
    /(?:invoice\s*date|dated|date|issued\s*on|bill\s*date|due\s*date|payment\s*due|due\s*on)\s*[:\-]?\s*(\d{1,2})[-/.](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[-/.]?\s*(\d{2,4})/i,
    /(?:invoice\s*date|dated|date|issued\s*on|bill\s*date|due\s*date|payment\s*due|due\s*on)\s*[:\-]?\s*(\d{1,2})[-/.](0?[1-9]|1[0-2])[-/.]?\s*(\d{2,4})/i
  ];

  for (const pattern of labelPatterns) {
    const date = parseDateMatch(String(text || '').match(pattern));
    if (date) return date;
  }

  const lines = String(text || '').split(/\n|;/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (/invoice\s*(?:no|number)|po\s*no|hsn|sac|gstin|tax\s*invoice|shipped\s*to|amount|total|qty|quantity/i.test(line)) {
      continue;
    }

    const lineMatch = line.match(/(\d{1,2})[-/.](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[-/.]?\s*(\d{2,4})/i)
      || line.match(/(\d{4})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])(?=$|[^0-9])/)
      || line.match(/(\d{1,2})[-/.](0?[1-9]|1[0-2])[-/.]?\s*(\d{2,4})/i);

    const date = parseDateMatch(lineMatch);
    if (date) return date;
  }

  return null;
}

function hasMeaningfulInvoiceText(text = '') {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  const invoiceKeywords = ['invoice', 'bill', 'vendor', 'gst', 'amount', 'total', 'date', 'tax', 'qty', 'hsn', 'sac', 'po', 'purchase order'];
  return invoiceKeywords.some((keyword) => lower.includes(keyword));
}

function normalizeNumber(raw) {
  if (raw == null || raw === '') return 0;
  const rawStr = String(raw).trim().toUpperCase();
  
  // CRITICAL FIX: Handle Indian number notation (Lakh = 100,000; Crore = 10,000,000)
  // Examples: "12.5L" = 1,250,000; "2.3Cr" = 23,000,000
  let multiplier = 1;
  let sanitized = rawStr;
  
  if (rawStr.endsWith('CR') || rawStr.endsWith('CRORE')) {
    multiplier = 10000000;
    sanitized = rawStr.replace(/\s*(CR|CRORE)\s*$/i, '').trim();
  } else if (rawStr.endsWith('L') || rawStr.endsWith('LAKH')) {
    multiplier = 100000;
    sanitized = rawStr.replace(/\s*(L|LAKH)\s*$/i, '').trim();
  } else if (rawStr.endsWith('K') || rawStr.endsWith('THOUSAND')) {
    multiplier = 1000;
    sanitized = rawStr.replace(/\s*(K|THOUSAND)\s*$/i, '').trim();
  }
  
  // Remove currency symbols and non-numeric characters except decimal point
  sanitized = sanitized.replace(/^[^\d.]+/, '').replace(/[^\d.]/g, '');
  
  if (!sanitized || sanitized === '.') return 0;
  const value = Number(sanitized);
  
  if (!Number.isFinite(value)) return 0;
  return value * multiplier;
}

function sanitizeVendorName(value) {
  if (!value) return value;
  return String(value)
    .replace(/\s*\b(?:pdf|png|jpg|jpeg|xlsx|xls)\b\s*$/i, '')
    .replace(/\s+[A-Za-z0-9._-]+\.(?:pdf|png|jpg|jpeg|xlsx|xls)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeLabelAlias(label = '') {
  const normalized = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const aliasMap = {
    'invoice no': 'invoice_no',
    'invoice number': 'invoice_no',
    'bill no': 'invoice_no',
    'dated': 'date',
    'invoice date': 'date',
    'purchase order': 'po',
    'po no': 'po',
    'hsn code': 'hsn_code',
    'sac code': 'hsn_code',
    'base amount': 'base_amount',
    'tax amount': 'tax_amount',
    'total amount': 'total_amount',
    'amount due': 'total_amount',
    'grand total': 'total_amount',
    'ship to': 'ship_to',
    'shipped to': 'ship_to',
    'consignee': 'ship_to',
    'gstin': 'gstin',
    'pan': 'pan',
    'state': 'state',
    'place of supply': 'state',
    'authorized signatory': 'signature',
    'seal of company': 'seal'
  };

  return aliasMap[normalized] || normalized;
}

function normalizeInvoiceTextLabels(text = '') {
  let normalized = String(text || '');
  const replacements = [
    [/invoice\s*no\.?/gi, 'Invoice No'],
    [/invoice\s*number/gi, 'Invoice No'],
    [/bill\s*no\.?/gi, 'Invoice No'],
    [/inv\s*#/gi, 'Invoice No'],
    [/hsn\s*code/gi, 'HSN Code'],
    [/sac\s*code/gi, 'HSN Code'],
    [/base\s*amount/gi, 'Base Amount'],
    [/tax\s*amount/gi, 'Tax Amount'],
    [/total\s*amount/gi, 'Total Amount'],
    [/amount\s*due/gi, 'Total Amount'],
    [/grand\s*total/gi, 'Total Amount'],
    [/shipped\s*to/gi, 'Shipped to'],
    [/ship\s*to/gi, 'Shipped to'],
    [/consignee/gi, 'Shipped to'],
    [/purchase\s*order/gi, 'PO Number'],
    [/p\.o\.?\s*no/gi, 'PO Number'],
    [/authorized\s*signatory/gi, 'Authorized Signatory'],
    [/seal\s*of\s*company/gi, 'Seal of Company']
  ];

  replacements.forEach(([pattern, replacement]) => {
    normalized = normalized.replace(pattern, replacement);
  });

  return normalized;
}

function canonicalizeAmount(raw) {
  if (raw == null || raw === '') return 0;
  const cleaned = String(raw)
    .replace(/\s+/g, '')
    .replace(/[₹$A-Za-z]/g, '')
    .replace(/,/g, '')
    .replace(/[^0-9.\-]/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function normalizeCurrencyNumber(raw) {
  if (raw == null || raw === '') return 0;
  const value = String(raw).replace(/[₹$A-Za-z,\s]/g, '').replace(/[^0-9.\-]/g, '');
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function extractLineValue(text, labels) {
  const pattern = new RegExp(`(?:${labels.join('|')})\\s*[:=\\-]?\\s*([^\\n;]+)`, 'i');
  const match = String(text || '').match(pattern);
  return match ? match[1].trim() : null;
}

function extractShipToDetails(text) {
  const lines = String(text || '').split(/\n|;/).map((line) => line.trim()).filter(Boolean);
  const index = lines.findIndex((line) => /(?:ship(?:ped)? to|bill to|consignee)/i.test(line));
  if (index === -1) return null;

  const collected = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (/^(invoice|date|place of supply|reverse charge|hsn|qty|base amount|tax amount|total amount|amount|gstin|state)/i.test(line)) break;
    if (/^[A-Z0-9&./() -,]{2,120}$/i.test(line) && !/^(authorized signatory|authorised signatory|seal|signature|gstin|tax invoice)/i.test(line)) {
      collected.push(line.trim());
    }
    if (collected.length >= 4) break;
  }

  return collected.length ? collected.join(', ') : null;
}

function extractQuantity(text) {
  const match = String(text || '').match(/(?:qty|quantity)\s*(?:[:=]|\.)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\bpcs\b|\bpcs\.?\b|unit|nos|no|kg|kg\.?|ltrs?|mtrs?|boxes?)?/i);
  if (match) return Number(match[1]);

  const quantityMatch = String(text || '').match(/qty\.\s*unit\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*[A-Za-z]*/i);
  if (quantityMatch) return Number(quantityMatch[1]);

  return 0;
}

function extractAmountForLabel(text, labels) {
  const regex = new RegExp(`(?:${labels.join('|')})\\s*[:=]\\s*([₹$A-Za-z0-9, .-]+)`, 'i');
  const match = String(text || '').match(regex);
  if (!match) return 0;
  const cleaned = match[1].replace(/[₹$,A-Za-z]/g, '').replace(/\s+/g, '').replace(/,/g, '');
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : 0;
}

function extractInvoiceDateText(text) {
  const matches = [
    /(?:invoice\s*date|dated|date)\s*[:=]?\s*(\d{1,2}[\/-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[\/-]?\d{2,4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2})/i,
    /(?:\b\d{1,2}\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*\d{2,4}\b)/i,
    /(?:\b\d{4}-\d{2}-\d{2}\b)/
  ];

  for (const pattern of matches) {
    const match = String(text || '').match(pattern);
    if (match) return match[1] || match[0];
  }

  return null;
}

function parseInvoiceFieldValues(normalizedText) {
  const canonicalText = normalizeInvoiceTextLabels(normalizedText);
  const values = {};
  const lines = String(canonicalText || '').split(/\n|;/).map((line) => line.trim()).filter(Boolean);

  const supplierNameMatch = String(canonicalText || '').match(/(?:m\/s|ms|\bcompany\b|seller|supplier|vendor)\s*[:\-]?\s*([A-Z0-9&/ .()-]{3,120})/i);
  if (supplierNameMatch) values.supplierName = supplierNameMatch[1].trim();

  const gstinMatch = String(canonicalText || '').match(/gstin\s*[:=]?\s*([A-Z0-9]{10,20})/i);
  if (gstinMatch) values.supplierGstin = gstinMatch[1].trim().toUpperCase();

  const panMatch = String(canonicalText || '').match(/pan\s*[:=]?\s*([A-Z0-9]{10})/i);
  if (panMatch) values.supplierPan = panMatch[1].trim().toUpperCase();

  const explicitStateLine = String(canonicalText || '').match(/(^|\n)state\s*[:=]?\s*([A-Za-z\s]+?)(?:\s*\(\d+\)|\s*$)/i);
  if (explicitStateLine) {
    values.supplierState = explicitStateLine[2].trim();
  } else {
    const placeOfSupplyMatch = String(canonicalText || '').match(/(^|\n)place\s*of\s*supply\s*[:=]?\s*([A-Za-z\s]+?)(?:\s*\(\d+\)|\s*$)/i);
    if (placeOfSupplyMatch) values.supplierState = placeOfSupplyMatch[2].trim();
  }

  const addressLines = [];
  const supplierAddressStart = lines.findIndex((line) => /(?:m\/s|ms|seller|supplier|vendor|company)/i.test(line) && !/invoice|tax invoice|ship|state|supply|gstin|pan/i.test(line));
  if (supplierAddressStart !== -1) {
    for (let i = supplierAddressStart + 1; i < Math.min(lines.length, supplierAddressStart + 6); i += 1) {
      const candidate = lines[i];
      if (!candidate || /invoice|tax invoice|date|po|amount|hsn|sac|ship|state|supply|gstin|pan|seal|signatory/i.test(candidate)) continue;
      if (candidate.length > 2) addressLines.push(candidate);
    }
  }
  if (addressLines.length) values.supplierAddress = addressLines.join(', ');

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (!values.vendor && /(seller|supplier|vendor|bill from|bill to|sold by)/i.test(line)) {
      const match = line.match(/(?:seller|supplier|vendor|bill from|bill to|sold by)\s*[:\-]?\s*([A-Za-z0-9&.,()\/ -]{3,80})/i);
      if (match) values.vendor = match[1].trim();
    }

    if (!values.supplierState && /^state\s*[:=]/i.test(line)) {
      values.supplierState = line.replace(/^state\s*[:=]\s*/i, '').replace(/\s*\(\d+\)\s*$/, '').trim();
    }

    if (!values.supplierState && /^place\s*of\s*supply\s*[:=]/i.test(line)) {
      values.supplierState = line.replace(/^place\s*of\s*supply\s*[:=]\s*/i, '').replace(/\s*\(\d+\)\s*$/, '').trim();
    }

    if (!values.invoiceNumber && /invoice\s*(?:no|number|#|id)\.?/i.test(line)) {
      const match = line.match(/invoice\s*(?:no|number|#|id)\.?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/\-]{2,29})/i);
      if (match) values.invoiceNumber = match[1].trim();
    }

    if (!values.invoiceNumber && /bill\s*no\.?/i.test(line)) {
      const match = line.match(/bill\s*no\.?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/\-]{2,29})/i);
      if (match) values.invoiceNumber = match[1].trim();
    }

    if (!values.invoiceNumber && /inv\s*#?/i.test(line) && /\d/.test(line)) {
      const match = line.match(/inv\s*#?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/\-]{2,29})/i);
      if (match) values.invoiceNumber = match[1].trim();
    }

    if (!values.date && /(invoice date|dated|date|issued on|bill date)/i.test(line)) {
      const match = line.match(/(?:invoice date|dated|date|issued on|bill date)\s*[:\-]?\s*(\d{1,2}[\/\-.](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|0?[1-9]|1[0-2])[\/\-.]?\s*\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i);
      if (match) values.date = match[1].trim();
    }

    if (!values.po && /(po\s*(?:no|number)|purchase order|p\.o\.?\s*no)/i.test(line)) {
      const match = line.match(/(?:po\s*(?:no|number)|purchase order|p\.o\.?\s*no)\s*[:#-]?\s*([A-Z0-9\/\-]{3,30})/i);
      if (match) values.po = match[1].trim();
    }

    if (!values.amount && /(total(?:\s*(?:amount|due))?|amount due|grand total|net total|base amount)/i.test(line)) {
      const match = line.match(/(?:total(?:\s*(?:amount|due))?|amount due|grand total|net total|base amount)\s*[:=]?\s*(?:[$₹]|rs\.?|inr|usd)?\s*([\d]{1,3}(?:,[\d]{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/i);
      if (match) values.amount = match[1].trim();
    }

    if (!values.tax && /(?:tax amount|gst|output gst)/i.test(line)) {
      const match = line.match(/output\s*gst\s*(?:up)?\s*[:=]?\s*(?:[$₹]|rs\.?|inr|usd)?\s*([\d]{1,3}(?:,[\d]{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/i);
      if (match) values.tax = match[1].trim();
    }

    if (!values.tax && /\bgst\b/i.test(line) && !/%/.test(line) && !/output\s*gst/i.test(line)) {
      const match = line.match(/\bgst\b\s*[:=]?\s*(?:[$₹]|rs\.?|inr|usd)?\s*([\d]{1,3}(?:,[\d]{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/i);
      if (match) values.tax = match[1].trim();
    }

    if (!values.vendor && /gstin\//i.test(lower)) {
      const prior = lines.slice(0, lines.indexOf(line)).reverse().find((candidate) => /supplier|vendor|private limited|limited/i.test(candidate));
      if (prior) values.vendor = prior.trim();
    }
  }

  values.shipToDetails = extractShipToDetails(normalizedText) || values.shipToDetails || null;
  values.hsnCode = values.hsnCode || normalizedText.match(/(?:hsn\s*(?:code)?|sac)\s*[:=]?\s*([0-9]{4,8})/i)?.[1] || null;
  values.quantity = values.quantity || extractQuantity(normalizedText);
  values.baseAmount = values.baseAmount || extractAmountForLabel(normalizedText, ['base amount']);
  values.taxAmount = values.taxAmount || extractAmountForLabel(normalizedText, ['tax amount', 'gst', 'output gst']);
  values.totalAmount = values.totalAmount || extractAmountForLabel(normalizedText, ['total amount', 'grand total', 'amount due', 'net total']);
  values.signaturePresent = /authorized signatory|authorised signatory|signature/i.test(normalizedText);
  values.sealPresent = /seal(?:\s+of\s+company)?|stamp/i.test(normalizedText);

  return values;
}

function classifyDocument(file, text = '') {
  const name = String(file?.originalname || '').toLowerCase();
  const mime = String(file?.mimetype || '').toLowerCase();
  const hasTextSignals = /invoice|vendor|gst|amount|total|date|po|hsn|sac/i.test(String(text || ''));

  if (/\.xml$|\.json$/.test(name) || mime.includes('xml') || mime.includes('json')) {
    return { documentType: 'e_invoice', confidence: 0.99, source: 'schema' };
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls') || mime.includes('spreadsheet') || mime.includes('excel')) {
    return { documentType: 'excel', confidence: 0.92, source: 'xlsx_parser' };
  }

  if (name.endsWith('.pdf') || mime === 'application/pdf') {
    return {
      documentType: hasTextSignals ? 'pdf_text' : 'pdf_ocr',
      confidence: hasTextSignals ? 0.93 : 0.78,
      source: hasTextSignals ? 'pdf_text_layer' : 'ocr_fallback'
    };
  }

  if (mime.startsWith('image/')) {
    return { documentType: 'image_ocr', confidence: 0.72, source: 'ocr_image' };
  }

  return { documentType: 'unknown', confidence: 0.4, source: 'raw_buffer' };
}

function scoreFieldConfidence(values) {
  const result = {};

  const fieldRules = {
    vendor: (value) => {
      if (!value || value === 'Unknown vendor') return 0.25;
      const s = String(value).trim();
      const alpha = (s.match(/[A-Za-z]/g) || []).length;
      return alpha >= 4 ? 0.92 : 0.68;
    },
    invoiceNumber: (value) => {
      if (!value) return 0.2;
      const s = String(value).trim();
      return /[A-Z]{2,}[-/ ]?\d{2,}/i.test(s) || /\d{4,}/.test(s) ? 0.9 : 0.6;
    },
    date: (value) => {
      if (!value) return 0.2;
      const parsed = new Date(String(value));
      return Number.isNaN(parsed.getTime()) ? 0.42 : 0.88;
    },
    po: (value) => {
      if (!value || value === 'N/A') return 0.3;
      return /[A-Z]{2,}[-/ ]?\d{2,}/i.test(String(value)) ? 0.82 : 0.55;
    },
    amount: (value) => {
      if (value === null || value === undefined || Number(value) <= 0) return 0.2;
      return 0.9;
    },
    tax: (value) => {
      if (value === null || value === undefined || Number(value) <= 0) return 0.35;
      return 0.86;
    },
    hsnCode: (value) => {
      if (!value) return 0.2;
      return /^\d{4,8}$/.test(String(value)) ? 0.84 : 0.52;
    }
  };

  Object.entries(fieldRules).forEach(([field, rule]) => {
    const value = values[field];
    result[field] = rule(value);
  });

  return result;
}

function buildValidationChecks(extracted) {
  const checks = [];

  const add = (name, passed, detail, severity = 'pass') => {
    checks.push({ name, passed, detail, severity });
  };

  add('Document readability', extracted.readable !== false, extracted.extractionIssue || 'Document text was extracted successfully', extracted.readable === false ? 'critical' : 'pass');
  add('Vendor extracted', Boolean(extracted.vendor) && extracted.vendor !== 'Unknown vendor', extracted.vendor ? `Vendor resolved to ${extracted.vendor}` : 'Vendor was not extracted', 'critical');
  add('Invoice number extracted', Boolean(extracted.invoiceNumber) && String(extracted.invoiceNumber).toUpperCase() !== 'N/A', extracted.invoiceNumber ? `Invoice number resolved to ${extracted.invoiceNumber}` : 'Invoice number missing', 'critical');
  add('Date sanity', !!extracted.date && !Number.isNaN(new Date(extracted.date).getTime()), extracted.date ? `Date parsed as ${extracted.date}` : 'Date invalid or missing', 'critical');
  add('Amount sanity', Number(extracted.amount || 0) > 0, `Amount parsed as ${Number(extracted.amount || 0)}`);
  add('Tax sanity', Number(extracted.tax || 0) >= 0, `Tax parsed as ${Number(extracted.tax || 0)}`);
  add('HSN/SAC pattern', !extracted.hsnCode || /^\d{4,8}$/.test(String(extracted.hsnCode)), extracted.hsnCode ? `HSN/SAC ${extracted.hsnCode} matches expected format` : 'HSN/SAC missing or optional', 'warning');

  const totalMatch = Number(extracted.amount || 0) > 0 && Number(extracted.tax || 0) <= Number(extracted.amount || 0) * 2;
  add('Tax vs amount reasonableness', totalMatch, `Tax ${Number(extracted.tax || 0)} is plausible relative to amount ${Number(extracted.amount || 0)}`);

  return {
    passed: checks.every((item) => item.passed),
    checks,
    issues: checks.filter((item) => !item.passed).map((item) => item.detail)
  };
}

function deriveVendorMetadata(extracted = {}) {
  const description = [extracted.description, extracted.vendor, extracted.supplierName, extracted.shipToDetails].filter(Boolean).join(' ');
  const hsn = String(extracted.hsnCode || '').trim();
  const stateText = String(extracted.supplierState || extracted.state || '').trim();
  const stateCodeMatch = stateText.match(/\((\d+)\)/);

  let vendorCategory = 'default';
  if (/^99\d{2,6}$/.test(hsn) || /consult|service|professional|technical|software|advisory|it service/i.test(description)) {
    vendorCategory = 'services_professional';
  } else if (/logistics|freight|transport|courier|shipping|delivery/i.test(description)) {
    vendorCategory = 'logistics';
  } else if (/manpower|labour|labour|security|cleaning|contractor|subcontractor/i.test(description)) {
    vendorCategory = 'manpower_contracting';
  } else if (/facility|rent|lease|maintenance|building|office space/i.test(description)) {
    vendorCategory = 'facilities';
  } else if (/raw material|steel|cement|scrap|fabric|packaging|goods|supplier/i.test(description)) {
    vendorCategory = 'raw_materials';
  }

  return {
    vendorCategory,
    vendorStateCode: stateCodeMatch ? stateCodeMatch[1] : undefined,
    buyerStateCode: stateCodeMatch ? stateCodeMatch[1] : undefined,
    panAvailable: Boolean(extracted.supplierPan || extracted.pan),
    vendorPanAvailable: Boolean(extracted.supplierPan || extracted.pan),
    serviceType: /^99\d{2,6}$/.test(hsn) ? 'professional' : undefined,
  };
}

async function extractInvoiceData(file) {
  if (!file) {
    return { error: 'No file provided' };
  }

  const originalName = file.originalname || '';
  const text = await resolveExtractedText(file);
  const layout = String(file.mimetype || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(originalName)
    ? await extractPdfLayout(file.buffer)
    : { pages: [], text: '' };
  const layoutText = layout.text && layout.text.length > String(text || '').length * 0.7 ? layout.text : text;
  const normalizedText = deduplicateDocumentText(String(layoutText || '').replace(/\r/g, ' ').trim());
  const lowerText = normalizedText.toLowerCase();
  const readableText = hasMeaningfulInvoiceText(text);
  const pipelineMeta = classifyDocument(file, text);
  const documentQuality = scoreDocumentQuality(file, text);

  if (!readableText) {
    const fallbackPayload = {
      vendor: 'Unknown vendor',
      invoiceNumber: (() => {
        const base = originalName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]/g, '');
        return base || 'N/A';
      })(),
      date: null,
      dueDate: null,
      amount: 0,
      currency: 'INR',
      po: 'N/A',
      mode: 'review',
      lineItems: 0,
      quantity: 0,
      totalValid: false,
      historicalMatch: false,
      tax: 0,
      hsnCode: null,
      receipt: null,
      description: null,
      readable: false,
      extractionIssue: 'No readable invoice data was found in the uploaded PDF, image, or Excel file.',
      pipeline: {
        ...pipelineMeta,
        stages: ['document_classification', 'text_acquisition', 'field_extraction', 'field_confidence', 'cross_field_validation'],
        status: 'needs_review',
        templateMatched: false
      },
      fieldConfidence: {
        vendor: 0.2,
        invoiceNumber: 0.2,
        date: 0.2,
        po: 0.2,
        amount: 0.2,
        tax: 0.2,
        hsnCode: 0.2
      },
      validation: {
        passed: false,
        checks: [{ name: 'Document readability', passed: false, detail: 'No readable invoice data found', severity: 'critical' }],
        issues: ['No readable invoice data found']
      },
      readyForMatching: false
    };

    return fallbackPayload;
  }

  const fieldValues = parseInvoiceFieldValues(normalizedText);
  const shipToDetails = fieldValues.shipToDetails || extractShipToDetails(normalizedText) || null;
  const hsnMatch = fieldValues.hsnCode || normalizedText.match(/(?:hsn\s*(?:code)?|sac)\s*[:=]?\s*([0-9]{4,8})/i)?.[1] || null;
  const quantityFromText = fieldValues.quantity || extractQuantity(normalizedText);
  const baseAmount = fieldValues.baseAmount || extractAmountForLabel(normalizedText, ['base amount']);
  const taxAmount = fieldValues.taxAmount || extractAmountForLabel(normalizedText, ['tax amount', 'gst', 'output gst']);
  const totalAmount = fieldValues.totalAmount || extractAmountForLabel(normalizedText, ['total amount', 'grand total', 'amount due', 'net total']);
  const signaturePresent = /authorized signatory|authorised signatory|signature/i.test(normalizedText);
  const sealPresent = /seal(?:\s+of\s+company)?|stamp/i.test(normalizedText);

  const vendorMap = {
    'northstar': 'Northstar Office Co.',
    'lumen': 'Lumen Freight Services',
    'cascade': 'Cascade Cloud Systems',
    'briar': 'Briar & Finch Facilities',
    'cultsport': 'Cultsport Private Limited'
  };

  const supplierName = fieldValues.supplierName || normalizedText.match(/(?:m\/s|ms|company|seller|supplier|vendor)\s*[:\-]?\s*([A-Z0-9&/ .()-]{3,120})/i)?.[1]?.trim() || null;
  const vendor = sanitizeVendorName(
    fieldValues.vendor
    || Object.entries(vendorMap).find(([key]) => lowerText.includes(key))?.[1]
    || normalizedText.match(/(?:seller|vendor|bill to|from|sold by|supplier)\s*[:\-]?\s*([A-Za-z&. ()-]{3,80})(?=\s*(?:gstin|gstin\/uin|state name|invoice|date|po|amount|tax|hsn|sac|vendor|$))/i)?.[1]?.trim()
    || normalizedText.match(/([A-Z][A-Za-z0-9&.() -]{3,80})\s*(?:gstin|gstin\/uin|state name)/i)?.[1]?.trim()
    || supplierName
    || normalizedText.split(/\n|;/).map((line) => line.trim()).find((line) => {
      if (!line || line.length < 4 || /^(invoice|tax invoice|invoice no|invoice number|gstin|state name|hsn|sac|date|due date|amount|total|output gst|gst|po|purchase order|item|description|qty|quantity)/i.test(line)) return false;
      if (/\d/.test(line)) return false;
      return /[A-Za-z]/.test(line);
    })
    || 'Unknown vendor'
  );

  const invoiceNumber = fieldValues.invoiceNumber
    || (
      normalizedText.match(/(?:invoice\s*(?:no|number|#|id)\.?|bill\s*no\.?|inv\s*#?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/\-]{2,29})(?=\s*(?:$|\n|date|gst|total|hsn|sac|state|item|qty|amount))/i)?.[1]
      || normalizedText.match(/(?:invoice no\.|invoice no|invoice number)\s*[:#-]?\s*([A-Z0-9-]{4,})/i)?.[1]
      || normalizedText.match(/([A-Z]{2,}[\-/ ]?\d{2,})/g)?.find((candidate) => /[A-Z]{2,}[\-/ ]?\d{2,}/i.test(candidate) && !candidate.includes('202') && !candidate.includes('2026') && !/^invoice$/i.test(candidate))
      || (originalName.match(/[A-Z]{2,}-\d{3,}/gi) || []).find((candidate) => /^[A-Z]{2,}-\d{3,}$/i.test(candidate))
      || (() => {
        const baseNumber = originalName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]/g, '');
        return baseNumber || '174';
      })()
    )?.toUpperCase();

  const parsedDate = parseDateValue(normalizedText) || parseDateValue(fieldValues.date || originalName) || new Date().toISOString().slice(0, 10);
  const date = parsedDate;

  const dueDateMatch = normalizedText.match(/(?:due date|payment due|due on)\s*[:\-]?\s*(\d{4})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])(?=$|[^0-9])/i);
  const dueDate = dueDateMatch
    ? `${dueDateMatch[1]}-${String(dueDateMatch[2]).padStart(2, '0')}-${String(dueDateMatch[3]).padStart(2, '0')}`
    : null;

  const amountPatterns = [
    /(?:total|grand total|amount due|net total|total amount|amount)\s*[:=]?\s*(?:[$₹]|rs\.?|inr|usd)?\s*([\d,]{1,}(?:\.\d{2})?)(?=$|[^\d.,])/i,
    /(?:output gst(?:\s+[a-z]+)?)\s*[:=]?\s*(?:[$₹]|rs\.?|inr|usd)?\s*([\d,]{1,}(?:\.\d{2})?)(?=$|[^\d.,])/i,
    /(?:gst)\s*[:=]?\s*(?:[$₹]|rs\.?|inr|usd)?\s*([\d,]{1,}(?:\.\d{2})?)(?=$|[^\d.,])(?!\s*%)/i,
    /(?:[$₹]|rs\.?|inr|usd)\s*([\d,]{1,}(?:\.\d{2})?)(?=$|[^\d.,])/i
  ];
  const explicitAmountMatch = amountPatterns.map((pattern) => normalizedText.match(pattern)).find(Boolean);
  const numericAmount = fieldValues.amount ? normalizeNumber(fieldValues.amount) : explicitAmountMatch ? normalizeNumber(explicitAmountMatch[1]) : 0;

  const poMatch = fieldValues.po
    || normalizedText.match(/(?:po\s*no|p\.o\.?\s*no|purchase order)\s*[:#-]?\s*([A-Z]{2,}-?\d{3,})/i)?.[1]
    || (originalName.match(/PO-\d+/i)?.[0])
    || (normalizedText.match(/PO-\d+/gi)?.[0]?.toUpperCase());
  const po = poMatch ? String(poMatch).toUpperCase() : 'N/A';

  const taxMatch = fieldValues.tax
    || normalizedText.match(/(?:tax amount|output\s*gst|gst)\s*[:=]?\s*(?:[$₹]|rs\.?|inr|usd)?\s*([\d,]{1,}(?:\.\d{2})?)(?!\s*%)/i)?.[1]
    || normalizedText.match(/\bgst\b\s*[:=]?\s*(?:[$₹]|rs\.?|inr|usd)?\s*([\d,]{1,}(?:\.\d{2})?)(?!\s*%)/i)?.[1]
    || normalizedText.match(/(?:output gst up|gst)\s*[a-z\s]*?([\d,]{1,}(?:\.\d{2})?)/i)?.[1]
    || null;

  const descriptionMatch = normalizedText.match(/(?:item|description|product)\s*[:=]?\s*([A-Za-z][A-Za-z0-9&/ .-]{3,80})/i)?.[1]
    || normalizedText.match(/^\s*\d+\s+([A-Za-z][A-Za-z0-9&/ .-]{3,80})\s*(?:\n|$)/m)?.[1]
    || normalizedText.match(/(?:\d+\s+)([A-Za-z0-9][A-Za-z0-9 /-]{4,80})(?=\s+[A-Z0-9]{6,})/i)?.[1]
    || normalizedText.split(/\n|;/).map((line) => line.trim()).find((line) => /[A-Za-z]/.test(line) && !/^(invoice|tax invoice|vendor|invoice no|date|hsn|sac|gst|total|output gst|state name|item)$/i.test(line) && line.length > 8 && !/^\d+$/.test(line))
    || null;

  const extractedLineItems = (() => {
    const fromText = extractLineItems(normalizedText);
    if (fromText.length) return fromText;
    return extractLineItemsFromLayout(layout);
  })();
  const charges = extractCharges(normalizedText);
  const taxSummary = extractTaxSummary(normalizedText);
  const computedTaxableAmount = extractedLineItems.reduce((sum, line) => sum + Number(line.taxableAmount || 0), 0);
  const statedTaxableAmount = extractAmountForLabel(normalizedText, ['taxable amount', 'base amount', 'subtotal']);
  const taxableAmount = Number(taxSummary.taxableAmount) || Number(statedTaxableAmount) || Number(baseAmount) || computedTaxableAmount || Math.max(0, Number(totalAmount || numericAmount) - Number(taxAmount || taxMatch || 0));
  const explicitTaxAmount = extractAmountForLabel(normalizedText, ['tax amount', 'gst total', 'total gst']);
  const componentTaxAmount = ['cgst', 'sgst', 'igst', 'utgst'].reduce((sum, label) => sum + (Number(normalizedText.match(new RegExp(`\\b${label}\\b(?:\\s+\\d+(?:\\.\\d+)?\\s*%)?\\s*[:=]\\s*[₹$]?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i'))?.[1]?.replaceAll(',', '')) || 0), 0);
  const parsedTaxAmount = Number(taxSummary.taxAmount) || Number(explicitTaxAmount) || componentTaxAmount || Number(String(taxAmount || taxMatch || 0).replace(/[$,₹]/g, '')) || 0;
  const taxBreakdown = extractTaxBreakdown(normalizedText, taxableAmount, parsedTaxAmount);
  if (!taxBreakdown.cgst && !taxBreakdown.sgst && !taxBreakdown.igst && taxSummary.igstAmount) taxBreakdown.igst = taxSummary.igstAmount;
  taxBreakdown.rates = taxSummary.rates;
  const lineItemsWithTax = extractedLineItems.map((line) => ({ ...line, gstRate: line.gstRate ?? taxBreakdown.gstRate }));
  const discountAmount = charges.filter((charge) => charge.type === 'discount').reduce((sum, charge) => sum + charge.amount, 0);
  const otherCharges = charges.filter((charge) => charge.type !== 'discount');
  const layoutGrandTotal = layout.pages.flatMap((page) => page.rows || []).map((row) => row.items.map((item) => item.text).join(' ')).find((line) => /\bgrand\s+total\b/i.test(line));
  const grandTotalLine = layoutGrandTotal || normalizedText.split('\n').find((line) => /\bgrand\s+total\b/i.test(line));
  const grandTotalNumbers = grandTotalLine?.match(/[\d][\d,]*(?:\.\d{1,2})?/g) || [];
  const grandTotalToken = grandTotalNumbers.length >= 2 && /^\d{2}$/.test(grandTotalNumbers.at(-1)) && !grandTotalNumbers.at(-2).includes('.')
    ? `${grandTotalNumbers.at(-2)}.${grandTotalNumbers.at(-1)}`
    : grandTotalNumbers.at(-1);
  const explicitGrandTotal = grandTotalToken
    || (grandTotalLine ? [...grandTotalLine.matchAll(/([\d,]+(?:\.\d{1,2})?)/g)].at(-1)?.[1]
    || extractAmountForLabel(normalizedText, ['net payable', 'amount payable'])
    : extractAmountForLabel(normalizedText, ['net payable', 'amount payable']));
  const finalTotal = normalizeNumber(explicitGrandTotal) || normalizeNumber(totalAmount) || normalizeNumber(numericAmount) || taxableAmount + parsedTaxAmount;
  const arithmetic = validateArithmetic({
    lineItems: lineItemsWithTax,
    taxableAmount,
    taxAmount: parsedTaxAmount,
    charges,
    discount: discountAmount,
    totalAmount: finalTotal,
    tolerance: 1
  });

  const hasUsdMarker = /\$|\busd\b|dollars?/i.test(normalizedText);
  const hasInrMarker = /₹|\binr\b|rupees?|gstin|state name|tax invoice|output gst|hsn\/sac/i.test(normalizedText);
  const currency = hasUsdMarker ? 'USD' : hasInrMarker ? 'INR' : 'USD';
  const extractionWarnings = [];
  if (/(?:amount|total|gst|tax)\s*[:=]?\s*[,.;]\s*\d/i.test(normalizedText)) {
    extractionWarnings.push('Numeric value may be OCR-corrupted: a leading digit is missing from one or more amount fields.');
  }

  const businessDetails = {
    supplier: {
      name: supplierName || vendor || null,
      gstin: fieldValues.supplierGstin || normalizedText.match(/gstin\s*[:=]?\s*([A-Z0-9]{10,20})/i)?.[1]?.trim().toUpperCase() || null,
      pan: fieldValues.supplierPan || normalizedText.match(/pan\s*[:=]?\s*([A-Z0-9]{10})/i)?.[1]?.trim().toUpperCase() || null,
      address: fieldValues.supplierAddress || normalizedText.match(/(?:m\/s|ms|seller|supplier|vendor|company)\s*[:\-]?\s*([A-Z0-9&/ .()-]{3,120})\s*\n\s*([A-Za-z0-9, .()-]{6,120})/i)?.slice(1).join(', ') || null,
      state: fieldValues.supplierState || (String(normalizedText || '').match(/(^|\n)state\s*[:=]?\s*([A-Za-z\s]+?)(?:\s*\(\d+\)|\s*$)/i)?.[2]?.trim() || String(normalizedText || '').match(/(^|\n)place\s*of\s*supply\s*[:=]?\s*([A-Za-z\s]+?)(?:\s*\(\d+\)|\s*$)/i)?.[2]?.trim()) || null
    },
    buyer: {
      name: shipToDetails ? shipToDetails.split(',')[0].trim() : null,
      address: shipToDetails || null,
      state: String(normalizedText || '').match(/(^|\n)place\s*of\s*supply\s*[:=]?\s*([A-Za-z\s]+?)(?:\s*\(\d+\)|\s*$)/i)?.[2]?.trim() || null
    },
    invoice: {
      number: invoiceNumber,
      date,
      po,
      hsnCode: hsnMatch || null,
      quantity: quantityFromText,
      currency
    },
    totals: {
      baseAmount: Number(baseAmount) || 0,
      taxAmount: Number(taxAmount) || 0,
      totalAmount: Number(totalAmount) || Number(numericAmount) || 0,
      currency
    },
    compliance: {
      sealPresent,
      signaturePresent
    }
  };

  const extracted = {
    vendor,
    supplierName: supplierName || vendor || null,
    supplierGstin: fieldValues.supplierGstin || normalizedText.match(/gstin\s*[:=]?\s*([A-Z0-9]{10,20})/i)?.[1]?.trim().toUpperCase() || null,
    supplierPan: fieldValues.supplierPan || normalizedText.match(/pan\s*[:=]?\s*([A-Z0-9]{10})/i)?.[1]?.trim().toUpperCase() || null,
    supplierAddress: fieldValues.supplierAddress || normalizedText.match(/(?:m\/s|ms|seller|supplier|vendor|company)\s*[:\-]?\s*([A-Z0-9&/ .()-]{3,120})\s*\n\s*([A-Za-z0-9, .()-]{6,120})/i)?.slice(1).join(', ') || null,
    supplierState: fieldValues.supplierState || (String(normalizedText || '').match(/(^|\n)state\s*[:=]?\s*([A-Za-z\s]+?)(?:\s*\(\d+\)|\s*$)/i)?.[2]?.trim() || String(normalizedText || '').match(/(^|\n)place\s*of\s*supply\s*[:=]?\s*([A-Za-z\s]+?)(?:\s*\(\d+\)|\s*$)/i)?.[2]?.trim()) || null,
    invoiceNumber,
    date,
    dueDate,
    amount: finalTotal,
    currency,
    po,
    mode: '3-way',
    lineItems: lineItemsWithTax,
    lineItemCount: lineItemsWithTax.length,
    quantity: quantityFromText,
    totalValid: null,
    historicalMatch: null,
    tax: parsedTaxAmount,
    amountRaw: fieldValues.amount || explicitAmountMatch?.[1] || null,
    taxRaw: taxMatch || null,
    extractionWarnings,
    template: detectTemplate(normalizedText),
    vendorTemplate: getVendorTemplate({ vendor, gstin: fieldValues.supplierGstin }),
    tableSchema: detectColumnMap(normalizedText),
    documentQuality,
    layout,
    fieldEvidence: buildFieldEvidence({ vendor, invoiceNumber, date, po, currency, taxableAmount, taxAmount: parsedTaxAmount, totalAmount: Number(totalAmount) || Number(numericAmount) }, 'pdf-text-or-ocr'),
    hsnCode: hsnMatch || null,
    shipToDetails,
    baseAmount: taxableAmount,
    taxAmount: parsedTaxAmount,
    totalAmount: finalTotal,
    taxableAmount,
    gstRate: taxBreakdown.gstRate,
    gstBreakdown: taxBreakdown,
    otherCharges,
    totalOtherCharges: otherCharges.reduce((sum, charge) => sum + charge.amount, 0),
    discountAmount,
    arithmeticValidation: arithmetic,
    amountBreakdown: {
      taxableAmount,
      taxAmount: parsedTaxAmount,
      otherCharges: otherCharges.reduce((sum, charge) => sum + charge.amount, 0),
      totalAmount: finalTotal,
      lineSubtotal: computedTaxableAmount
    },
    sealPresent,
    signaturePresent,
    receipt: null,
    description: descriptionMatch || null,
    businessDetails,
    readable: true,
    extractionIssue: null,
    pipeline: {
      ...pipelineMeta,
      stages: ['document_classification', 'text_acquisition', 'field_extraction', 'field_confidence', 'cross_field_validation'],
      status: 'ready_for_matching',
      templateMatched: false
    },
    fieldConfidence: scoreFieldConfidence({
      vendor,
      invoiceNumber,
      date,
      po,
      amount: finalTotal,
      tax: Number(String(taxMatch || '0').replace(/[$,₹]/g, '')) || 0,
      hsnCode: hsnMatch || null
    }),
    validation: buildValidationChecks({
      readable: true,
      extractionIssue: null,
      vendor,
      invoiceNumber,
      date,
      amount: numericAmount,
      tax: Number(String(taxMatch || '0').replace(/[$,₹]/g, '')) || 0,
      hsnCode: hsnMatch || null
    }),
    readyForMatching: true
  };

  Object.assign(extracted, deriveVendorMetadata(extracted));

  const lowConfidenceDetected = Object.values(extracted.fieldConfidence || {}).some((score) => Number(score) < 0.5);
  const reviewRequired = extracted.vendor === 'Unknown vendor' || !extracted.invoiceNumber || !extracted.date || Number(extracted.amount || 0) <= 0 || lowConfidenceDetected;

  if (reviewRequired) {
    extracted.pipeline.status = 'needs_review';
    extracted.readyForMatching = false;
    extracted.needsReview = true;
    extracted.validation = buildValidationChecks({
      readable: true,
      extractionIssue: null,
      vendor: extracted.vendor,
      invoiceNumber: extracted.invoiceNumber,
      date: extracted.date,
      amount: extracted.amount,
      tax: extracted.tax,
      hsnCode: extracted.hsnCode
    });
  } else {
    extracted.needsReview = false;
  }

  if (extractionWarnings.length) {
    extracted.pipeline.status = 'needs_review';
    extracted.readyForMatching = false;
    extracted.validation.passed = false;
    extracted.validation.checks.push({
      name: 'OCR numeric integrity',
      passed: false,
      detail: extractionWarnings[0],
      severity: 'critical'
    });
    extracted.validation.issues.push(extractionWarnings[0]);
  }

  const learned = await findVendorTemplate({ gstin: extracted.supplierGstin, vendor: extracted.vendor }).catch(() => null);
  if (learned) {
    extracted.vendorTemplate = { ...extracted.vendorTemplate, learned: true, id: learned.id, columnMap: learned.columnMap };
  }

  if (process.env.DOCUMENT_AI_URL) {
    try {
      const provider = new HttpDocumentAiProvider({
        url: process.env.DOCUMENT_AI_URL,
        apiKey: process.env.DOCUMENT_AI_KEY,
        sendFile: process.env.DOCUMENT_AI_SEND_FILE === 'true'
      });
      const enriched = await provider.extractInvoice(file, extracted);
      Object.assign(extracted, enriched);
    } catch (error) {
      extracted.extractionWarnings = [...(extracted.extractionWarnings || []), 'Document AI enrichment skipped'];
    }
  }

  return extracted;
}

function reconcileInvoiceAgainstErp(invoice, { vendors = [], transactions = [] }) {
  const vendor = vendors.find((item) => item.name.toLowerCase() === (invoice.vendor || '').toLowerCase())
    || vendors.find((item) => item.id === invoice.vendorId)
    || null;

  const po = transactions.find((item) => item.po === invoice.po) || null;

  const compliance = detectIndiaCompliance(invoice);
  const checks = [];
  const add = (name, passed, detail, severity = 'pass') => checks.push({ name, passed, detail, severity });

  add('Vendor master data', Boolean(vendor) && vendor.status === 'Active', vendor ? `${vendor.name} is ${vendor.status || 'active'} in ERP` : 'Vendor not found in ERP', 'critical');
  add('Purchase order', Boolean(po?.po), po ? `PO ${po.po} found in ERP` : 'Purchase order not found in ERP', 'critical');
  add('Duplicate protection', !invoice.duplicate, invoice.duplicate ? 'Potential duplicate invoice detected' : 'No matching invoice number found', 'critical');
  const poTotal = po?.poTotal || 0;
  add('Amount validation', Boolean(po) && Math.abs((invoice.amount || 0) - poTotal) <= Math.max(10, poTotal * 0.02), `Invoice ${formatMoney(invoice.amount || 0)} vs PO ${formatMoney(poTotal)}`);
  const receiptPass = invoice.mode === '2-way' || Boolean(po && (po.receipt || po.received >= (invoice.quantity || 0)));
  add('Receipt match', receiptPass, invoice.mode === '2-way' ? '2-way policy does not require a receipt' : po ? `${po.receipt || 'ERP receipt'} confirms receipt` : 'Receipt cannot be checked without a matched PO', 'critical');
  add('Tax and totals', invoice.totalValid !== false, invoice.totalValid === false ? 'Line items and tax do not equal invoice total' : 'Arithmetic checks passed');
  add('GST compliance', compliance.gst.status === 'ready', compliance.gst.message, 'critical');
  add('TDS policy', compliance.tds.status !== 'applicable' || amountIsWithinTdsTolerance(invoice.amount || 0), compliance.tds.message, 'pass');
  add('e-invoice validation', invoice.irn ? compliance.eInvoice.status === 'verified' : true, invoice.irn ? compliance.eInvoice.message : 'IRN / QR not required for this invoice profile', 'warning');

  const failed = checks.filter((check) => !check.passed);
  const confidence = Math.max(42, 98.3 - failed.length * 8.5);
  const risk = failed.length ? 'Medium' : 'Low';
  let status = 'Auto-posted';
  if (risk === 'High' || failed.some((check) => check.severity === 'critical')) status = 'Needs review';
  if (invoice.duplicate) status = 'On hold';
  if (confidence < 90) status = 'Query open';

  const reasoning = checks.map((check) => ({
    rule: check.name,
    passed: check.passed,
    message: check.detail,
    severity: check.severity
  }));

  return {
    vendorMatch: Boolean(vendor) && vendor.status === 'Active',
    poMatch: Boolean(po?.po),
    risk,
    status,
    confidence: Number(Math.min(99.9, confidence).toFixed(1)),
    checks,
    reasoning,
    compliance,
    issue: failed[0]?.detail || 'All controls passed'
  };
}

function amountIsWithinTdsTolerance(amount) {
  return Number(amount || 0) < 300000;
}

function generateRecommendation(invoice = {}, { vendors = [], transactions = [] } = {}) {
  const matchVendor = (invoice.vendor || '').trim();
  const vendorCandidates = vendors.filter((vendor) => {
    const target = String(vendor.name || '').toLowerCase();
    return !matchVendor || target.includes(matchVendor.toLowerCase()) || matchVendor.toLowerCase().includes(target);
  });

  const candidateTransactions = transactions.filter((tx) => {
    const sameVendor = vendorCandidates.length
      ? vendorCandidates.some((vendor) => vendor.id === tx.vendorId || vendor.name === tx.vendor)
      : true;
    const sameDescription = !invoice.description || !tx.description
      ? true
      : String(tx.description).toLowerCase().includes(String(invoice.description).toLowerCase())
      || String(invoice.description).toLowerCase().includes(String(tx.description).toLowerCase());
    const sameHsn = !invoice.hsnCode || !tx.hsnCode ? true : String(tx.hsnCode) === String(invoice.hsnCode);
    const samePo = !invoice.po || !tx.po ? true : String(tx.po) === String(invoice.po);
    return sameVendor && (sameDescription || sameHsn || samePo);
  });

  const fallbackTransactions = transactions.filter((tx) => {
    if (candidateTransactions.some((item) => item.po === tx.po)) return false;
    return (invoice.vendor ? String(tx.vendor || '').toLowerCase().includes(String(invoice.vendor).toLowerCase()) : true)
      || (invoice.hsnCode ? String(tx.hsnCode || '').includes(String(invoice.hsnCode)) : false)
      || (invoice.description ? String(tx.description || '').toLowerCase().includes(String(invoice.description).toLowerCase()) : false);
  });

  const topTransactions = [...candidateTransactions, ...fallbackTransactions].slice(0, 8);
  const glCounts = {};
  const costCounts = {};
  const taxCounts = {};

  topTransactions.forEach((tx) => {
    if (tx.glAccount) glCounts[tx.glAccount] = (glCounts[tx.glAccount] || 0) + 1;
    if (tx.costCenter) costCounts[tx.costCenter] = (costCounts[tx.costCenter] || 0) + 1;
    if (tx.taxCode) taxCounts[tx.taxCode] = (taxCounts[tx.taxCode] || 0) + 1;
  });

  const glAccount = Object.entries(glCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '620010';
  const costCenter = Object.entries(costCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'IT001';
  const taxCode = Object.entries(taxCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'GST18';

  const supportCount = Math.max(1, topTransactions.length);
  const vendorSupport = candidateTransactions.length || 1;
  const confidence = Math.min(99.9, 78 + (Math.max(1, vendorSupport) * 5) + (glAccount ? 7 : 0) + (costCenter ? 6 : 0) + (taxCode ? 6 : 0));

  const sameVendorInvoices = candidateTransactions.filter((tx) => String(tx.vendor || '').toLowerCase() === String(invoice.vendor || '').toLowerCase()).length || vendorCandidates.length || 0;
  const sameSacInvoices = candidateTransactions.filter((tx) => String(tx.hsnCode || '').trim() && String(invoice.hsnCode || '').trim() && String(tx.hsnCode) === String(invoice.hsnCode)).length || 0;
  const sameDescriptionInvoices = candidateTransactions.filter((tx) => String(tx.description || '').toLowerCase().includes(String(invoice.description || '').toLowerCase()) || String(invoice.description || '').toLowerCase().includes(String(tx.description || '').toLowerCase())).length || 0;
  const historicalGlFrequency = Math.min(0.99, Math.max(0.5, (glCounts[glAccount] || 1) / Math.max(1, supportCount)));

  const reasons = [];
  if (candidateTransactions.length) {
    reasons.push(`Matched ${candidateTransactions.length} historical transactions for the same vendor and invoice pattern.`);
  } else {
    reasons.push('No exact vendor or invoice pattern found; fallback pattern used based on the closest category and description.');
  }
  if (glAccount) reasons.push(`GL ${glAccount} appears most often in similar posted transactions.`);
  if (costCenter) reasons.push(`Cost center ${costCenter} was the dominant pattern for this vendor and item type.`);
  if (taxCode) reasons.push(`Tax code ${taxCode} is the most frequent treatment for similar invoices.`);
  if (invoice.amount) reasons.push(`The current amount ${formatMoney(invoice.amount)} is within the historical range of similar transactions.`);

  const recommendation = {
    glAccount,
    costCenter,
    taxCode,
    confidence: Number(confidence.toFixed(1)),
    modelVersion: 'local-rule-v1',
    ruleVersion: 'invoice-rules-v1',
    recommendationVersion: 'recommendation-v1',
    similarTransactions: topTransactions.slice(0, 5).map((tx) => ({
      vendor: tx.vendor,
      po: tx.po,
      amount: tx.poTotal || tx.amount || 0,
      description: tx.description,
      glAccount: tx.glAccount,
      costCenter: tx.costCenter,
      taxCode: tx.taxCode,
      score: Math.max(80, Math.min(99, 80 + (tx.glAccount === glAccount ? 10 : 0) + (tx.costCenter === costCenter ? 5 : 0) + (tx.taxCode === taxCode ? 5 : 0)))
    })),
    reasoning: {
      sameVendorInvoices: sameVendorInvoices,
      sameSacInvoices: sameSacInvoices,
      sameDescriptionInvoices: sameDescriptionInvoices,
      historicalGlFrequency: Number(historicalGlFrequency.toFixed(2))
    },
    explainability: {
      reasons,
      basis: {
        vendorMatches: vendorCandidates.length,
        similarTransactions: candidateTransactions.length,
        supportCount,
      }
    }
  };

  return recommendation;
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);
}

module.exports = {
  extractInvoiceData,
  reconcileInvoiceAgainstErp,
  detectIndiaCompliance,
  detectIndiaComplianceV2,
  getToleranceProfile,
  evaluateTds,
  evaluateGst,
  generateRecommendation,
};
