const crypto = require('node:crypto');
const { JWT_SECRET, AUTH_REQUIRED } = require('../config/env');
const { getUserByEmail } = require('./database.service');

const DEMO_USERS = [
  { id: 'u-ap-clerk', email: 'clerk@easyme.local', role: 'ap_clerk', name: 'AP Clerk', password: 'demo123' },
  { id: 'u-ap-manager', email: 'manager@easyme.local', role: 'ap_manager', name: 'AP Manager', password: 'demo123' },
  { id: 'u-finance', email: 'finance@easyme.local', role: 'finance_approver', name: 'Finance Approver', password: 'demo123' },
  { id: 'u-admin', email: 'admin@easyme.local', role: 'admin', name: 'System Admin', password: 'demo123' }
];

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
const signToken = (user) => {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
  sub: user.id,
  email: user.email,
  role: user.role,
  name: user.name,
  exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60
  });
  const body = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
};

const verifyToken = (token) => {
  const [header, payload, signature] = String(token).split('.');
  const body = `${header}.${payload}`;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  if (!header || !payload || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('Invalid token');
  const claims = decode(payload);
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) throw new Error('Expired token');
  return claims;
};

const authenticate = async (email, password) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = DEMO_USERS.find((entry) => entry.email === normalizedEmail);
  if (!user || password !== user.password) {
    const dbUser = await getUserByEmail(normalizedEmail).catch(() => null);
    if (!dbUser) return null;
    if (password !== dbUser.password_hash) return null;
    return {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role,
      name: dbUser.name
    };
  }

  return { id: user.id, email: user.email, role: user.role, name: user.name };
};

const requireAuth = (req, res, next) => {
  if (!AUTH_REQUIRED) return next();

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!AUTH_REQUIRED) return next();
  const userRole = req.user?.role;
  if (!userRole || !allowedRoles.includes(userRole)) {
    return res.status(403).json({ error: 'Forbidden: role not allowed' });
  }
  return next();
};

module.exports = {
  DEMO_USERS,
  authenticate,
  signToken,
  requireAuth,
  requireRole
};
