  function publicInvoice(invoice) {
  if (!invoice || typeof invoice !== 'object') return invoice;
  const { storagePath, ...rest } = invoice;
  return {
    ...rest,
    hasFile: Boolean(storagePath || invoice.fileName)
  };
}

function isPathInsideRoot(filePath, rootDir) {
  const path = require('node:path');
  const resolved = path.resolve(filePath);
  const root = path.resolve(rootDir);
  return resolved === root || resolved.startsWith(root + path.sep);
}

module.exports = { publicInvoice, isPathInsideRoot };
