/**
 * ============================================================
 * STRAT PLANNER PRO — AUTHENTICATION MODULE  (src/auth.js)
 * ============================================================
 * Single source of truth for all cryptographic operations and
 * Express authentication middleware.
 *
 * Exports:
 *   hashPassword(plain)          → bcrypt hash
 *   verifyPassword(plain, hash)  → boolean
 *   createAccessToken(user)      → signed JWT (15m)
 *   verifyAccessToken(token)     → decoded payload or throws
 *   createRefreshToken(userId)   → UUID pair stored in DB
 *   rotateRefreshToken(old)      → marks old used, issues new
 *   revokeRefreshToken(token)    → deletes single token
 *   revokeAllUserTokens(userId)  → deletes all user sessions
 *   requireAuth                  → Express middleware
 *   requireAdmin                 → Express middleware (re-queries DB)
 *   optionalAuth                 → Express middleware (no-throw)
 *
 * Security notes:
 *   - JWT_SECRET has NO hardcoded fallback — server refuses to
 *     boot in production if the variable is absent (set in db.seed)
 *   - requireAdmin re-queries the database on every request so a
 *     demoted admin loses access immediately, not after token expiry
 *   - Refresh tokens are one-time-use; old token is marked used
 *     BEFORE the new one is issued to prevent replay attacks
 *   - bcrypt cost factor is runtime-configurable via BCRYPT_ROUNDS
 *
 * Wires to:
 *   src/db.js    → db.refreshTokens (read/write), db.users (requireAdmin)
 *   src/routes.js → all exported functions + all three middleware
 *   src/ws.js    → verifyAccessToken (WebSocket auth on connect)
 *   server.js    → verifyAccessToken (requireAuthPage middleware)
 * ============================================================
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// ── Deferred DB import to avoid circular dependency ──────────
// auth.js is required by db.js (inside seed() for hashPassword).
// Importing db at module level would create a circular reference.
// All DB access in this module goes through getDB(), which defers
// the require until after both modules have finished loading.
function getDB() {
  return require('./db').db;
}

// ── JWT secret validation ─────────────────────────────────────
// Called once at boot by server.js after dotenv is loaded.
// Throws immediately if JWT_SECRET is missing — prevents the server
// from starting with an insecure or absent secret.
function validateEnv() {
  if (!process.env.JWT_SECRET) {
    throw new Error(
      '[AUTH] JWT_SECRET is not set. Generate one with:\n' +
      '  node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"\n' +
      'Then add it to your .env file.'
    );
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('[AUTH] JWT_SECRET must be at least 32 characters (64+ recommended).');
  }
}

// ═══════════════════════════════════════════════════════════════
// PASSWORD HASHING
// ═══════════════════════════════════════════════════════════════

/**
 * hashPassword(plain)
 * ───────────────────
 * bcrypt hash at configurable cost (default 12, min 10).
 * Called by: routes.js register + change-password, db.js seed()
 *
 * @param  {string} plain  Plaintext password
 * @returns {Promise<string>} bcrypt hash string
 */
function hashPassword(plain) {
  const rounds = Math.max(10, parseInt(process.env.BCRYPT_ROUNDS || '12', 10));
  return bcrypt.hash(plain, rounds);
}

/**
 * verifyPassword(plain, hash)
 * ──────────────────────────
 * Constant-time comparison via bcrypt.compare (prevents timing attacks).
 * Called by: routes.js login, change-password
 *
 * @param  {string} plain  Plaintext password
 * @param  {string} hash   Stored bcrypt hash
 * @returns {Promise<boolean>}
 */
function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// ═══════════════════════════════════════════════════════════════
// JWT ACCESS TOKENS
// ═══════════════════════════════════════════════════════════════

