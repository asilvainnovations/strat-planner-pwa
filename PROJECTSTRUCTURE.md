# Strat Planner Pro — Complete Project Structure
## Full-stack wiring reference for every file in the project

---

## Directory Tree

```
strat-planner-pro/
│
├── server.js                        ← Node.js HTTP + WebSocket entry point
├── package.json                     ← Dependencies, scripts, engine constraints
├── .gitignore                       ← Excludes data/, uploads/, node_modules/, .env
├── .env.example                     ← Required env var template (committed)
├── .env                             ← Live secrets (gitignored, never committed)
│
├── src/                             ← All back-end logic
│   ├── auth.js                      ← JWT + bcrypt + middleware
│   ├── db.js                        ← NeDB collections, indexes, helpers, seed
│   ├── routes.js                    ← All REST API route handlers
│   ├── email.js                     ← Nodemailer transactional email
│   └── ws.js                        ← WebSocket server (rooms, presence, broadcast)
│
├── public/                          ← All static files served by Express
│   ├── index.html                   ← Landing / marketing page  (GET /)
│   ├── login.html                   ← Auth page: sign-in + register  (GET /login)
│   ├── sw.js                        ← Service worker: offline, sync, push  (GET /sw.js)
│   ├── manifest.json                ← PWA install manifest  (GET /manifest.json)
│   ├── style.css                    ← Shared design system & component CSS
│   │
│   ├── icons/                       ← PWA icon assets (local, not external CDN)
│   │   ├── icon-192.png             ← Android home screen icon
│   │   └── icon-512.png             ← Splash screen / maskable icon
│   │
│   └── app/
│       └── index.html               ← Dashboard SPA shell  (GET /app/*)
│
├── data/                            ← NeDB flat-file databases (gitignored)
│   ├── users.db
│   ├── organizations.db
│   ├── org_members.db
│   ├── plans.db
│   ├── plan_members.db
│   ├── swot_items.db
│   ├── strategies.db
│   ├── kpis.db
│   ├── initiatives.db
│   ├── comments.db
│   ├── notifications.db
│   ├── activity_log.db
│   ├── templates.db
│   ├── invitations.db
│   └── refresh_tokens.db
│
├── uploads/                         ← User-uploaded files (gitignored)
│
└── scripts/                         ← One-off operational scripts
    ├── seed.js                      ← Manual re-seed (calls db.seed())
    └── reset-db.js                  ← Wipes data/ directory (dev only)
```

---

## File-by-file Reference

### `server.js` — HTTP + WebSocket Entry Point

**Purpose:** Bootstraps the entire application. Wires together Express, all middleware, static file serving, API routes, WebSocket, and graceful shutdown.

**Wires to:**
- `src/db.js` → calls `ensureIndexes()` and `seed()` on startup
- `src/routes.js` → mounts REST API at `/api/*`
- `src/ws.js` → calls `ws.attach(server)` to upgrade HTTP → WebSocket at `/ws`
- `public/` → serves all static files
- `.env` → reads PORT, HOST, CORS_ORIGINS, RATE_LIMIT_*, NODE_ENV

**Key responsibilities:**
```
Request arrives
   │
   ├─ helmet()            → sets secure HTTP headers (XSS, HSTS, etc.)
   ├─ cors()              → allows only origins listed in CORS_ORIGINS env var
   ├─ compression()       → gzip all responses
   ├─ morgan()            → HTTP access log (dev: colorised, prod: combined)
   ├─ express.json()      → parse JSON bodies (10mb limit)
   ├─ requestId()         → attaches crypto.randomBytes(8) ID to every req
   ├─ rateLimit /api/     → 100 req / 15 min (global API)
   ├─ rateLimit /auth/*   → 10 req / 15 min (auth endpoints only)
   │
   ├─ GET /sw.js          → service worker (Cache-Control: no-cache)
   ├─ GET /manifest.json  → PWA manifest
   ├─ GET /               → public/index.html  (landing page)
   ├─ GET /login          → public/login.html  (skips to /app/ if cookie valid)
   ├─ GET /app            → public/app/index.html  ← requireAuthPage guard
   ├─ GET /app/*          → public/app/index.html  ← requireAuthPage guard
   ├─ /api/*              → routes.js router
   ├─ /uploads/*          → express.static(UPLOAD_PATH)
   └─ express.static(PUBLIC_DIR)  → style.css, icons/, etc.
```

**Auth guard (`requireAuthPage`):**
```
Browser navigates to /app/*
   │
   ├─ Check Authorization: Bearer <token> header  (fetch from app shell)
   ├─ Check spp_access_token cookie               (browser navigation)
   │
   ├─ Token valid  → serve public/app/index.html
   └─ No token     → redirect 302 → /login?redirect=/app/...
```

**Graceful shutdown:**
```
SIGTERM / SIGINT received
   ├─ server.close()  → stop accepting new connections
   ├─ process.exit(0) on clean close
   └─ force process.exit(1) after 10s timeout
```

---

### `src/auth.js` — Authentication & Authorization

**Purpose:** All cryptographic and identity logic. Issued once, used everywhere.

**Wires to:**
- `src/db.js` → reads/writes `db.refreshTokens` collection
- `src/routes.js` → exports middleware: `requireAuth`, `requireAdmin`, `optionalAuth`
- `src/ws.js` → exports `verifyAccessToken` for WebSocket auth
- `server.js` → exports `verifyAccessToken` for `requireAuthPage` middleware

