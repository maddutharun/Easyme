const crypto = require('node:crypto');
const { JWT_SECRET, AUTH_REQUIRED } = require('../config/env');
const { getUserByEmail, verifyPassword } = require('./database.service');

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

const signToken = (user) => {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60
  });
  const body = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
};

const verifyToken = (token) => {
  const [header, payload, signature] = String(token || '').split('.');
  if (!header || !payload || !signature) throw new Error('Invalid token');
  const body = `${header}.${payload}`;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
    throw new Error('Invalid token');
  }
  const claims = decode(payload);
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) throw new Error('Expired token');
  return claims;
};

const authenticate = async (email, password) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const dbUser = await getUserByEmail(normalizedEmail).catch(() => null);
  if (!dbUser || !verifyPassword(password, dbUser.password_hash)) return null;
  return {
    id: dbUser.id,
    email: dbUser.email,
    role: dbUser.role,
    name: dbUser.name
  };
};

const readToken = (req) => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
};

const optionalAuth = (req, res, next) => {
  const token = readToken(req);
  if (!token) return next();
  try {
    req.user = verifyToken(token);
  } catch (error) {
    req.user = null;
  }
  return next();
};

const requireAuth = (req, res, next) => {
  const token = readToken(req);
  if (!token) {
    if (!AUTH_REQUIRED) return next();
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = verifyToken(token);
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!AUTH_REQUIRED && !req.user) return next();
  const userRole = req.user?.role;
  if (!userRole || !allowedRoles.includes(userRole)) {
    return res.status(403).json({ error: 'Forbidden: role not allowed' });
  }
  return next();
};

module.exports = {
  authenticate,
  signToken,
  verifyToken,
  requireAuth,
  requireRole,
  optionalAuth
};
