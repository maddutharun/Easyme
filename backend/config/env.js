const path = require('node:path');
require('dotenv').config();

const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 3000),
  JWT_SECRET: process.env.JWT_SECRET || 'dev-local-secret-change-me',
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'dev-cookie-secret-change-me',
  ALLOW_PUBLIC_ACCESS: process.env.ALLOW_PUBLIC_ACCESS === 'true' || process.env.NODE_ENV !== 'production',
  AUTH_REQUIRED: process.env.AUTH_REQUIRED === 'true',
  DB_MODE: process.env.DB_MODE || 'json',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db'),
  STORAGE_PATH: process.env.STORAGE_PATH || path.join(__dirname, '..', 'uploads'),
  ERP_MODE: process.env.ERP_MODE || 'demo',
  OCR_PROVIDER: process.env.OCR_PROVIDER || 'local-tesseract',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

module.exports = config;
