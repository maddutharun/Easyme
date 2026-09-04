const path = require('node:path');
require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

const config = {
  NODE_ENV,
  PORT: Number(process.env.PORT || 3000),
  JWT_SECRET: process.env.JWT_SECRET || (isProduction ? '' : 'dev-local-secret-change-me'),
  COOKIE_SECRET: process.env.COOKIE_SECRET || (isProduction ? '' : 'dev-cookie-secret-change-me'),
  ALLOW_PUBLIC_ACCESS: process.env.ALLOW_PUBLIC_ACCESS === 'true' && !isProduction,
  AUTH_REQUIRED: isProduction ? true : process.env.AUTH_REQUIRED !== 'false',
  DB_MODE: process.env.DB_MODE || 'json',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db'),
  STORAGE_PATH: process.env.STORAGE_PATH || path.join(__dirname, '..', 'uploads'),
  ERP_MODE: process.env.ERP_MODE || 'demo',
  OCR_PROVIDER: process.env.OCR_PROVIDER || 'local-tesseract',
  DOCUMENT_AI_URL: process.env.DOCUMENT_AI_URL || '',
  DOCUMENT_AI_KEY: process.env.DOCUMENT_AI_KEY || '',
  DOCUMENT_AI_SEND_FILE: process.env.DOCUMENT_AI_SEND_FILE === 'true',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  TRUST_PROXY: process.env.TRUST_PROXY === 'true',
  DEMO_MODE: !isProduction
};

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
if (isProduction && process.env.JWT_SECRET === 'dev-local-secret-change-me') {
  throw new Error('JWT_SECRET must not use the development default in production');
}

module.exports = config;