**Exported functions and their callers:**

| Export | Called by | Purpose |
|--------|-----------|---------|
| `hashPassword(plain)` | `routes.js` register + change-password | bcrypt hash, cost 12 |
| `verifyPassword(plain, hash)` | `routes.js` login | bcrypt.compare (constant-time) |
| `createAccessToken(user)` | `routes.js` login + register + refresh | Signs JWT, 15min expiry |
| `verifyAccessToken(token)` | `requireAuth`, `ws.js`, `server.js` guard | Verify + decode JWT |
| `createRefreshToken(userId)` | `routes.js` login + register | UUID pair stored in DB |
| `rotateRefreshToken(old)` | `routes.js` POST /api/auth/refresh | Marks old used, issues new |
| `revokeRefreshToken(token)` | `routes.js` logout | Deletes single token |
| `revokeAllUserTokens(userId)` | `routes.js` change-password, admin delete | Deletes all user sessions |
| `requireAuth` | Every protected route in `routes.js` | Verifies Bearer token, sets req.user |
| `requireAdmin` | Admin routes in `routes.js` | Checks role === 'super_admin' |
| `optionalAuth` | `GET /templates` in `routes.js` | Attaches user if token present |

**Token flow:**
```
POST /api/auth/login
   │
   ├─ verifyPassword()
   ├─ createAccessToken()   → JWT (15 min)  → returned to client
   └─ createRefreshToken()  → UUID stored in db.refreshTokens → returned to client

Client stores:
   sessionStorage.spp_access_token  (login.html)
   sessionStorage.spp_refresh_token (login.html)

Every API request:
   Authorization: Bearer <accessToken>
        │
        └─ requireAuth middleware → verifyAccessToken() → req.user = { id, email, role, name }

Token expiry:
   POST /api/auth/refresh  { refreshToken }
        │
        └─ rotateRefreshToken() → marks old as used → returns new pair
```

**⚠ Required fix before launch:**
- Reduce `JWT_EXPIRES` from 7d to 15m
- Remove hardcoded fallback: `JWT_SECRET || 'dev-secret...'`
- `requireAdmin` must re-query DB role, not trust JWT claim

---

### `src/db.js` — Database Layer

**Purpose:** All data persistence. Defines 15 NeDB collections, indexes, helper queries, and the seed function. The single source of truth for data shape.

**Wires to:**
- `server.js` → calls `ensureIndexes()` + `seed()` at boot
- `src/routes.js` → imports `db` object + `helpers` for all CRUD
- `src/auth.js` → reads `db.refreshTokens`, imports `hashPassword` for seed
- `src/email.js` → no direct import (routes.js reads DB then calls email)

**Collections and their purpose:**

| Collection | File | Purpose |
|------------|------|---------|
| `db.users` | users.db | Accounts: email (unique), bcrypt hash, role, isActive |
| `db.organizations` | organizations.db | Org entities: name, type, ownerId |
| `db.orgMembers` | org_members.db | User↔Org join: userId, orgId, role (viewer/editor/admin) |
| `db.plans` | plans.db | Plan header: name, orgId, ownerId, period, isDeleted |
| `db.planMembers` | plan_members.db | User↔Plan sharing: userId, planId, role |
| `db.swotItems` | swot_items.db | SWOT entries: planId, category, text, evidence, impact |
| `db.strategies` | strategies.db | SO/ST/WO/WT: planId, type, text, priority |
| `db.kpis` | kpis.db | Scorecard KPIs: planId, perspective, kpi, target, actual, status |
| `db.initiatives` | initiatives.db | PAPs: planId, type, name, owner, budget, utilized, progress |
| `db.comments` | comments.db | Threaded comments on any entity: planId, entityId, text |
| `db.notifications` | notifications.db | In-app alerts: userId, type, message, read |
| `db.activityLog` | activity_log.db | Full audit trail: userId, action, entityType, ipAddress |
| `db.templates` | templates.db | Reusable plan templates: isPublic, isBuiltIn, industry |
| `db.invitations` | invitations.db | Pending email invites: token (unique), email, expiresAt |
| `db.refreshTokens` | refresh_tokens.db | JWT refresh store: token (unique), userId, used, expiresAt |

**Helper functions:**

| Helper | Used in | Returns |
|--------|---------|---------|
| `findUserByEmail(email)` | routes.js login/register | User doc or null |
| `findPlanWithAccess(planId, userId)` | routes.js GET /plans/:id | { plan, role } or null |
| `getUserPlans(userId)` | routes.js GET /plans | { owned[], shared[] } |
| `getPlanRole(userId, planId)` | All write routes | role string or null |
| `getOrgRole(userId, orgId)` | Org write routes | role string or null |
| `logActivity(data)` | After every mutation in routes.js | activity_log doc |
| `createNotification(data)` | Comment, share, KPI alert flows | notification doc |

**⚠ Required fix before launch:**
- Remove `adminPass` fallback: `|| 'StratAdmin@2025!'`
- Move `require('./auth')` inside `seed()` to module top-level to prevent circular dep risk
- Plan NeDB → PostgreSQL migration before >100 active organisations

---

### `src/routes.js` — REST API Route Handlers

