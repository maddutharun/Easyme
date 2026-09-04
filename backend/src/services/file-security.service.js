  const path = require('node:path');

const signatures = {
  '.pdf': (buffer) => buffer.subarray(0, 5).toString() === '%PDF-',
  '.png': (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  '.jpg': (buffer) => buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
  '.jpeg': (buffer) => buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
  '.xlsx': (buffer) => buffer.subarray(0, 2).equals(Buffer.from([80, 75]))
};

const validateFileSignature = (file) => {
  const extension = path.extname(file?.originalname || '').toLowerCase();
  const validator = signatures[extension];
  return { valid: Boolean(validator && validator(file.buffer || Buffer.alloc(0))), extension };
};

module.exports = { validateFileSignature };