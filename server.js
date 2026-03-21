/**
 * ============================================================
 * STRAT PLANNER PRO — MAIN SERVER
 * ============================================================
 * Express + WebSocket server for the Strat Planner Pro API.
 *
 * Architecture:
 *  HTTP Server (Express)
 *  ├── /api/*            — REST API routes
 *  ├── /ws               — WebSocket upgrade (real-time)
 *  └── /uploads          — Static file serving (uploads)
 *
 * Security layers (in order):
 *  helmet        — secure HTTP headers
 *  cors          — origin allow-list
 *  rate-limit    — abuse prevention
 *  compression   — gzip responses
 *  morgan        — HTTP access logs
 *  cookie-parser — parse httpOnly auth cookies
 *  express-json  — body parsing (10mb limit)
 *
 * Fixes applied in this version:
 *  [FIX-1] Added cookie-parser middleware (required for
 *          requireAuthPage cookie check in routing patch)
 *  [FIX-2] uncaughtException handler now calls process.exit(1)
 *          after logging — prevents server running in undefined state
 *  [FIX-3] unhandledRejection handler now calls process.exit(1)
 *          after logging — same reason as above
 * ============================================================
 */

'use strict';

// ── Environment ───────────────────────────────────────────
require('dotenv').config();

const http         = require('http');
const path         = require('path');
const fs           = require('fs');
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const compression  = require('compression');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser'); // [FIX-1] added

const { db, ensureIndexes, seed } = require('./src/db');
const { router }                  = require('./src/routes');
const ws                          = require('./src/ws');
const email                       = require('./src/email');

// ── Optional observability (graceful no-ops when not installed) ───
// Install with: npm install @sentry/node pino pino-http
let Sentry   = null;
let pinoHttp = null;
try { Sentry   = require('@sentry/node');  } catch (_) { /* not installed */ }
try { pinoHttp = require('pino-http');     } catch (_) { /* not installed */ }

// ── App setup ─────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ── Ensure upload directory ───────────────────────────────
const UPLOAD_PATH = process.env.UPLOAD_PATH || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH, { recursive: true });

// ── Security headers + Content Security Policy ───────────────────
// CSP is defined here so it works with or without Nginx / CDN.
// Adjust script-src and connect-src to match your real domain in prod.
const isProd = process.env.NODE_ENV === 'production';

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: isProd ? {
    useDefaults: false,
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:         ["'self'", 'data:', process.env.CORS_ORIGINS || ''],
      connectSrc:     ["'self'",
        // Allow wss:// WebSocket on same origin and explicitly listed domain
        ...(process.env.CORS_ORIGINS || '').split(',').map(o => o.trim().replace(/^http/, 'ws')).filter(Boolean),
        ...(process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean),
      ],
      workerSrc:      ["'self'"],
      manifestSrc:    ["'self'"],
      frameAncestors: ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      upgradeInsecureRequests: [],
    },
  } : false,  // CSP disabled in development for easier debugging
  hsts: isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
}));

// ── CORS ──────────────────────────────────────────────────
// In development (NODE_ENV !== 'production') all origins are
// allowed — this is required for StackBlitz, CodeSandbox, and
// other browser-based IDEs that proxy requests through their
// own domains (e.g. https://8080-project.stackblitz.io).
//
// In production, CORS_ORIGINS must be set to your real domain.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // No origin = same-origin / Postman / curl — always allow
    if (!origin) return cb(null, true);
    // Development: allow everything so any IDE proxy URL works
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    // Production: enforce allow-list
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['X-RateLimit-Remaining'],
}));

// ── Sentry error monitoring (no-op if SENTRY_DSN not set) ────────
if (Sentry && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn:              process.env.SENTRY_DSN,
    environment:      process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,   // 10% of requests traced
  });
  app.use(Sentry.Handlers.requestHandler());
  console.log('[BOOT] Sentry error monitoring enabled');
}

// ── Structured logging via Pino (falls back to morgan) ────────────
if (pinoHttp) {
  app.use(pinoHttp({ level: process.env.LOG_LEVEL || 'info' }));
} 

// ── Compression ───────────────────────────────────────────
app.use(compression());

// ── HTTP logging ──────────────────────────────────────────
const logFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(logFormat));

// ── Cookie parser ─────────────────────────────────────────
// [FIX-1] Required for requireAuthPage() to read the spp_access_token
// httpOnly cookie set by POST /api/auth/login. Without this middleware
// req.cookies is always undefined and the auth gate falls back to
// header-only auth, breaking browser navigation to /app/*.
app.use(cookieParser());

// ── Body parsing ──────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Request ID ────────────────────────────────────────────
app.use((req, _res, next) => {
  req.id = require('crypto').randomBytes(8).toString('hex');
  next();
});

// ── Rate limiting ─────────────────────────────────────────
const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10); // 15 min
const maxReqs  = parseInt(process.env.RATE_LIMIT_MAX       || '100',    10);

// Global limiter
app.use('/api/', rateLimit({
  windowMs, max: maxReqs,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
}));

// Stricter limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10),
  message: { error: 'Too many authentication attempts, please try again in 15 minutes.' },
});
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// Per-email account lockout — 5 attempts per 15 min per email address.
// This is applied in addition to the IP-based authLimiter above.
// KeyGenerator uses req.body.email so each account is tracked individually.
// Important: express-rate-limit v7 requires trust proxy set for behind-proxy use.
app.set('trust proxy', 1);
const emailLockoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      5,
  keyGenerator: (req) => (req.body?.email || req.ip || 'unknown').toLowerCase(),
  message: { error: 'Account temporarily locked. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: (req) => !req.body?.email, // skip if no email in body (malformed requests)
});
app.use('/api/auth/login', emailLockoutLimiter);