/**
 * createAccessToken(user)
 * ───────────────────────
 * Signs a short-lived JWT containing the minimum claim set needed
 * to authenticate API requests without a DB lookup.
 *
 * Payload:
 *   sub   — user._id (standard "subject" claim)
 *   email — user.email
 *   name  — firstName + lastName
 *   role  — 'user' | 'super_admin'
 *   init  — initials for UI avatar
 *
 * Expiry: JWT_EXPIRES_IN env var (default 15m, recommended for prod).
 *
 * Called by: routes.js login, register, refresh
 *
 * @param  {object} user  User doc from db.users
 * @returns {string} Signed JWT
 */
function createAccessToken(user) {
  validateEnv();
  const expiresIn = process.env.JWT_EXPIRES_IN || '15m';
  return jwt.sign(
    {
      sub:   user._id,
      email: user.email,
      name:  `${user.firstName} ${user.lastName}`.trim(),
      role:  user.role,
      init:  user.initials,
    },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

/**
 * verifyAccessToken(token)
 * ────────────────────────
 * Verifies signature and expiry. Returns decoded payload on success.
 * Throws jwt.JsonWebTokenError or jwt.TokenExpiredError on failure.
 *
 * Called by:
 *   requireAuth middleware (every protected API request)
 *   server.js requireAuthPage (browser navigation to /app/*)
 *   ws.js (WebSocket connection auth on upgrade)
 *
 * @param  {string} token  JWT string
 * @returns {object} Decoded payload
 * @throws  {Error}  On invalid signature, expiry, or malformed token
 */
function verifyAccessToken(token) {
  validateEnv();
  return jwt.verify(token, process.env.JWT_SECRET);
}

// ═══════════════════════════════════════════════════════════════
// REFRESH TOKENS
// ═══════════════════════════════════════════════════════════════

/**
 * createRefreshToken(userId)
 * ──────────────────────────
 * Generates a UUID-pair refresh token, stores it in db.refreshTokens,
 * and returns the token string to be sent to the client.
 *
 * Tokens are one-time-use (used: false). rotateRefreshToken() marks
 * the old token used:true before issuing a new one.
 *
 * Called by: routes.js login, register
 *
 * @param  {string} userId
 * @returns {Promise<string>} Refresh token UUID
 */
async function createRefreshToken(userId) {
  const db      = getDB();
  const token   = uuidv4();
  const expires = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
  const ms      = parseDuration(expires);

  await db.refreshTokens.insert({
    token,
    userId,
    expiresAt: new Date(Date.now() + ms),
    used:      false,
  });

  return token;
}

/**
 * rotateRefreshToken(oldToken)
 * ────────────────────────────
 * One-time-use rotation:
 *   1. Look up the old token — must exist and not be used/expired
 *   2. Mark old token used:true  ← BEFORE issuing new token
 *   3. Issue a new token for the same userId
 *   4. Return the new token
 *
 * If the old token was already used, this signals a potential replay
 * attack. Both the old and any tokens from the same session could be
 * revoked in a hardened implementation; currently we just throw.
 *
 * Called by: routes.js POST /api/auth/refresh
 *
 * @param  {string} oldToken
 * @returns {Promise<string>} New refresh token
 * @throws  {Error} If token not found, already used, or expired
 */
async function rotateRefreshToken(oldToken) {
  const db     = getDB();
  const record = await db.refreshTokens.findOne({ token: oldToken });

  if (!record) {
    throw new Error('Invalid refresh token');
  }
  if (record.used) {
    throw new Error('Refresh token already used — possible replay attack');
  }
  if (new Date() > new Date(record.expiresAt)) {
    throw new Error('Refresh token expired');
  }

  // Mark old token used BEFORE creating the new one
  await db.refreshTokens.update({ _id: record._id }, { $set: { used: true } });

  // Issue new token
  return createRefreshToken(record.userId);
}

/**
 * revokeRefreshToken(token)
 * ─────────────────────────
 * Deletes a single refresh token from the store (logout).
 * Called by: routes.js POST /api/auth/logout
 *
 * @param  {string} token
 * @returns {Promise<void>}
 */
async function revokeRefreshToken(token) {
  const db = getDB();
  await db.refreshTokens.remove({ token });
}

/**
 * revokeAllUserTokens(userId)
 * ───────────────────────────
 * Deletes ALL refresh tokens for a user.
 * Called when:
 *   - User changes password (routes.js change-password)
 *   - Admin deactivates account (routes.js DELETE /admin/users/:id)
 *
 * @param  {string} userId
 * @returns {Promise<void>}
 */
async function revokeAllUserTokens(userId) {
  const db = getDB();
  await db.refreshTokens.remove({ userId }, { multi: true });
}

// ═══════════════════════════════════════════════════════════════
// EXPRESS MIDDLEWARE
// ═══════════════════════════════════════════════════════════════

/**
 * requireAuth
 * ───────────
 * Verifies the JWT in the Authorization header.
 * On success: sets req.user = { id, email, name, role, init }
 * On failure: returns 401 JSON.
 *
 * Token source: Authorization: Bearer <token>
 *
 * Used on: every protected route in routes.js
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
  }

  try {
    const payload = verifyAccessToken(token);
    // Normalise payload fields to consistent req.user shape
    req.user = {
      id:       payload.sub,
      email:    payload.email,
      name:     payload.name,
      role:     payload.role,
      initials: payload.init,
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
 * requireAdmin
 * ────────────
 * Requires the caller to be a super_admin.
 *
 * SECURITY: Re-queries the database on every request to get the live
 * role value. This means a demoted admin loses access immediately
 * rather than waiting for their JWT to expire (which could be up to
 * 15 minutes away). The JWT role claim is NOT trusted for admin checks.
 *
 * Must be used AFTER requireAuth (relies on req.user being set).
 *
 * Used on: all /api/admin/* routes in routes.js
 */
async function requireAdmin(req, res, next) {
  // requireAuth must run first
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Re-query live role from DB — do not trust JWT claim
    const db   = getDB();
    const user = await db.users.findOne({ _id: req.user.id, isActive: true });

    if (!user) {
      return res.status(401).json({ error: 'Account not found or deactivated' });
    }
    if (user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Administrator access required' });
    }

    // Update req.user with fresh DB values in case they've changed
    req.user.role = user.role;
    next();

  } catch (err) {
    console.error('[AUTH] requireAdmin DB error:', err);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

/**
 * optionalAuth
 * ────────────
 * Sets req.user if a valid token is present, but does NOT block
 * the request if the token is absent or invalid.
 *
 * Used on: GET /api/templates (public templates visible without login)
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (token) {
    try {
      const payload = verifyAccessToken(token);
      req.user = {
        id:       payload.sub,
        email:    payload.email,
        name:     payload.name,
        role:     payload.role,
        initials: payload.init,
      };
    } catch {
      // Invalid token → treat as unauthenticated, don't block
      req.user = null;
    }
  } else {
    req.user = null;
  }

  next();
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * parseDuration(str)
 * ──────────────────
 * Converts a duration string to milliseconds.
 * Supports: s (seconds), m (minutes), h (hours), d (days)
 * Falls back to 30 days on unrecognised input.
 *
 * Examples: '15m' → 900000, '30d' → 2592000000, '7d' → 604800000
 *
 * NOTE: The jsonwebtoken library accepts duration strings directly
 * in its expiresIn option (it uses the same ms library), so this
 * helper is only needed for computing refresh token expiresAt dates.
 *
 * @param  {string} str  e.g. '30d', '15m', '1h'
 * @returns {number} Milliseconds
 */
function parseDuration(str) {
  const match = String(str).match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 30 * 86400 * 1000; // default 30d

  const value = parseInt(match[1], 10);
  const unit  = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  // Password
  hashPassword,
  verifyPassword,
  // JWT
  createAccessToken,
  verifyAccessToken,
  // Refresh tokens
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  // Middleware
  requireAuth,
  requireAdmin,
  optionalAuth,
  // Boot validation
  validateEnv,
};