**Purpose:** All HTTP API endpoints. Every feature in the front-end has a corresponding route here. Enforces auth, validation, DB writes, email triggers, WebSocket broadcasts, and activity logging.

**Wires to:**
- `src/db.js` → all DB reads/writes via `db.*` and `helpers.*`
- `src/auth.js` → `requireAuth`, `requireAdmin`, `optionalAuth` on every route
- `src/email.js` → triggered after invite, share, comment, KPI alert, register, password reset
- `src/ws.js` → `broadcastPlanUpdate()` after every mutation; `pushToUser()` for notifications

**Route groups and their front-end consumers:**

```
AUTH  /api/auth/*
├── POST   /register          ← login.html handleRegister()
├── POST   /login             ← login.html handleLogin()
├── POST   /refresh           ← app/index.html (token refresh, to be wired)
├── POST   /logout            ← app/index.html user menu (to be wired)
├── GET    /me                ← app/index.html on load (to be wired)
├── PATCH  /me                ← app/index.html profile edit (to be wired)
├── POST   /change-password   ← app/index.html settings (to be wired)
└── POST   /forgot-password   ← login.html showForgotPassword()  ⚠ route missing, needs adding

ORGANISATIONS  /api/orgs/*
├── GET    /                  ← app/index.html initTeam() (to be wired)
├── POST   /                  ← app/index.html createOrganization() (to be wired)
├── GET    /:id/members       ← app/index.html initTeam() (to be wired)
├── POST   /:id/invite        ← app/index.html sendInvite() (to be wired)
└── POST   /accept-invite     ← invite email link → login.html (to be wired)

PLANS  /api/plans/*
├── GET    /                  ← app/index.html openPlanSelector() (to be wired)
├── POST   /                  ← app/index.html confirmNewPlan() (to be wired)
├── GET    /:id               ← app/index.html on load — hydrates STATE (to be wired)
├── PATCH  /:id               ← app/index.html selectPlan() (to be wired)
├── DELETE /:id               ← app/index.html (to be wired)
└── POST   /:id/share         ← app/index.html sharePlan() (to be wired)

SWOT  /api/plans/:planId/swot
├── GET    /                  ← app/index.html initSwot() (to be wired)
├── POST   /                  ← app/index.html saveSwotItem() (to be wired)
├── PATCH  /:id               ← app/index.html (to be wired)
└── DELETE /:id               ← app/index.html deleteSwotItem() (to be wired)

STRATEGIES  /api/plans/:planId/strategies
├── GET    /                  ← app/index.html initStrategyMatrix() (to be wired)
├── POST   /                  ← app/index.html saveStrategy() (to be wired)
├── PATCH  /:id               ← (to be wired)
└── DELETE /:id               ← (to be wired)

KPIs  /api/plans/:planId/kpis
├── GET    /                  ← app/index.html initScorecard() (to be wired)
├── POST   /                  ← app/index.html saveKPI() (to be wired)
├── PATCH  /:id               ← app/index.html (triggers KPI alert email if behind/at-risk)
└── DELETE /:id               ← (to be wired)

INITIATIVES  /api/plans/:planId/initiatives
├── GET    /                  ← app/index.html initInitiatives() (returns budget totals)
├── POST   /                  ← app/index.html saveInitiative() (to be wired)
├── PATCH  /:id               ← app/index.html updateInitiative() (to be wired)
└── DELETE /:id               ← app/index.html deleteInitiative() (to be wired)

COMMENTS  /api/plans/:planId/comments
├── GET    /                  ← app/index.html openComment() (to be wired)
├── POST   /                  ← app/index.html addComment() (triggers email + WS push)
├── PATCH  /:id/resolve       ← (triggers resolved email)
└── DELETE /:id               ← (to be wired)

NOTIFICATIONS  /api/notifications
├── GET    /                  ← app/index.html initNotifications()  ⚠ query bug — fix before launch
├── PATCH  /read-all          ← app/index.html clearNotifs() (to be wired)
└── PATCH  /:id/read          ← (to be wired)

ACTIVITY  /api/plans/:planId/activity
└── GET    /                  ← app/index.html initActivity() (to be wired)

TEMPLATES  /api/templates
├── GET    /                  ← app/index.html initTemplates() (to be wired)
├── POST   /                  ← app/index.html confirmSaveTemplate() (to be wired)
└── DELETE /:id               ← (to be wired)

SYNC  /api/sync
└── POST   /                  ← sw.js syncPlans() background sync  ⚠ needs Auth header in sw.js

AI PROXY  /api/ai/*           ← ⚠ MISSING — must be added before launch
├── POST   /swot              ← app/index.html generateSwotAI() (currently calls Anthropic directly)
└── POST   /strategy          ← app/index.html generateStrategyAI() (currently calls Anthropic directly)

ADMIN  /api/admin/*           ← requireAdmin middleware on all
├── GET    /stats             ← app/index.html initAdmin() (to be wired)
├── GET    /users             ← app/index.html initAdmin() (to be wired)
├── PATCH  /users/:id         ← app/index.html changeRole() (to be wired)
├── DELETE /users/:id         ← (to be wired)
├── GET    /audit-log         ← app/index.html initAdmin() (to be wired)
└── GET    /plans             ← (to be wired)

HEALTH  /api/health
└── GET    /                  ← monitoring / uptime checks (public)
```

