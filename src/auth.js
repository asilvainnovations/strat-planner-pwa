/**
 * ============================================================
 * STRAT PLANNER PRO — AUTHENTICATION MODULE
 * ============================================================
 * Handles:
 *  - Password hashing (bcrypt)
 *  - JWT access token creation & verification
 *  - Refresh token rotation (stored in DB)
 *  - Auth middleware for protected routes
 *  - Role-based access control helpers
 * ============================================================
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { db } = require('./db');

const JWT_SECRET      = process.env.JWT_SECRET  || 'dev-secret-change-in-production-min-64-chars!!';
const JWT_EXPIRES     = process.env.JWT_EXPIRES_IN || '7d';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
const BCRYPT_ROUNDS   = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

// ── Password ──────────────────────────────────────────────
async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// ── Access Token ──────────────────────────────────────────
function createAccessToken(user) {
  const payload = {
    sub:   user._id,
    email: user.email,
    role:  user.role,
    name:  `${user.firstName} ${user.lastName}`,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES, issuer: 'strat-planner-pro' });
}

function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET, { issuer: 'strat-planner-pro' });
}

// ── Refresh Token ─────────────────────────────────────────
async function createRefreshToken(userId) {
  const token = uuidv4() + '-' + uuidv4();
  const expiresAt = new Date(Date.now() + ms(REFRESH_EXPIRES));
  await db.refreshTokens.insert({ token, userId, expiresAt, used: false });
  return token;
}

async function rotateRefreshToken(oldToken) {
  const record = await db.refreshTokens.findOne({ token: oldToken, used: false });
  if (!record) throw new Error('Invalid or used refresh token');
  if (new Date() > new Date(record.expiresAt)) {
    await db.refreshTokens.remove({ token: oldToken });
    throw new Error('Refresh token expired');
  }
  // Mark old as used (token rotation prevents reuse)
  await db.refreshTokens.update({ token: oldToken }, { $set: { used: true } });
  // Issue new token
  return createRefreshToken(record.userId);
}

async function revokeRefreshToken(token) {
  return db.refreshTokens.remove({ token });
}

async function revokeAllUserTokens(userId) {
  return db.refreshTokens.remove({ userId }, { multi: true });
}

// ── Middleware ────────────────────────────────────────────
/**
 * requireAuth — verifies JWT in Authorization header.
 * Attaches decoded payload to req.user.
 */
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
    }

    const payload = verifyAccessToken(token);
    req.user = {
      id:    payload.sub,
      email: payload.email,
      role:  payload.role,
      name:  payload.name,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
  }
}

/**
 * requireRole — checks user role after requireAuth.
 * Pass one or more allowed roles.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: roles,
        current: req.user.role,
      });
    }
    next();
  };
}

/**
 * requireAdmin — shorthand for super_admin only routes
 */
const requireAdmin = requireRole('super_admin');

/**
 * optionalAuth — attaches user if token present, doesn't fail if missing.
 */
function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) {
      const payload = verifyAccessToken(token);
      req.user = { id: payload.sub, email: payload.email, role: payload.role, name: payload.name };
    }
  } catch (_) { /* ignore */ }
  next();
}

// ── Duration parser ───────────────────────────────────────
function ms(str) {
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const match = /^(\d+)([smhd])$/.exec(str);
  if (!match) return 7 * 86400000; // default 7d
  return parseInt(match[1]) * (units[match[2]] || 86400000);
}

module.exports = {
  hashPassword,
  verifyPassword,
  createAccessToken,
  verifyAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  requireAuth,
  requireRole,
  requireAdmin,
  optionalAuth,
};
