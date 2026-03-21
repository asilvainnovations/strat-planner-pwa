/**
 * ============================================================
 * STRAT PLANNER PRO — SERVER.JS ROUTING PATCH
 * ============================================================
 * Drop-in replacement for the static-file / routing section
 * of server.js. Replaces the existing "Static files" and
 * "Root endpoint" blocks.
 *
 * New URL architecture:
 *   /              → public/index.html   (landing page, public)
 *   /login         → public/login.html   (auth page, public)
 *   /app           → public/app/index.html (dashboard, auth-gated)
 *   /app/*         → public/app/index.html (SPA fallback)
 *   /api/*         → Express API routes  (JWT-protected per route)
 *   /uploads/*     → Static file uploads (public CDN-style)
 *   /icons/*       → PWA icon assets
 *   /manifest.json → PWA manifest
 *   /sw.js         → Service worker (must be served from /)
 *
 * ============================================================
 * INSTRUCTIONS: In your existing server.js, replace:
 *
 *   // ── Static files ──
 *   app.use('/uploads', express.static(UPLOAD_PATH));
 *
 *   // ── API routes ──
 *   app.use('/api', router());
 *
 *   // ── Root endpoint ──
 *   app.get('/', (req, res) => { ... });
 *
 * with the block marked  >>>REPLACE START<<<  to  >>>REPLACE END<<<
 * below. Everything else in server.js stays the same.
 * ============================================================
 */

// >>>REPLACE START<<<

const path = require('path');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── Uploads & PWA assets (public, no auth) ───────────────
app.use('/uploads',  express.static(UPLOAD_PATH));
app.use('/icons',    express.static(path.join(PUBLIC_DIR, 'icons')));

// Service worker MUST be served from the root scope /
// so it can intercept /app/* requests.
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

// ── API routes (JWT-protected per route in routes.js) ────
app.use('/api', router());

// ── Auth-gate middleware for /app routes ─────────────────
/**
 * Checks for a valid JWT in either:
 *   1. Authorization: Bearer <token> header  (API clients / fetch)
 *   2. spp_access_token cookie               (browser navigation)
 *
 * On failure: browser requests redirect to /login?redirect=<path>
 *             API-style requests (Accept: application/json) get 401.
 */
function requireAuthPage(req, res, next) {
  const { verifyAccessToken } = require('./src/auth');

  // 1. Try Authorization header (fetch calls from the app shell)
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  // 2. Try httpOnly cookie (set by POST /api/auth/login when
  //    you add `res.cookie('spp_access_token', token, { httpOnly: true, secure: true, sameSite: 'lax' })`)
  const cookieToken = req.cookies ? req.cookies.spp_access_token : null;

  const token = bearerToken || cookieToken;

  if (token) {
    try {
      verifyAccessToken(token);
      return next(); // token valid — serve the app
    } catch (_) {
      // token present but invalid/expired — fall through to redirect
    }
  }

  // No valid token: decide how to respond
  const wantsJson = (req.headers.accept || '').includes('application/json');
  if (wantsJson) {
    return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
  }

  // Browser navigation: redirect to login with return path
  const redirect = encodeURIComponent(req.originalUrl);
  return res.redirect(302, `/login?redirect=${redirect}`);
}

// ── Public HTML pages ────────────────────────────────────

// Landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Login / register page
// Supports ?mode=register to pre-select the register tab
// Supports ?redirect=/app/... to return after auth
app.get('/login', (req, res) => {
  // If already authenticated via cookie, skip to app
  const { verifyAccessToken } = require('./src/auth');
  const cookieToken = req.cookies ? req.cookies.spp_access_token : null;
  if (cookieToken) {
    try {
      verifyAccessToken(cookieToken);
      const redirect = req.query.redirect || '/app/';
      return res.redirect(302, redirect);
    } catch (_) { /* expired or invalid — show login */ }
  }
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

// App shell — auth-gated
// All /app and /app/* requests are gated.
// The SPA fallback means any client-side route (e.g. /app/swot)
// returns index.html and the JS router handles the view.
app.get(['/app', '/app/'], requireAuthPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'app', 'index.html'));
});

app.get('/app/*', requireAuthPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'app', 'index.html'));
});

// ── Shared static assets (CSS, JS, images) ───────────────
// Serve everything else in /public as static files.
// This covers: style.css, any shared scripts, favicon, etc.
// Placed AFTER explicit routes so /login, /app, / are not
// accidentally intercepted by static middleware.
app.use(express.static(PUBLIC_DIR, {
  index: false,          // don't auto-serve index.html
  etag: true,
  lastModified: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
}));

// >>>REPLACE END<<<


/**
 * ============================================================
 * ADDITIONAL CHANGES REQUIRED IN server.js
 * ============================================================
 *
 * 1. ADD cookie-parser dependency:
 *
 *    npm install cookie-parser
 *
 *    Then near the top of server.js, after other requires:
 *    const cookieParser = require('cookie-parser');
 *
 *    And add before the routes block:
 *    app.use(cookieParser());
 *
 * 2. UPDATE the login route in routes.js to SET the cookie
 *    (optional but enables the auth-gate above to work for
 *    browser navigation — the current sessionStorage approach
 *    in login.html also works for SPA-style navigation):
 *
 *    // In the POST /api/auth/login handler, after creating tokens:
 *    if (process.env.NODE_ENV === 'production') {
 *      res.cookie('spp_access_token', accessToken, {
 *        httpOnly: true,
 *        secure: true,
 *        sameSite: 'lax',
 *        maxAge: 15 * 60 * 1000, // 15 minutes (match JWT_EXPIRES)
 *      });
 *    }
 *
 * 3. UPDATE manifest.json — change start_url:
 *    "start_url": "/app/"
 *
 * 4. UPDATE sw.js — change service worker scope:
 *    navigator.serviceWorker.register('/sw.js', { scope: '/app/' })
 *
 * 5. UPDATE .gitignore — add:
 *    data/
 *    uploads/
 *
 * 6. DIRECTORY STRUCTURE after these changes:
 *
 *    /
 *    ├── src/
 *    │   ├── auth.js
 *    │   ├── db.js          (was database.js)
 *    │   ├── routes.js
 *    │   ├── email.js
 *    │   └── ws.js
 *    ├── public/
 *    │   ├── index.html     (landing page  →  GET /)
 *    │   ├── login.html     (auth page     →  GET /login)
 *    │   ├── sw.js          (service worker → GET /sw.js)
 *    │   ├── manifest.json
 *    │   ├── style.css
 *    │   ├── icons/
 *    │   │   ├── icon-192.png
 *    │   │   └── icon-512.png
 *    │   └── app/
 *    │       └── index.html (dashboard     →  GET /app/*)
 *    ├── data/              (NeDB files — gitignored)
 *    ├── uploads/           (user uploads  — gitignored)
 *    ├── server.js
 *    └── package.json
 *
 * ============================================================
 */