**Data flow for a typical mutation (add SWOT item):**
```
app/index.html saveSwotItem()
   │
   ├─ POST /api/plans/:planId/swot  { category, text, evidence }
   │    │
   │    ├─ requireAuth → verifies JWT → sets req.user
   │    ├─ express-validator → validates category is enum, text non-empty
   │    ├─ helpers.getPlanRole() → confirms user has editor/admin access
   │    ├─ db.swotItems.insert()  → writes to swot_items.db
   │    ├─ helpers.logActivity()  → writes to activity_log.db
   │    ├─ ws.broadcastPlanUpdate() → pushes PLAN_UPDATED to all /ws room subscribers
   │    └─ res.status(201).json({ item })
   │
   ├─ app/index.html receives { item }
   ├─ Pushes item into STATE.activePlan.swot[category]
   └─ Calls initSwot() to re-render quadrant
```

**⚠ Bugs to fix:**
- `GET /notifications` — broken ternary causes double full table scan every load
- `POST /api/ai/*` — route does not exist (client calls Anthropic API directly, exposing key)
- Soft-delete on plan does not cascade to child records
- `/api/sync` batch has no max-size guard (DoS risk)

---

### `src/email.js` — Transactional Email Service

**Purpose:** All outbound email. Seven HTML-templated messages sent via Nodemailer SMTP. Falls back to console-log in development when `SMTP_USER` is absent.

**Wires to:**
- `src/routes.js` → called (fire-and-forget with `.catch(console.error)`) after:
  - Register → `sendWelcomeEmail()`
  - Org invite → `sendInviteToOrg()`
  - Plan share → `sendSharePlan()`
  - Comment added → `sendCommentNotification()`
  - Comment resolved → `sendCommentResolved()`
  - KPI status → 'behind'/'at-risk' → `sendKPIAlert()`
  - Password reset → `sendPasswordReset()` ⚠ route not yet wired in routes.js

**Email templates and their trigger points:**

| Function | Triggered by | Recipient | Subject |
|----------|-------------|-----------|---------|
| `sendWelcomeEmail` | POST /api/auth/register | new user | Welcome to Strat Planner Pro |
| `sendInviteToOrg` | POST /api/orgs/:id/invite | invitee email | {inviter} invited you to {org} |
| `sendSharePlan` | POST /api/plans/:id/share | target email | {sharer} shared "{plan}" with you |
| `sendCommentNotification` | POST /api/plans/:planId/comments | plan owner | {commenter} commented on "{entity}" |
| `sendCommentResolved` | PATCH /api/plans/:planId/comments/:id/resolve | comment author | Your comment on "{entity}" was resolved |
| `sendKPIAlert` | PATCH /api/plans/:planId/kpis/:id (status→behind/at-risk) | plan owner | KPI Alert: "{kpiName}" is {status} |
| `sendPasswordReset` | POST /api/auth/forgot-password ⚠ (not yet created) | requesting user | Reset your Strat Planner Pro password |

**Dev/prod switching:**
```
NODE_ENV=development OR SMTP_USER unset:
   → console.log mock (no emails sent, safe for local dev)

NODE_ENV=production AND SMTP_USER set:
   → nodemailer.createTransport() → real SMTP delivery
```

**⚠ Required fix before launch:**
- Add startup validation: if `NODE_ENV=production` and `SMTP_USER` is absent, throw at boot
- Cap email subject lines at ~70 characters (comment subject currently unbounded)
- Add `POST /api/auth/forgot-password` route in `routes.js` to wire `sendPasswordReset`

---

### `src/ws.js` — WebSocket Real-Time Collaboration

**Purpose:** Live presence, plan updates, and user notifications over persistent WebSocket connections. The back-end half of the collaboration layer.

**Wires to:**
- `server.js` → `ws.attach(httpServer)` upgrades HTTP → WS at `/ws`
- `src/auth.js` → `verifyAccessToken()` authenticates every connection before it's accepted
- `src/routes.js` → `broadcastPlanUpdate()` and `pushToUser()` called after every DB mutation

**Connection lifecycle:**
```
Client connects to ws://host/ws?token=<jwt>   (or Authorization header)
   │
   ├─ extractToken() → verifyAccessToken()
   ├─ Fail → ws.close(4001/4002)
   └─ Pass → clients.set(ws, { userId, userName, planId: null, ... })
          │
          ├─ SUBSCRIBE_PLAN { planId }
          │    └─ rooms.get(planId).add(ws) → broadcastPresence()
          │
          ├─ PING → PONG
          │
          ├─ CURSOR_MOVE → broadcastToRoom (excludes sender)
          │
          └─ close → leaveRoom() → broadcastPresence() → clients.delete(ws)

Heartbeat (every 30s):
   forEach ws → if !ws.isAlive → ws.terminate()
              → ws.isAlive = false → ws.ping()
              → pong received → ws.isAlive = true
```

**Server → client message types:**

| Type | Sent by | Payload |
|------|---------|---------|
| `CONNECTED` | ws.js on connect | { userId, name } |
| `PRESENCE_UPDATE` | ws.js on join/leave | { members: [{userId, userName, initials, color}] } |
| `PLAN_UPDATED` | routes.js after any mutation | { section, action, item/id, userName } |
| `COMMENT_ADDED` | routes.js POST /comments | { comment } |
| `CURSOR_UPDATE` | ws.js relay | { userId, userName, section } |
| `NOTIFICATION` | routes.js share/comment flows | { type, message, planId } |
| `PONG` | ws.js | (empty) |
| `ERROR` | ws.js on bad message | { message } |

