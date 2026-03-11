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
 *  helmet       — secure HTTP headers
 *  cors         — origin allow-list
 *  rate-limit   — abuse prevention
 *  compression  — gzip responses
 *  morgan       — HTTP access logs
 *  express-json — body parsing (10kb limit)
 * ============================================================
 */

'use strict';

// ── Environment ───────────────────────────────────────────
require('dotenv').config();

const http        = require('http');
const path        = require('path');
const fs          = require('fs');
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');

const { db, ensureIndexes, seed } = require('./src/db');
const { router }                  = require('./src/routes');
const ws                          = require('./src/ws');

// ── App setup ─────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ── Ensure upload directory ───────────────────────────────
const UPLOAD_PATH = process.env.UPLOAD_PATH || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH, { recursive: true });

// ── Security headers ──────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // Handled at CDN/proxy level
}));

// ── CORS ──────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    // Allow no-origin requests (mobile apps, Postman, curl)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['X-RateLimit-Remaining'],
}));

// ── Compression ───────────────────────────────────────────
app.use(compression());

// ── HTTP logging ──────────────────────────────────────────
const logFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(logFormat));

// ── Body parsing ──────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Request ID ───────────────────────────────────────────
app.use((req, _res, next) => {
  req.id = require('crypto').randomBytes(8).toString('hex');
  next();
});

// ── Rate limiting ─────────────────────────────────────────
const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10); // 15 min
const maxReqs  = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);

// Global limiter
app.use('/api/', rateLimit({
  windowMs, max: maxReqs,
  standardHeaders: true,
  legacyHeaders: false,
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

// ── Static files ──────────────────────────────────────────
app.use('/uploads', express.static(UPLOAD_PATH));

// ── API routes ────────────────────────────────────────────
app.use('/api', router());

// ── Root endpoint ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name:    'Strat Planner Pro API',
    version: '1.0.0',
    docs:    '/api/health',
    ws:      'ws://localhost:' + PORT + '/ws',
  });
});

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
      console.log(`   WS:    ws://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/ws`);
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
  // Force-kill after 10 seconds
  setTimeout(() => { console.error('[SERVER] Force exit'); process.exit(1); }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('uncaughtException',  (err) => { console.error('[SERVER] Uncaught exception:', err); });
process.on('unhandledRejection', (err) => { console.error('[SERVER] Unhandled rejection:', err); });

// ── Start ─────────────────────────────────────────────────
start();

module.exports = { app, server }; // for testing