// ── Static files ──────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use('/uploads', express.static(UPLOAD_PATH));
app.use('/icons',   express.static(path.join(PUBLIC_DIR, 'icons')));

// Service worker must be served from root scope /
// so it can intercept /app/* fetch requests
app.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'sw.js'));
});

// PWA manifest
app.get('/manifest.json', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(PUBLIC_DIR, 'manifest.json'));
});

// ── API routes ────────────────────────────────────────────
app.use('/api', router());

// ── Auth-gate middleware for /app routes ──────────────────
/**
 * requireAuthPage
 * ───────────────
 * Verifies a valid JWT before serving the dashboard shell.
 * Checks (in order):
 *   1. Authorization: Bearer <token> header  (fetch calls from app)
 *   2. spp_access_token httpOnly cookie      (browser navigation)
 *
 * On missing/invalid token:
 *   - JSON clients  → 401 { error: 'Authentication required' }
 *   - Browser nav   → 302 redirect to /login?redirect=<original path>
 */
function requireAuthPage(req, res, next) {
  const { verifyAccessToken } = require('./src/auth');

  const authHeader  = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookieToken = req.cookies ? req.cookies.spp_access_token : null; // [FIX-1] now works

  const token = bearerToken || cookieToken;

  if (token) {
    try {
      verifyAccessToken(token);
      return next();
    } catch (_) {
      // token present but invalid/expired — fall through to redirect
    }
  }

  const wantsJson = (req.headers.accept || '').includes('application/json');
  if (wantsJson) {
    return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
  }

  const redirect = encodeURIComponent(req.originalUrl);
  return res.redirect(302, `/login?redirect=${redirect}`);
}

// ── Public HTML pages ─────────────────────────────────────

// Landing page (public)
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Login / register page (public; skips to /app/ if cookie valid)
app.get('/login', (req, res) => {
  const { verifyAccessToken } = require('./src/auth');
  const cookieToken = req.cookies ? req.cookies.spp_access_token : null;
  if (cookieToken) {
    try {
      verifyAccessToken(cookieToken);
      const redirect = req.query.redirect || '/app/';
      return res.redirect(302, redirect);
    } catch (_) { /* expired or invalid — show login page */ }
  }
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

// Dashboard SPA shell (auth-gated)
app.get(['/app', '/app/'], requireAuthPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'app', 'index.html'));
});

app.get('/app/*', requireAuthPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'app', 'index.html'));
});

// Shared static assets (CSS, fonts, etc.) — placed AFTER explicit routes
app.use(express.static(PUBLIC_DIR, {
  index:        false,
  etag:         true,
  lastModified: true,
  maxAge:       process.env.NODE_ENV === 'production' ? '1d' : 0,
}));

// ── Sentry error handler (must be before 404, after all routes) ──
if (Sentry && process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

// ── 404 handler ───────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── Global error handler ──────────────────────────────────
app.use((err, req, res, _next) => {
  const status  = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal server error'
    : err.message || 'Internal server error';

  if (status >= 500) {
    console.error(`[SERVER] Error ${status} on ${req.method} ${req.path}:`, err);
  }

  res.status(status).json({ error: message, requestId: req.id });
});

// ── Startup ───────────────────────────────────────────────
async function start() {
  try {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║       STRAT PLANNER PRO — SERVER       ║');
    console.log('╚════════════════════════════════════════╝\n');

    // Validate environment at boot — throws in production if config is missing
    console.log('[BOOT] Validating environment...');
    email.validateEmailEnv();
    // Validate JWT_SECRET at boot — auth.js also validates but this
    // gives a clearer error message in the startup log
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 64) {
      throw new Error('JWT_SECRET must be at least 64 characters. Generate with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    }
    if (isProd && !process.env.CORS_ORIGINS) {
      throw new Error('CORS_ORIGINS must be set in production');
    }

    // Initialize database
    console.log('[BOOT] Initializing database...');
    await ensureIndexes();
    await seed();

    // Attach WebSocket server
    console.log('[BOOT] Attaching WebSocket server...');
    ws.attach(server);

    // Start HTTP server
    server.listen(PORT, HOST, () => {
      console.log(`\n✅ Server ready`);
      console.log(`   HTTP:  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
      console.log(`   WS:    ws://${HOST  === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/ws`);
      console.log(`   API:   http://localhost:${PORT}/api/health`);
      console.log(`   Env:   ${process.env.NODE_ENV || 'development'}\n`);
    });

  } catch (err) {
    console.error('[BOOT] Fatal startup error:', err);
    process.exit(1);
  }
}

// ── Graceful shutdown ─────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[SERVER] ${signal} received — shutting down gracefully...`);
  server.close(() => {
    console.log('[SERVER] HTTP server closed');
    process.exit(0);
  });
  // Force-kill after 10 seconds if connections don't drain
  setTimeout(() => {
    console.error('[SERVER] Force exit after 10s timeout');
    process.exit(1);
  }, 10000).unref(); // .unref() so the timer doesn't keep the process alive on its own
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── [FIX-2] uncaughtException — exit after logging ────────
// Previously only logged and continued. Continuing after an uncaught
// exception is dangerous — the process is in an undefined state.
// Node.js docs explicitly recommend exiting. PM2/systemd will restart.
process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught exception — exiting:', err);
  process.exit(1); // [FIX-2]
});

// ── [FIX-3] unhandledRejection — exit after logging ───────
// Same reasoning as uncaughtException above. Unhandled promise
// rejections indicate a programming error. Exiting allows the process
// manager to restart cleanly rather than running with corrupted state.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled rejection at:', promise, '— reason:', reason);
  process.exit(1); // [FIX-3]
});

// ── Start ─────────────────────────────────────────────────
start();

module.exports = { app, server }; // for testing