**Front-end (app/index.html) integration needed:**
```javascript
// Add to app/index.html — connect on load after auth:
const token = sessionStorage.getItem('spp_access_token');
const ws = new WebSocket(`wss://${location.host}/ws?token=${token}`);

ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  switch (msg.type) {
    case 'PLAN_UPDATED':   applyRemoteUpdate(msg.payload);  break;
    case 'PRESENCE_UPDATE': renderPresence(msg.payload.members); break;
    case 'NOTIFICATION':   addNotification(msg.payload);    break;
    case 'COMMENT_ADDED':  refreshComments(msg.payload);    break;
  }
};

// Subscribe to current plan:
ws.send(JSON.stringify({ type: 'SUBSCRIBE_PLAN', planId: STATE.activePlan.id }));
```

**⚠ Required fixes before launch:**
- Add `maxPayload: 64 * 1024` to `WebSocket.Server` constructor (DoS guard)
- JWT in `?token=` query string is logged by Morgan — use cookie or post-connect auth message instead
- Add per-user connection limit (max 5 open connections per userId)

---

### `public/index.html` — Landing / Marketing Page

**Purpose:** Public-facing marketing site. Converts visitors to registered users. No auth required.

**Wires to:**
- `public/login.html` → all CTAs link to `/login` or `/login?mode=register`
- `public/manifest.json` → `<link rel="manifest">` for PWA discoverability on the landing page
- Google Fonts → Poppins + Inter (display + body)
- External links → pricing page, contact/demo, privacy, terms (all `asilvainnovations.github.io`)

**Key features built in:**
- Scroll-reveal via `IntersectionObserver` (no library)
- Mobile hamburger nav with accessible `aria-expanded` and `Escape` key close
- Open Graph + Twitter card meta tags for social sharing previews
- `<link rel="canonical">` to prevent duplicate indexing
- No Tailwind CDN (removed) — all CSS is native, matches app design tokens
- No Cloudflare challenge script (removed — was auto-injected, must not be committed)

**⚠ Items requiring attention:**
- Replace `https://stratplannerpro.app/` canonical URL with actual production domain
- Add PWA screenshots to `manifest.json` for enhanced install dialog
- Stats ("3× faster", "85% less rework") need attribution or should be softened

---

### `public/login.html` — Authentication Page

**Purpose:** Single page for both sign-in and account creation. The gateway between the public landing page and the protected app.

**Wires to:**
- `POST /api/auth/login` → `handleLogin()`
- `POST /api/auth/register` → `handleRegister()`
- `POST /api/auth/forgot-password` → `showForgotPassword()` (route needs adding to routes.js)
- `public/app/index.html` → redirects to `/app/` on success (or `?redirect=` path)
- `public/index.html` → logo links back to `/`

**URL parameters:**
```
/login                    → shows sign-in tab
/login?mode=register      → shows create account tab (linked from all landing CTAs)
/login?redirect=/app/swot → after login, redirects to /app/swot instead of /app/
```

**Token storage strategy:**
```
On successful login/register:
   sessionStorage.setItem('spp_access_token', accessToken)
   sessionStorage.setItem('spp_refresh_token', refreshToken)
   → redirects to /app/

Every API call from app/index.html must attach:
   Authorization: Bearer ${sessionStorage.getItem('spp_access_token')}
```

**Forms:**
- Sign-in: email + password with show/hide toggle
- Register: firstName + lastName + email + password (strength meter) + terms checkbox
- All inputs have `autocomplete` attributes set correctly
- All errors use `role="alert"` + `aria-live="polite"` for screen readers

---

### `public/app/index.html` — Dashboard SPA Shell

**Purpose:** The full strategic planning application. All SWOT, strategy, scorecard, initiative, CLD, report, team, and admin features live here as JS-rendered pages within a single HTML shell.

**Wires to (currently — before wiring sprint):**
- `public/style.css` → visual design system (inline copy needs removing, link to external file)
- Chart.js CDN → `progressChart` and `swotRadarChart` on dashboard

**Wires to (after wiring sprint — full integration):**
- `GET /api/auth/me` → load authenticated user on app start
- `GET /api/plans` → populate plan selector dropdown
- `GET /api/plans/:id` → hydrate `STATE.activePlan` from DB (replaces hardcoded demo data)
- `POST/PATCH/DELETE /api/plans/:planId/swot` → every `saveSwotItem()`, `deleteSwotItem()`
- `POST/PATCH/DELETE /api/plans/:planId/strategies` → every `saveStrategy()`
- `POST/PATCH/DELETE /api/plans/:planId/kpis` → every `saveKPI()`
- `POST/PATCH/DELETE /api/plans/:planId/initiatives` → every `saveInitiative()`, `updateInitiative()`
- `POST /api/plans/:planId/comments` → `addComment()`
- `GET /api/notifications` → `initNotifications()`
- `POST /api/orgs/:id/invite` → `sendInvite()`
- `POST /api/plans/:id/share` → `sharePlan()`
- `GET /api/admin/stats` → `initAdmin()`
- `POST /api/ai/swot` → `generateSwotAI()` (replaces direct Anthropic call)
- `POST /api/ai/strategy` → `generateStrategyAI()` (replaces direct Anthropic call)
- `WebSocket /ws` → real-time presence + live plan updates

