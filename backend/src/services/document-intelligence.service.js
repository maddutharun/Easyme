const path = require('node:path');

const scoreDocumentQuality = (file, text) => {
  const buffer = file?.buffer || Buffer.alloc(0);
  const value = String(text || '');
  const hasImageSignature = buffer.length > 4;
  const readableCharacters = value.replace(/\s/g, '').length;
  const score = Math.min(1, (readableCharacters > 120 ? 0.55 : readableCharacters > 30 ? 0.35 : 0.1)
    + (hasImageSignature ? 0.15 : 0)
    + (/invoice|gst|total|amount/i.test(value) ? 0.3 : 0));
  return { score: Number(score.toFixed(2)), readableCharacters, needsReview: score < 0.75, sourceType: path.extname(file?.originalname || '').toLowerCase() };
};

const getVendorTemplate = (values = {}) => {
  const text = `${values.vendor || ''} ${values.gstin || ''}`.toUpperCase();
  if (/09ACEPK0787A1ZT|PRESIDENT INTERNATIONAL/.test(text)) return { id: 'president-international-gst', version: 1, confidence: 0.99 };
  if (/NORTHSTAR OFFICE/.test(text)) return { id: 'northstar-standard', version: 1, confidence: 0.96 };
  return { id: 'generic', version: 1, confidence: 0.5 };
};

const extractPdfLayout = async (buffer) => {
  if (!buffer?.length) return { pages: [], text: '' };
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.map((item) => ({ text: item.str, x: item.transform?.[4] || 0, y: item.transform?.[5] || 0, width: item.width || 0, height: item.height || 0, confidence: 1 }));
      const rows = [];
      for (const item of items.sort((left, right) => right.y - left.y || left.x - right.x)) {
        const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(2, item.height * 0.6));
        if (row) row.items.push(item);
        else rows.push({ y: item.y, items: [item] });
      }
      const rowText = rows.sort((left, right) => right.y - left.y)
        .map((row) => row.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(' ').trim())
        .filter(Boolean);
      pages.push({ pageNumber, items, rows, text: rowText.join('\n') });
    }
    const uniquePages = pages.filter((page, index, all) => index === all.findIndex((candidate) => candidate.text === page.text));
    return { pages: uniquePages, text: uniquePages.map((page) => page.text).join('\n') };
  } catch (error) {
    return { pages: [], text: '', error: error.message };
  }
};

module.exports = { scoreDocumentQuality, getVendorTemplate, extractPdfLayout };