**State management pattern (current → target):**
```
CURRENT (broken):
   STATE object in JS memory
   All mutations update STATE only
   Page refresh loses all data

TARGET (after wiring):
   App load:
      GET /api/auth/me         → STATE.currentUser = data.user
      GET /api/plans/:id       → STATE.activePlan  = data (from DB)

   Each mutation:
      fetch(API + endpoint, { body: JSON.stringify(data) })
         → on success: update STATE + re-render
         → on failure: show error toast, do NOT update STATE

   Offline (via sw.js):
      Mutation queued in IndexedDB pending-changes store
      Background sync fires POST /api/sync when back online
```

**Navigation architecture:**
```
navigate(page)
   ├─ Hides all .page elements
   ├─ Shows #page-{name}
   ├─ Marks nav-item active
   └─ Calls initPage(name) which calls:
        'dashboard'       → initDashboard()      → fetch /api/plans/:id + render charts
        'swot'            → initSwot()            → fetch /api/plans/:planId/swot
        'strategy-matrix' → initStrategyMatrix()  → fetch /api/plans/:planId/strategies
        'scorecard'       → initScorecard()       → fetch /api/plans/:planId/kpis
        'initiatives'     → initInitiatives()     → fetch /api/plans/:planId/initiatives
        'templates'       → initTemplates()       → fetch /api/templates
        'team'            → initTeam()            → fetch /api/orgs + members
        'activity'        → initActivity()        → fetch /api/plans/:planId/activity
        'admin'           → initAdmin()           → fetch /api/admin/stats + users
```

**⚠ Items required before launch:**
- Remove all hardcoded `STATE.activePlan` demo data
- Replace every `STATE.*` mutation with a `fetch()` call
- Add `Authorization: Bearer <token>` header to every fetch
- Add token refresh logic (intercept 401, call `/api/auth/refresh`, retry)
- Add DOMPurify sanitisation to all `innerHTML` template literal assignments
- Consolidate: remove inline `<style>` block, link `<link rel="stylesheet" href="/style.css">`
- Add `navigator.serviceWorker.register('/sw.js', { scope: '/app/' })`
- Add hamburger button to mobile top bar (CSS already handles it)

---

### `public/sw.js` — Service Worker

**Purpose:** Offline-first PWA layer. Intercepts all fetch requests, manages caching strategy, handles background sync of offline mutations, and delivers push notifications.

**Wires to:**
- `public/app/index.html` → must be registered via `navigator.serviceWorker.register('/sw.js', { scope: '/app/' })`
- `POST /api/sync` → background sync sends queued offline changes to server
- Push notification server (not yet implemented) → `push` event handler ready

**Cache strategy:**
```
Static assets (cache-first):
   /app/index.html, /manifest.json, Chart.js CDN
   → Check cache first → serve immediately
   → Fetch in background → update cache

API calls (network-first):
   Currently intercepts api.anthropic.com  ⚠ Must be changed to /api/* after AI proxy is added
   → Fetch → cache response
   → On network failure → serve cache
```

**Offline mutation queue:**
```
User makes change while offline
   → app/index.html queues to IndexedDB 'pending-changes' store

Connection restored
   → BackgroundSync fires 'sync-plans' tag
   → sw.js syncPlans() reads IndexedDB
   → Sends each change to POST /api/sync
   → On success: deletes from IndexedDB
   → Posts SYNC_COMPLETE to all clients

   ⚠ Current bug: fetch('/api/sync') has no Authorization header → always 401
   Fix: store token in IndexedDB alongside pending changes:
        fetch('/api/sync', { headers: { Authorization: `Bearer ${token}` }, ... })
```

**⚠ Required fixes before launch:**
- Register from app/index.html: `navigator.serviceWorker.register('/sw.js', { scope: '/app/' })`
- Change cache intercept from `api.anthropic.com` to `/api/*` (AI calls will move server-side)
- Add `Authorization` header to `syncPlans()` fetch
- Cache Google Fonts with stale-while-revalidate strategy
- Remove unused `plans` IndexedDB object store (placeholder — never written to)

---

### `public/manifest.json` — PWA Install Manifest

**Purpose:** Enables "Add to Home Screen" / PWA install on Android, iOS, and desktop browsers.

**Wires to:**
- `public/index.html` → `<link rel="manifest" href="/manifest.json">`
- `public/app/index.html` → needs `<link rel="manifest" href="/manifest.json">` added
- `server.js` → served at `GET /manifest.json` with 1hr cache header
- `public/icons/` → icon files referenced by `src` properties

**⚠ Required fixes before launch:**
- Change `"start_url": "/"` → `"start_url": "/app/"` (currently launches landing page, not app)
- Move icon URLs from external CDN (`appimize.app`) to local `/icons/icon-192.png` and `/icons/icon-512.png`
- Generate a proper 192×192 icon (currently uses the same 512px source for both slots)
- Verify maskable icon has content within inner 80% safe zone
- Add `"screenshots": []` with 2 desktop + 2 mobile PNGs for enhanced install dialog

---

### `public/style.css` — Shared Design System

**Purpose:** All visual design tokens, component styles, animations, and utility classes. Shared between `home.html`, `login.html`, and `app/index.html`.

**Wires to:**
- `public/app/index.html` → currently duplicated as inline `<style>` block ⚠ must be linked as external stylesheet
- `public/login.html` → has its own inline styles (tokens are reconciled but separate)
- `public/index.html` → has its own inline styles (tokens are reconciled but separate)

**Design token coverage:**
```css
/* Colour system */
--blue-950 through --blue-50   (12 stops)
--cyan-500, --sky-500, --indigo-500, --indigo-400

/* Glass morphism */
--glass-bg, --glass-bg-hover, --glass-bg-active
--glass-border, --glass-border-strong
--glass-shadow, --glass-shadow-sm, --glass-inset

/* Typography */
--font-display: 'Poppins'
--font-ui:      'Inter'
--font-data:    'Roboto Condensed'

/* Layout */
--sidebar-width: 280px
--header-height: 64px
--radius-sm through --radius-full

/* Status */
--success: #10B981
--warning: #F59E0B
--danger:  #EF4444
```

**⚠ Required fixes before launch:**
- Add `@media (prefers-reduced-motion: reduce) { ... }` block to disable all 6 animations
- Add `:focus-visible` styles to `.nav-item`, `.glass-btn`, `.btn-primary`, `.tab`, `.swot-item`
- Abstract `backdrop-filter` values into CSS variables for performance tuning
- Remove inline `<style>` from `app/index.html` and link this file externally

---

### `.env.example` — Environment Variable Template

**Purpose:** Documents every required environment variable. The only env-related file that is committed to git.

```bash
# ── Server ──────────────────────────────────────────
PORT=4000
HOST=0.0.0.0
NODE_ENV=development          # development | production

# ── Security ────────────────────────────────────────
# REQUIRED: Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=
JWT_EXPIRES_IN=15m            # Recommended: 15m (not 7d)
JWT_REFRESH_EXPIRES_IN=30d
BCRYPT_ROUNDS=12

# ── Database ─────────────────────────────────────────
DB_PATH=./data

# ── Admin seed ───────────────────────────────────────
# REQUIRED in production — no fallback
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=

# ── CORS ─────────────────────────────────────────────
CORS_ORIGINS=http://localhost:3000,http://localhost:4000

# ── Rate limiting ────────────────────────────────────
RATE_LIMIT_WINDOW_MS=900000   # 15 minutes
RATE_LIMIT_MAX=100
AUTH_RATE_LIMIT_MAX=10

# ── Email (SMTP) ─────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
EMAIL_FROM_NAME=Strat Planner Pro
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
FRONTEND_URL=http://localhost:4000

# ── File uploads ─────────────────────────────────────
UPLOAD_PATH=./uploads

# ── AI proxy ─────────────────────────────────────────
# Server-side only — NEVER expose to client
ANTHROPIC_API_KEY=

# ── WebSocket ────────────────────────────────────────
WS_HEARTBEAT_INTERVAL=30000
```

---

### `package.json` — Project Manifest

**Purpose:** Declares runtime dependencies, dev scripts, and Node version constraint.

**Scripts:**
```json
"start":    "node server.js"                    ← production
"dev":      "node --watch server.js"            ← development (Node 18+)
"seed":     "node scripts/seed.js"              ← manual DB seed
"db:reset": "node scripts/reset-db.js"          ← wipe data/ (dev only)
```

**⚠ Scripts to add:**
```json
"lint":   "eslint src/ public/app/",
"test":   "node --test tests/",
"check":  "npm run lint && npm test",
"build":  "echo 'No build step — static HTML'"
```

**Production dependencies (all used):**

| Package | Used in | Purpose |
|---------|---------|---------|
| `bcryptjs` | auth.js | Password hashing (cost 12) |
| `compression` | server.js | Gzip HTTP responses |
| `cors` | server.js | Cross-origin request handling |
| `dotenv` | server.js | Load .env into process.env |
| `express` | server.js, routes.js | HTTP framework |
| `express-rate-limit` | server.js | Abuse prevention |
| `express-validator` | routes.js | Input validation |
| `helmet` | server.js | Secure HTTP headers |
| `jsonwebtoken` | auth.js | JWT sign + verify |
| `morgan` | server.js | HTTP access logging |
| `multer` | ⚠ unused — no upload route | Remove or implement |
| `nedb-promises` | db.js | Embedded file-backed database |
| `nodemailer` | email.js | SMTP email delivery |
| `uuid` | auth.js, routes.js | Refresh token + invite token generation |
| `ws` | ws.js | WebSocket server |

**To add:**
```json
"cookie-parser": "^1.4.6"    ← required for requireAuthPage cookie check in server.js
```

---

## Data Flow Diagrams

### 1. First-time user flow (registration to dashboard)

```
Browser → GET /
   └─ server.js → public/index.html

User clicks "Get Started Free"
   └─ Browser → GET /login?mode=register
        └─ server.js → public/login.html (register tab pre-selected)

User fills form → clicks "Create Account"
   └─ login.html → POST /api/auth/register { firstName, lastName, email, password }
        │
        ├─ routes.js validates inputs (express-validator)
        ├─ db.users.insert() → users.db
        ├─ auth.createAccessToken() → JWT (15min)
        ├─ auth.createRefreshToken() → refresh_tokens.db
        ├─ email.sendWelcomeEmail() → SMTP (fire-and-forget)
        ├─ helpers.logActivity() → activity_log.db
        └─ res.json({ user, accessToken, refreshToken })

login.html:
   ├─ sessionStorage.setItem('spp_access_token', ...)
   └─ window.location.href = '/app/'

Browser → GET /app/
   └─ server.js requireAuthPage()
        ├─ verifyAccessToken(cookieToken or header)   ← valid → serve app
        └─ app/index.html loads

app/index.html DOMContentLoaded:
   ├─ GET /api/auth/me       → populate STATE.currentUser
   ├─ GET /api/plans         → populate plan selector
   └─ GET /api/plans/:id     → hydrate STATE.activePlan from DB
```

### 2. Real-time collaboration flow

```
User A edits SWOT item in app/index.html
   │
   ├─ saveSwotItem() → PATCH /api/plans/:planId/swot/:id
   │    └─ routes.js → db.swotItems.update()
   │                 → ws.broadcastPlanUpdate(planId, 'PLAN_UPDATED', { section:'swot', action:'update', item })
   │
   └─ WebSocket server (ws.js)
        └─ rooms.get(planId)  →  forEach subscriber ws (excluding User A's ws)
             └─ send({ type: 'PLAN_UPDATED', payload: { section:'swot', action:'update', item } })

User B (same plan, different browser):
   └─ ws.onmessage → applyRemoteUpdate({ section:'swot', action:'update', item })
        └─ finds item in STATE.activePlan.swot by id
        └─ updates in place → re-renders swot quadrant
```

### 3. Offline mutation flow

```
User offline → edits SWOT item
   │
   ├─ app/index.html: fetch() fails (no network)
   ├─ Queue change: indexedDB.open('strat-planner-db')
   │    └─ store.add({ type:'swot', operation:'upsert', planId, data: item, timestamp: Date.now() })
   └─ Show "Saved offline" indicator

Connection restored:
   ├─ BackgroundSync API fires → sw.js 'sync' event tag='sync-plans'
   ├─ sw.js syncPlans():
   │    ├─ idb.getAll('pending-changes')
   │    ├─ fetch('/api/sync', { method:'POST', headers:{ Authorization: `Bearer ${token}` },
   │    │    body: JSON.stringify({ changes: pendingChanges }) })
   │    │    └─ routes.js /api/sync:
   │    │         ├─ forEach change: last-write-wins conflict resolution
   │    │         ├─ db write
   │    │         └─ ws.broadcastPlanUpdate() to other subscribers
   │    ├─ idb.delete('pending-changes', change.id)
   │    └─ clients.postMessage({ type: 'SYNC_COMPLETE' })
   └─ app/index.html: re-fetch plan data → update STATE → re-render
```

---

## Critical Pre-Launch Checklist

### Security (must fix before any public users)
- [ ] Remove `JWT_SECRET` hardcoded fallback in `auth.js`
- [ ] Remove admin password hardcoded fallback in `db.js`
- [ ] Reduce JWT lifetime from 7d → 15m; add silent refresh in `app/index.html`
- [ ] Add DOMPurify to all `innerHTML` assignments in `app/index.html`
- [ ] Add `POST /api/ai/swot` and `POST /api/ai/strategy` proxy routes; remove direct Anthropic calls from browser
- [ ] Add `data/` and `uploads/` to `.gitignore`

### Functional (must fix for app to work)
- [ ] Wire `app/index.html` login check: `GET /api/auth/me` on load; redirect to `/login` if 401
- [ ] Replace all `STATE.*` demo data with `GET /api/plans/:id` hydration on load
- [ ] Replace all mutation functions with `fetch()` calls to corresponding API endpoints
- [ ] Fix broken `GET /notifications` query in `routes.js`
- [ ] Register service worker: `navigator.serviceWorker.register('/sw.js', { scope: '/app/' })`
- [ ] Add `Authorization` header to `syncPlans()` fetch in `sw.js`
- [ ] Connect WebSocket in `app/index.html` and wire `PLAN_UPDATED` / `PRESENCE_UPDATE` handlers
- [ ] Wire `sendInvite()` → `POST /api/orgs/:id/invite`
- [ ] Add `POST /api/auth/forgot-password` route in `routes.js`
- [ ] Change `manifest.json` `start_url` from `/` to `/app/`
- [ ] Move icon files to `/public/icons/` and update `manifest.json` paths
- [ ] Install `cookie-parser` and add `app.use(cookieParser())` in `server.js`

### Quality (fix before beta launch)
- [ ] Add `prefers-reduced-motion` block to `style.css`
- [ ] Add `:focus-visible` styles for keyboard navigation
- [ ] Remove inline `<style>` from `app/index.html`; link `style.css` externally
- [ ] Add hamburger button HTML to `app/index.html` top bar
- [ ] Add `maxPayload: 64 * 1024` to WebSocket server constructor
- [ ] Fix `uncaughtException` / `unhandledRejection` handlers to call `process.exit(1)`
- [ ] Remove unused `multer` dependency or implement file upload feature
- [ ] Add eslint + `node --test` scripts to `package.json`
- [ ] Add SMTP boot-time validation for production
- [ ] Add `/api/sync` max batch size guard (100 changes max)
