# Strat Planner Pro

> **AI-powered strategic planning for organisations that demand precision and results.**
> Full-stack PWA — structured SWOT diagnostics, systems thinking, AI-generated strategies, balanced scorecard, initiative tracking, and print-ready reports. Works offline.

<br>

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.19-000000?logo=express&logoColor=white)](https://expressjs.com)
[![License](https://img.shields.io/badge/License-MIT-blue)](#license)
[![PWA Ready](https://img.shields.io/badge/PWA-Offline%20Ready-5A0FC8?logo=pwa&logoColor=white)](#pwa--offline-support)
[![Status](https://img.shields.io/badge/Status-Beta-orange)](#)

---

## Table of Contents

1. [Overview](#overview)
2. [Feature Set](#feature-set)
3. [Architecture](#architecture)
4. [Project Structure](#project-structure)
5. [Technology Stack](#technology-stack)
6. [Getting Started](#getting-started)
7. [Environment Variables](#environment-variables)
8. [URL Structure & Routing](#url-structure--routing)
9. [API Reference](#api-reference)
10. [WebSocket Protocol](#websocket-protocol)
11. [Database Schema](#database-schema)
12. [PWA & Offline Support](#pwa--offline-support)
13. [Authentication & Security](#authentication--security)
14. [Email Notifications](#email-notifications)
15. [Real-Time Collaboration](#real-time-collaboration)
16. [Deployment](#deployment)
17. [Configuration Reference](#configuration-reference)
18. [Development Guide](#development-guide)
19. [Known Issues & Roadmap](#known-issues--roadmap)
20. [Contributing](#contributing)
21. [License](#license)

---

## Overview

Strat Planner Pro is a full-stack progressive web application that guides organisations through a complete strategic planning cycle — from environmental diagnosis to execution tracking. It is purpose-built for strategy offices, PMOs, government agencies, educational institutions, and consulting teams that need a structured, collaborative, and auditable planning workflow.

The application integrates:

- A **guided SWOT methodology** with structured forms and AI-assisted generation
- **Systems thinking tools** — causal loop diagrams and systems archetypes — to surface non-linear dynamics
- An **AI strategy generator** that auto-derives SO/ST/WO/WT options from SWOT inputs
- A **balanced scorecard** with four-perspective KPI categorisation and automated alerts
- **Initiative management** (Programs, Activities, Projects) with budget tracking
- **Real-time collaboration** via WebSocket with live presence, concurrent editing, and comment threads
- **Offline-first PWA** with background sync for field work without connectivity
- **Print-ready plan generation** for official documentation

### Live Application

| Environment | URL |
|-------------|-----|
| GitHub Pages (backend docs) | <https://asilvainnovations.github.io/strat-planner-pwa/> |
| Production app (target) | `https://app.stratplannerpro.app` |
| Landing page (target) | `https://stratplannerpro.app` |

---

## Feature Set

### Diagnostics

| Feature | Description |
|---------|-------------|
| **Guided SWOT Analysis** | Structured four-quadrant entry with evidence fields, impact ratings, and completeness prompts |
| **AI SWOT Generator** | Server-side Anthropic API proxy transforms raw context into actionable, bias-aware SWOT statements |
| **Causal Loop Diagrams** | Interactive node-link canvas to map feedback loops across SWOT variables |
| **Systems Archetypes** | Five pre-built archetype templates (Limits to Growth, Shifting the Burden, Escalation, Fixes that Fail, Tragedy of the Commons) with contextual application guidance |

### Strategy Formulation

| Feature | Description |
|---------|-------------|
| **Strategy Matrix** | Four-quadrant SO / ST / WO / WT strategy builder linked to SWOT items |
| **AI Strategy Generator** | Auto-derives strategic options aligned to focus area, time horizon, and SWOT context |
| **Template Library** | 8 built-in industry templates (Government/LGU, Healthcare, Technology, Education) plus user-saved custom templates |

### Execution & Monitoring

| Feature | Description |
|---------|-------------|
| **Balanced Scorecard** | KPI management across Financial, Customer, Internal Process, and Learning & Growth perspectives |
| **KPI Alerts** | Automatic email notification to plan owner when KPI status changes to `at-risk` or `behind` |
| **Initiative Management** | Programs, Activities, and Projects with owner assignment, budget allocation, utilisation tracking, and progress bars |
| **MEL Dashboard** | Monitor-Evaluate-Learn dashboard with execution progress charts and milestone tracking |
| **Report Generator** | Configurable print-ready strategic plan export (Executive Summary, SWOT, Strategy Matrix, Balanced Scorecard, Initiative Plan) |

### Collaboration

| Feature | Description |
|---------|-------------|
| **Real-Time Editing** | WebSocket-powered live updates — changes by one user are immediately reflected for all plan subscribers |
| **Presence Tracking** | Live avatar display showing who is currently viewing or editing a plan |
| **Comment Threads** | Threaded comments on any SWOT item, KPI, initiative, or strategy with resolve workflow |
| **Team Management** | Organisation-level membership with viewer / editor / admin roles |
| **Plan Sharing** | Share individual plans by email with configurable permission levels |
| **Email Invitations** | Time-limited (7-day) invitation tokens sent via SMTP |
| **Activity Log** | Full audit trail of all team actions with user attribution |

### Platform

| Feature | Description |
|---------|-------------|
| **Offline-First PWA** | Service worker caches the app shell; IndexedDB queues mutations; background sync resolves conflicts |
| **Installable** | Add to home screen on Android, iOS, and desktop (Chrome/Edge) |
| **Push Notifications** | Browser push notification support for comments, shares, and KPI alerts |
| **Admin Dashboard** | User management, organisation overview, audit log, and system health metrics |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser / PWA                           │
│                                                                  │
│  ┌─────────────────┐  ┌────────────────┐  ┌────────────────┐   │
│  │  public/         │  │  public/login  │  │  public/app/   │   │
│  │  index.html      │  │  .html         │  │  index.html    │   │
│  │  (Landing page)  │  │  (Auth gate)   │  │  (Dashboard    │   │
│  │  GET /           │  │  GET /login    │  │   SPA shell)   │   │
│  └────────┬─────────┘  └───────┬────────┘  └───────┬────────┘   │
│           │                    │                    │            │
│           │             POST /api/auth/*    fetch /api/*         │
│           │                    │            ws:// /ws            │
└───────────┼────────────────────┼────────────────────┼────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express HTTP Server (server.js)               │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ helmet   │  │  cors    │  │  morgan  │  │  rate-limit    │  │
│  │ headers  │  │ origins  │  │  logs    │  │  100/15min     │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  requireAuthPage middleware                              │    │
│  │  GET /app/* → verify JWT cookie/header → 302 /login     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────┐  ┌──────────────────────────┐     │
│  │   REST API (routes.js)   │  │  WebSocket (ws.js)       │     │
│  │   /api/*                 │  │  /ws                     │     │
│  └──────────────────────────┘  └──────────────────────────┘     │
│                    │                        │                    │
│            ┌───────┴────────┐      ┌────────┴────────┐          │
│            │   auth.js      │      │   rooms Map     │          │
│            │   JWT + bcrypt │      │   presence      │          │
│            └───────┬────────┘      └─────────────────┘          │
│                    │                                             │
│            ┌───────┴────────┐                                   │
│            │    db.js       │      ┌─────────────────┐          │
│            │   15 NeDB      │      │   email.js      │          │
│            │   collections  │      │   SMTP + 7      │          │
│            └───────┬────────┘      │   templates     │          │
│                    │               └─────────────────┘          │
└────────────────────┼────────────────────────────────────────────┘
                     │
            ┌────────┴────────┐
            │   data/         │
            │   *.db files    │  ← NeDB flat files (gitignored)
            └─────────────────┘
```

### Request lifecycle

```
1. Browser → GET /app/dashboard
2. server.js requireAuthPage() checks JWT cookie or header
3. Valid → serve public/app/index.html
4. No token → 302 → /login?redirect=/app/dashboard

5. app/index.html loads:
   a. GET /api/auth/me        → populate currentUser
   b. GET /api/plans/:id      → hydrate plan state from DB
   c. ws://host/ws?token=…    → subscribe to plan room

6. User edits SWOT item:
   a. fetch POST /api/plans/:planId/swot
   b. requireAuth validates JWT → sets req.user
   c. express-validator validates inputs
   d. db.swotItems.insert() → swot_items.db
   e. helpers.logActivity() → activity_log.db
   f. ws.broadcastPlanUpdate() → all room subscribers
   g. 201 { item } → app updates STATE + re-renders

7. Other users in same plan receive WS PLAN_UPDATED → re-render
```

---

## Project Structure

```
strat-planner-pro/
│
├── server.js                   # Entry point: Express + HTTP + middleware + routing
├── package.json                # Dependencies, scripts, engines (Node 18+)
├── .env.example                # Required env vars template (committed)
├── .env                        # Live secrets          ← gitignored
│
├── src/                        # Back-end source modules
│   ├── auth.js                 # bcrypt hashing, JWT sign/verify, requireAuth middleware
│   ├── db.js                   # NeDB collections (15), indexes, helpers, seed function
│   ├── routes.js               # All REST API handlers (~45 endpoints)
│   ├── email.js                # Nodemailer SMTP, 7 HTML email templates
│   └── ws.js                   # WebSocket server: rooms, presence, heartbeat, broadcast
│
├── public/                     # Static files served by Express
│   ├── index.html              # Marketing landing page         → GET /
│   ├── login.html              # Sign-in + register             → GET /login
│   ├── sw.js                   # Service worker (offline, sync) → GET /sw.js
│   ├── manifest.json           # PWA install manifest           → GET /manifest.json
│   ├── style.css               # Shared design system & tokens
│   │
│   ├── icons/                  # Local PWA icons (not external CDN)
│   │   ├── icon-192.png
│   │   └── icon-512.png
│   │
│   └── app/
│       └── index.html          # Dashboard SPA shell            → GET /app/*
│
├── data/                       # NeDB flat-file databases       ← gitignored
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
├── uploads/                    # User file uploads              ← gitignored
│
└── scripts/
    ├── seed.js                 # Manual DB seed runner
    └── reset-db.js             # ⚠ Wipe + reseed (dev only)
```

---

## Technology Stack

### Back-end

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Node.js | 18+ | JavaScript server runtime |
| HTTP Framework | Express | 4.19 | Routing, middleware, static serving |
| Database | NeDB (nedb-promises) | 6.2 | Embedded file-backed document store |
| Authentication | jsonwebtoken | 9.0 | JWT access token sign + verify |
| Password hashing | bcryptjs | 2.4 | Cost-12 bcrypt (pure JS, no native deps) |
| Real-time | ws | 8.18 | WebSocket server (plan rooms, presence) |
| Email | nodemailer | 6.9 | SMTP transactional email |
| Validation | express-validator | 7.2 | Request body + param validation |
| Security headers | helmet | 7.1 | XSS, HSTS, CSP, clickjacking protection |
| CORS | cors | 2.8 | Cross-origin allow-list enforcement |
| Rate limiting | express-rate-limit | 7.3 | Brute-force + abuse prevention |
| Compression | compression | 1.7 | Gzip HTTP responses |
| HTTP logging | morgan | 1.10 | Access log (dev: colorised, prod: combined) |
| Unique IDs | uuid | 10.0 | Invite tokens, refresh tokens |
| Environment | dotenv | 16.4 | `.env` → `process.env` |

### Front-end

| Layer | Technology | Purpose |
|-------|-----------|---------|
| App shell | Vanilla HTML/CSS/JS | Zero-framework SPA |
| Charts | Chart.js 4.4 | Dashboard progress + radar charts |
| Design system | Custom CSS (tokens) | Glass morphism, animations, responsive grid |
| Fonts | Poppins + Inter + Roboto Condensed | Display, UI, and data typography |
| PWA | Service Worker + IndexedDB | Offline support, background sync, push |
| Real-time | Native WebSocket API | Live plan updates, presence |

---

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- npm 9+
- An SMTP account (Gmail, SendGrid, Mailgun, or similar) for email features

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/asilvainnovations/strat-planner-pwa.git
cd strat-planner-pwa

# 2. Install dependencies
npm install

# 3. Install cookie-parser (required for auth-gate middleware)
npm install cookie-parser

# 4. Configure environment
cp .env.example .env
```

Open `.env` and set the required values (see [Environment Variables](#environment-variables)):

```bash
# Minimum required for local development
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=<strong-password>
```

```bash
# 5. Start in development mode (file-watch enabled)
npm run dev

# The server starts at http://localhost:4000
# Pages available:
#   http://localhost:4000/          → landing page
#   http://localhost:4000/login     → sign in / register
#   http://localhost:4000/app/      → dashboard (requires login)
#   http://localhost:4000/api/health → API health check
```

### First run

On first start, `db.js` automatically:

1. Creates the `data/` directory and all 15 `.db` files
2. Ensures all indexes (unique email, planId, userId foreign keys)
3. Seeds one admin user using `ADMIN_EMAIL` + `ADMIN_PASSWORD` from `.env`
4. Seeds 5 built-in industry templates (LGU, Hospital, Tech Startup, HEI, Digital Transformation)

Sign in at `/login` with your admin credentials to access the full application.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all required values. Variables marked **required** will cause the server to refuse to start in production if absent.

### Server

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | `4000` | No | HTTP server port |
| `HOST` | `0.0.0.0` | No | Bind address |
| `NODE_ENV` | `development` | No | `development` or `production` |

### Security — ⚠ Required before production

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `JWT_SECRET` | *(none)* | **Yes** | Min 64-char random string. Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `JWT_EXPIRES_IN` | `15m` | No | Access token lifetime. **Use `15m` in production.** |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | No | Refresh token lifetime |
| `BCRYPT_ROUNDS` | `12` | No | Password hash cost. Do not reduce below 12. |

### Database

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DB_PATH` | `./data` | No | Directory for NeDB `.db` files |
| `ADMIN_EMAIL` | *(none)* | **Yes** | Seeded admin account email |
| `ADMIN_PASSWORD` | *(none)* | **Yes** | Seeded admin account password (min 12 chars recommended) |

### CORS & Rate Limiting

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `CORS_ORIGINS` | `http://localhost:4000` | No | Comma-separated list of allowed origins |
| `RATE_LIMIT_WINDOW_MS` | `900000` | No | Rate limit window (ms). Default: 15 minutes |
| `RATE_LIMIT_MAX` | `100` | No | Max requests per window (global API) |
| `AUTH_RATE_LIMIT_MAX` | `10` | No | Max requests per window (auth endpoints) |

### Email (SMTP)

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `SMTP_HOST` | `smtp.gmail.com` | **Yes (prod)** | SMTP server hostname |
| `SMTP_PORT` | `587` | No | SMTP port (587 = STARTTLS, 465 = SSL) |
| `SMTP_SECURE` | `false` | No | `true` for port 465 |
| `SMTP_USER` | *(none)* | **Yes (prod)** | SMTP username / email address |
| `SMTP_PASS` | *(none)* | **Yes (prod)** | SMTP password or app password |
| `EMAIL_FROM_NAME` | `Strat Planner Pro` | No | Sender display name |
| `EMAIL_FROM_ADDRESS` | `noreply@strat-planner.app` | No | Sender email address |
| `FRONTEND_URL` | `http://localhost:4000` | No | Base URL used in email links |

> **Gmail users:** Enable 2FA and use an [App Password](https://support.google.com/accounts/answer/185833) rather than your account password.

### AI Proxy

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `ANTHROPIC_API_KEY` | *(none)* | **Yes (for AI features)** | Server-side only. Never expose to client. |

### File Uploads & WebSocket

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `UPLOAD_PATH` | `./uploads` | No | Directory for user-uploaded files |
| `WS_HEARTBEAT_INTERVAL` | `30000` | No | WebSocket ping interval (ms) |

---

## URL Structure & Routing

```
GET  /                    → public/index.html   (landing page, public)
GET  /login               → public/login.html   (auth, public; skips to /app/ if cookie valid)
GET  /login?mode=register → public/login.html   (register tab pre-selected)
GET  /login?redirect=...  → public/login.html   (redirect to path after auth)
GET  /app                 → public/app/index.html  ← auth-gated
GET  /app/*               → public/app/index.html  ← auth-gated (SPA fallback)
GET  /sw.js               → public/sw.js        (Service-Worker-Allowed: / header set)
GET  /manifest.json       → public/manifest.json
GET  /icons/*             → public/icons/
/api/*                    → routes.js REST API
/uploads/*                → static file serving
/ws                       → WebSocket upgrade
```

### Auth gate behaviour

When a browser navigates to `/app/*` without a valid JWT:

```
No token or expired token
  └─ Accept: text/html  → 302 redirect → /login?redirect=/app/original-path
  └─ Accept: application/json → 401 { error: 'Authentication required' }
```

Token is checked from (in order):
1. `Authorization: Bearer <token>` header
2. `spp_access_token` httpOnly cookie

---

## API Reference

All API endpoints are prefixed with `/api`. Protected routes require:

```
Authorization: Bearer <accessToken>
```

### Health Check

```
GET /api/health
```

```json
{
  "status": "ok",
  "service": "Strat Planner Pro API",
  "version": "1.0.0",
  "time": "2025-06-15T10:00:00.000Z",
  "uptime": 3600.5
}
```

---

### Authentication

#### `POST /api/auth/register`

```json
{
  "email": "maria@example.com",
  "password": "SecurePass123!",
  "firstName": "Maria",
  "lastName": "Santos"
}
```

**Response `201`:**

```json
{
  "user": {
    "_id": "abc123",
    "email": "maria@example.com",
    "firstName": "Maria",
    "lastName": "Santos",
    "role": "user",
    "initials": "MS",
    "isActive": true
  },
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "uuid4-uuid4-..."
}
```

Also sends: welcome email to `email`.

---

#### `POST /api/auth/login`

```json
{ "email": "maria@example.com", "password": "SecurePass123!" }
```

**Response `200`:** Same shape as register.

**Errors:** `401` invalid credentials · `403` account deactivated

---

#### `POST /api/auth/refresh`

```json
{ "refreshToken": "uuid4-uuid4-..." }
```

**Response `200`:**

```json
{ "accessToken": "eyJ...", "refreshToken": "new-uuid4-..." }
```

Old refresh token is invalidated. Implements one-time-use rotation.

---

#### `POST /api/auth/logout` 🔒

```json
{ "refreshToken": "uuid4-uuid4-..." }
```

---

#### `GET /api/auth/me` 🔒

Returns the currently authenticated user object (without password hash).

---

#### `PATCH /api/auth/me` 🔒

```json
{ "firstName": "Maria", "lastName": "Santos-Cruz" }
```

---

#### `POST /api/auth/change-password` 🔒

```json
{ "currentPassword": "old", "newPassword": "NewSecure456!" }
```

Revokes all existing refresh tokens on success.

---

#### `POST /api/auth/forgot-password`

```json
{ "email": "maria@example.com" }
```

Sends password reset email with 1-hour expiry link.

---

### Organisations

#### `GET /api/orgs` 🔒

Returns all organisations the authenticated user belongs to.

---

#### `POST /api/orgs` 🔒

```json
{ "name": "ASSILVA Innovations, Inc.", "type": "Corporation", "description": "..." }
```

Creator is automatically added as `admin` member.

---

#### `GET /api/orgs/:id/members` 🔒

Requires org membership. Returns members array with user details and roles.

---

#### `POST /api/orgs/:id/invite` 🔒

Requires `editor` or `admin` org role.

```json
{
  "email": "colleague@example.com",
  "role": "editor",
  "message": "Join our planning workspace"
}
```

Sends email invitation with 7-day expiry token.

---

#### `POST /api/orgs/accept-invite` 🔒

```json
{ "token": "uuid-from-email-link" }
```

---

### Plans

#### `GET /api/plans` 🔒

```json
{
  "owned": [ { "_id": "...", "name": "Q2 2025 Strategy", ... } ],
  "shared": [ { "_id": "...", "name": "Annual Plan 2026", ... } ]
}
```

---

#### `POST /api/plans` 🔒

```json
{
  "name": "Q2 2025 Corporate Strategy",
  "period": "January – June 2025",
  "orgId": "org-id",
  "description": "...",
  "templateId": "optional-template-id"
}
```

When `templateId` is provided, SWOT items, strategies, KPIs, and initiatives from the template are pre-seeded into the new plan.

---

#### `GET /api/plans/:id` 🔒

Returns the full plan with all nested sections:

```json
{
  "plan": { "_id": "...", "name": "..." },
  "role": "admin",
  "swotItems": [...],
  "strategies": [...],
  "kpis": [...],
  "initiatives": [...],
  "comments": [...],
  "members": [...]
}
```

---

#### `PATCH /api/plans/:id` 🔒

Requires `editor` or `admin` role. Updatable fields: `name`, `period`, `description`, `orgId`.

Broadcasts `PLAN_UPDATED` to all WebSocket subscribers.

---

#### `DELETE /api/plans/:id` 🔒

Owner only. Soft-delete (`isDeleted: true`).

---

#### `POST /api/plans/:id/share` 🔒

Requires `editor` or `admin` role.

```json
{ "email": "viewer@example.com", "permission": "viewer" }
```

`permission`: `viewer | editor | admin`

Sends share notification email and WebSocket push to target user if online.

---

### SWOT Items

```
GET    /api/plans/:planId/swot
POST   /api/plans/:planId/swot
PATCH  /api/plans/:planId/swot/:id
DELETE /api/plans/:planId/swot/:id
```

#### Add item

```json
{
  "category": "strengths",
  "text": "Strong brand recognition in Southeast Asian markets",
  "evidence": "Brand tracking study Q1 2025",
  "impact": "high"
}
```

`category`: `strengths | weaknesses | opportunities | threats`
`impact`: `high | medium | low`

Each write: logs to activity_log, broadcasts `PLAN_UPDATED { section: 'swot' }` via WebSocket.

---

### Strategies

```
GET    /api/plans/:planId/strategies
POST   /api/plans/:planId/strategies
PATCH  /api/plans/:planId/strategies/:id
DELETE /api/plans/:planId/strategies/:id
```

```json
{
  "type": "so",
  "text": "Leverage brand strength to capture government digitalization contracts",
  "priority": "high"
}
```

`type`: `so | st | wo | wt`
`priority`: `high | medium | low`

---

### KPIs (Balanced Scorecard)

```
GET    /api/plans/:planId/kpis
POST   /api/plans/:planId/kpis
PATCH  /api/plans/:planId/kpis/:id
DELETE /api/plans/:planId/kpis/:id
```

```json
{
  "perspective": "financial",
  "kpi": "Revenue Growth",
  "target": "15%",
  "actual": "12%",
  "unit": "%",
  "status": "at-risk",
  "weight": 0.3
}
```

`perspective`: `financial | customer | internal | learning`
`status`: `on-track | at-risk | behind | complete`

> **KPI alert trigger:** When `PATCH` sets `status` to `behind` or `at-risk`, the plan owner automatically receives an email alert.

---

### Initiatives

```
GET    /api/plans/:planId/initiatives
POST   /api/plans/:planId/initiatives
PATCH  /api/plans/:planId/initiatives/:id
DELETE /api/plans/:planId/initiatives/:id
```

`GET` response includes computed budget totals:

```json
{
  "items": [...],
  "totalBudget": 48200000,
  "totalUtilized": 34700000,
  "remaining": 13500000
}
```

```json
{
  "name": "Digital Transformation Program",
  "type": "program",
  "owner": "CTO Office",
  "budget": 12000000,
  "utilized": 8400000,
  "progress": 70,
  "status": "on-track",
  "dueDate": "2025-12-31"
}
```

`type`: `program | activity | project`
`status`: `on-track | at-risk | behind | complete`

---

### Comments

```
GET    /api/plans/:planId/comments?entityId=<id>
POST   /api/plans/:planId/comments
PATCH  /api/plans/:planId/comments/:id/resolve
DELETE /api/plans/:planId/comments/:id
```

```json
{
  "entityId": "swot-item-id",
  "entityType": "swot",
  "entityName": "Strong brand recognition...",
  "text": "Should we quantify this with market share data?"
}
```

On `POST`: notifies plan owner via WebSocket push and email (if owner is not the commenter).
On `resolve`: notifies comment author via email.

---

### Notifications

```
GET   /api/notifications          → { items: [...], unread: 3 }
PATCH /api/notifications/read-all
PATCH /api/notifications/:id/read
```

---

### Activity Log

```
GET /api/plans/:planId/activity
```

Returns up to 100 most recent activity entries for the plan, sorted descending.

---

### Templates

#### `GET /api/templates?industry=government`

Returns `{ public: [...], my: [...] }`. Public templates are accessible without authentication (`optionalAuth`).

`industry` filter: `government | healthcare | technology | education | finance`

---

#### `POST /api/templates` 🔒

```json
{
  "name": "My Custom Template",
  "industry": "technology",
  "description": "...",
  "planId": "optional-source-plan-id",
  "isPublic": false
}
```

When `planId` is provided, the template is created by cloning the SWOT items, strategies, KPIs, and initiatives from that plan.

---

#### `DELETE /api/templates/:id` 🔒

Owner or `super_admin` only.

---

### Offline Sync

#### `POST /api/sync` 🔒

Accepts a batch of offline-queued mutations. Uses last-write-wins conflict resolution based on client-supplied timestamps.

```json
{
  "changes": [
    {
      "clientId": "local-uuid-1",
      "type": "swot",
      "operation": "upsert",
      "planId": "plan-id",
      "timestamp": 1718000000000,
      "data": {
        "_id": "existing-server-id",
        "category": "strengths",
        "text": "Updated while offline"
      }
    },
    {
      "clientId": "local-uuid-2",
      "type": "kpi",
      "operation": "delete",
      "planId": "plan-id",
      "data": { "_id": "kpi-id-to-delete" }
    }
  ]
}
```

`type`: `swot | strategy | kpi | initiative`
`operation`: `upsert | delete`

**Response:**

```json
{
  "results": [
    { "id": "local-uuid-1", "status": "applied", "serverId": "server-id-abc" },
    { "id": "local-uuid-2", "status": "conflict", "serverData": { ... } }
  ],
  "syncedAt": "2025-06-15T10:00:00.000Z"
}
```

`status`: `applied | conflict | rejected | error`

**Maximum batch size:** 100 changes per request.

---

### Admin Routes 🔒👑

All admin routes require `role: super_admin`. Accessible in the app at `/app/` → Admin Dashboard.

```
GET    /api/admin/stats
GET    /api/admin/users?page=1&limit=20
PATCH  /api/admin/users/:id     → { role, isActive }
DELETE /api/admin/users/:id     → soft-deactivate + revoke all tokens
GET    /api/admin/audit-log     → last 200 entries
GET    /api/admin/plans         → all non-deleted plans
```

`GET /api/admin/stats` response includes live WebSocket connection count, active room breakdown, server uptime, and memory usage.

---

## WebSocket Protocol

Connect to:

```
wss://yourdomain.com/ws?token=<accessToken>
```

Or with `Authorization` header (for environments that support WS headers):

```
Authorization: Bearer <accessToken>
```

Connections without a valid JWT are closed immediately with code `4001` (no token) or `4002` (invalid token).

### Client → Server messages

```json
{ "type": "SUBSCRIBE_PLAN",   "planId": "plan-id" }
{ "type": "UNSUBSCRIBE_PLAN", "planId": "plan-id" }
{ "type": "CURSOR_MOVE",      "planId": "plan-id", "payload": { "section": "swot" } }
{ "type": "PING" }
```

### Server → Client messages

| Type | When sent | Payload |
|------|-----------|---------|
| `CONNECTED` | On successful connection | `{ userId, name }` |
| `PRESENCE_UPDATE` | User joins/leaves plan room | `{ members: [{ userId, userName, initials, color }] }` |
| `PLAN_UPDATED` | After any API mutation | `{ section, action, item/id, userName }` |
| `COMMENT_ADDED` | New comment posted | `{ comment }` |
| `CURSOR_UPDATE` | Cursor move broadcast | `{ userId, userName, section }` |
| `NOTIFICATION` | Share, comment, KPI alert | `{ type, message, planId }` |
| `PONG` | In response to `PING` | *(empty)* |

### Front-end connection example

```javascript
const token = sessionStorage.getItem('spp_access_token');
const socket = new WebSocket(`wss://${location.host}/ws?token=${token}`);

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({
    type: 'SUBSCRIBE_PLAN',
    planId: currentPlanId
  }));
});

socket.addEventListener('message', ({ data }) => {
  const msg = JSON.parse(data);
  switch (msg.type) {
    case 'PLAN_UPDATED':
      applyRemoteUpdate(msg.payload);
      break;
    case 'PRESENCE_UPDATE':
      renderPresenceAvatars(msg.payload.members);
      break;
    case 'NOTIFICATION':
      showNotificationToast(msg.payload);
      break;
    case 'COMMENT_ADDED':
      refreshCommentThread(msg.payload.comment.entityId);
      break;
  }
});
```

---

## Database Schema

All collections use NeDB's auto-generated `_id` and `createdAt`/`updatedAt` (via `timestampData: true`). Fields marked with `*` are indexed.

### `users`

| Field | Type | Notes |
|-------|------|-------|
| `_id` | string | Auto-generated |
| `email*` | string | Unique index, lowercased |
| `password` | string | bcrypt hash — never returned to client |
| `firstName` | string | |
| `lastName` | string | |
| `role` | enum | `user \| super_admin` |
| `initials` | string | e.g. `MS` |
| `color` | string | CSS gradient for avatar |
| `isActive` | boolean | `false` = soft-deleted |
| `emailVerified` | boolean | |

### `organizations`

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | |
| `type` | string | Corporation, Government, etc. |
| `ownerId` | string | References `users._id` |
| `description` | string | |

### `org_members`

| Field | Type | Notes |
|-------|------|-------|
| `orgId*` | string | References `organizations._id` |
| `userId*` | string | References `users._id` |
| `role` | enum | `viewer \| editor \| admin` |
| `invitedBy` | string | References `users._id` |

### `plans`

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | |
| `orgId*` | string | References `organizations._id` |
| `ownerId*` | string | References `users._id` |
| `period` | string | e.g. `January – June 2025` |
| `description` | string | |
| `isDeleted` | boolean | Soft-delete flag |

### `plan_members`

| Field | Type | Notes |
|-------|------|-------|
| `planId*` | string | |
| `userId*` | string | |
| `role` | enum | `viewer \| editor \| admin` |
| `sharedBy` | string | |

### `swot_items`

| Field | Type | Notes |
|-------|------|-------|
| `planId*` | string | |
| `category` | enum | `strengths \| weaknesses \| opportunities \| threats` |
| `text` | string | |
| `evidence` | string | Supporting data |
| `impact` | enum | `high \| medium \| low` |
| `ownerId` | string | |
| `isDeleted` | boolean | |

### `strategies`

| Field | Type | Notes |
|-------|------|-------|
| `planId*` | string | |
| `type` | enum | `so \| st \| wo \| wt` |
| `text` | string | |
| `priority` | enum | `high \| medium \| low` |
| `ownerId` | string | |
| `isDeleted` | boolean | |

### `kpis`

| Field | Type | Notes |
|-------|------|-------|
| `planId*` | string | |
| `perspective` | enum | `financial \| customer \| internal \| learning` |
| `kpi` | string | KPI name |
| `target` | string | e.g. `15%` |
| `actual` | string | e.g. `12%` |
| `unit` | string | e.g. `%`, `days`, `₱` |
| `status` | enum | `on-track \| at-risk \| behind \| complete` |
| `weight` | number | 0.0 – 1.0 |
| `isDeleted` | boolean | |

### `initiatives`

| Field | Type | Notes |
|-------|------|-------|
| `planId*` | string | |
| `name` | string | |
| `type` | enum | `program \| activity \| project` |
| `owner` | string | Department or person name |
| `budget` | number | Total allocated (₱) |
| `utilized` | number | Amount spent (₱) |
| `progress` | number | 0 – 100 |
| `status` | enum | `on-track \| at-risk \| behind \| complete` |
| `dueDate` | string | ISO date |
| `isDeleted` | boolean | |

### `comments`

| Field | Type | Notes |
|-------|------|-------|
| `planId*` | string | |
| `entityId*` | string | ID of the commented-on item |
| `entityType` | string | `swot \| kpi \| initiative \| strategy` |
| `entityName` | string | Display name for email |
| `text` | string | |
| `authorId` | string | |
| `authorName` | string | |
| `resolved` | boolean | |
| `resolvedBy` | string | |
| `isDeleted` | boolean | |

### `notifications`

| Field | Type | Notes |
|-------|------|-------|
| `userId*` | string | |
| `type` | enum | `invite \| comment \| share \| mention \| kpi_alert` |
| `title` | string | |
| `message` | string | |
| `planId` | string | Optional |
| `entityId` | string | Optional |
| `actionUrl` | string | Optional |
| `read*` | boolean | Indexed for unread count query |

### `activity_log`

| Field | Type | Notes |
|-------|------|-------|
| `userId*` | string | |
| `userEmail` | string | |
| `userName` | string | |
| `planId*` | string | |
| `action` | string | e.g. `added_swot_item`, `logged_in` |
| `entityType` | string | |
| `entityId` | string | |
| `details` | string | Human-readable description |
| `ipAddress` | string | |

### `templates`

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | |
| `industry*` | string | |
| `description` | string | |
| `ownerId` | string | null for built-in |
| `isBuiltIn` | boolean | |
| `isPublic*` | boolean | |
| `swotItems` | object | `{ strengths:[], weaknesses:[], ... }` |
| `strategies` | object | `{ so:[], st:[], wo:[], wt:[] }` |
| `kpis` | array | `[{ perspective, kpi, target, unit }]` |
| `initiatives` | array | `[{ name, type }]` |

### `invitations`

| Field | Type | Notes |
|-------|------|-------|
| `token*` | string | UUID, unique |
| `orgId` | string | |
| `email*` | string | |
| `role` | enum | |
| `invitedBy` | string | |
| `status` | enum | `pending \| accepted \| expired` |
| `expiresAt` | date | 7 days from creation |

### `refresh_tokens`

| Field | Type | Notes |
|-------|------|-------|
| `token*` | string | UUID pair, unique |
| `userId*` | string | |
| `expiresAt` | date | 30 days from creation |
| `used` | boolean | One-time use — true after rotation |

---

## PWA & Offline Support

Strat Planner Pro is a fully installable Progressive Web App that works without a network connection.

### Installation

Users can install the app from the browser:

- **Chrome / Edge (desktop):** Click the install icon in the address bar
- **Android Chrome:** "Add to Home Screen" prompt appears automatically
- **iOS Safari:** Share → "Add to Home Screen"

### Caching strategy

| Resource type | Strategy | Cache |
|--------------|----------|-------|
| App shell (`/app/index.html`) | Cache-first | `strat-planner-static-v1` |
| Static assets (CSS, JS, icons) | Cache-first, update on load | `strat-planner-static-v1` |
| API responses (`/api/*`) | Network-first, cache fallback | `strat-planner-data-v1` |
| Google Fonts | Stale-while-revalidate | `strat-planner-static-v1` |

Old caches are purged automatically on service worker activation when the cache version string is incremented.

### Offline mutations

When a mutation fails due to no network:

1. The change is queued in IndexedDB (`pending-changes` store)
2. The UI shows an "Offline — saved locally" indicator
3. When connectivity is restored, `BackgroundSync` fires `sync-plans`
4. The service worker reads all pending changes and POSTs to `/api/sync`
5. The server applies changes with last-write-wins conflict resolution
6. Successfully synced items are removed from IndexedDB
7. A `SYNC_COMPLETE` message is broadcast to all app clients

### Push notifications

The service worker includes a `push` event handler. To enable push:

1. Generate VAPID keys: `npx web-push generate-vapid-keys`
2. Add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to `.env`
3. Implement `POST /api/push/subscribe` to store push subscriptions
4. Call `webpush.sendNotification()` from relevant route triggers

---

## Authentication & Security

### Token flow

```
Register / Login
   ↓
accessToken  (JWT, 15min)  → stored in sessionStorage
refreshToken (UUID pair)   → stored in sessionStorage, also in DB

Every API request:
   Authorization: Bearer <accessToken>

Token expiry:
   POST /api/auth/refresh { refreshToken }
   → old token marked used → new pair returned

Logout:
   POST /api/auth/logout { refreshToken }
   → refresh token deleted from DB
```

### Password security

- Hashed with bcrypt at cost factor 12 (tunable via `BCRYPT_ROUNDS`)
- `bcrypt.compare()` used for verification (constant-time, no timing attacks)
- Minimum 8 characters enforced by `express-validator` on registration
- Password reset tokens are 1-hour expiry UUIDs sent via email

### Role-based access control

| Role | Scope | Permissions |
|------|-------|-------------|
| `viewer` | Plan-level | Read all sections, cannot write |
| `editor` | Plan-level | Read + write all sections |
| `admin` | Plan/Org-level | Full access including share + invite |
| `super_admin` | System-wide | All of the above + admin dashboard, user management |

All write routes check the caller's role before performing DB operations. Admin page in the app is guarded both client-side (CSS) and server-side (`requireAdmin` middleware on all `/api/admin/*` routes).

### Rate limiting

| Endpoint group | Limit |
|---------------|-------|
| All `/api/*` routes | 100 requests / 15 minutes |
| `/api/auth/login` | 10 requests / 15 minutes |
| `/api/auth/register` | 10 requests / 15 minutes |

### Security headers (Helmet)

Helmet sets the following headers on all responses:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security` (HSTS)
- `X-XSS-Protection`
- `Referrer-Policy`

> **Note:** `contentSecurityPolicy` is set to `false` in `helmet()` config — it is intended to be configured at the CDN/reverse-proxy level (Nginx/Cloudflare). If serving directly, enable CSP in `server.js`.

---

## Email Notifications

All transactional emails use HTML templates with branded header/footer and responsive layout. In development mode (when `SMTP_USER` is absent), emails are logged to the console rather than sent.

| Email | Trigger | Recipient |
|-------|---------|-----------|
| Welcome | Account registration | New user |
| Org invitation | `POST /api/orgs/:id/invite` | Invitee |
| Plan shared | `POST /api/plans/:id/share` | Target user |
| New comment | `POST /api/plans/:planId/comments` | Plan owner |
| Comment resolved | `PATCH .../comments/:id/resolve` | Comment author |
| KPI alert | KPI status → `behind` or `at-risk` | Plan owner |
| Password reset | `POST /api/auth/forgot-password` | Requesting user |

---

## Real-Time Collaboration

Real-time features are powered by the WebSocket server in `src/ws.js`.

### Presence

When a user opens a plan, their browser sends `SUBSCRIBE_PLAN`. The server:

1. Adds the connection to the plan's room
2. Broadcasts `PRESENCE_UPDATE` to all room members with the updated member list (name, initials, colour)
3. Each member's avatar is displayed in the plan header

When a user closes the tab or disconnects, they are removed from the room and presence is updated.

### Live updates

Every API mutation (SWOT, strategies, KPIs, initiatives, comments) triggers `ws.broadcastPlanUpdate()` after the DB write succeeds. This pushes the updated item to all other users in the plan room. The front-end applies the change to its local state without a full reload.

### Conflict handling

If two users edit the same item simultaneously:

- The server processes writes sequentially (NeDB single-process)
- The last write wins for online edits
- For offline sync, the client timestamp is compared to the server's `updatedAt` — the newer timestamp wins

---

## Deployment

### Option 1 — PM2 on a VPS (recommended for small teams)

```bash
# Install PM2
npm install -g pm2

# Start the application
pm2 start server.js --name strat-planner-pro \
  --env production \
  --max-memory-restart 512M

# Persist across reboots
pm2 save
pm2 startup

# Monitor
pm2 logs strat-planner-pro
pm2 monit
```

### Option 2 — Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p data uploads

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "server.js"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "4000:4000"
    env_file: .env
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
    restart: unless-stopped
```

### Option 3 — Railway / Render / Fly.io

These platforms deploy directly from the repository with zero configuration:

1. Connect your GitHub repository
2. Set all environment variables from `.env.example` in the platform dashboard
3. Set start command to `node server.js`
4. Attach a persistent volume mounted at `/app/data` for the NeDB files

### Nginx reverse proxy

```nginx
server {
    listen 443 ssl;
    server_name app.stratplannerpro.app;

    ssl_certificate     /etc/letsencrypt/live/.../fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/.../privkey.pem;

    # App pages + static files
    location / {
        proxy_pass         http://localhost:4000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # WebSocket upgrade
    location /ws {
        proxy_pass         http://localhost:4000/ws;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_read_timeout 3600s;
    }

    # API routes
    location /api/ {
        proxy_pass         http://localhost:4000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }
}
```

### Pre-deployment checklist

- [ ] `JWT_SECRET` is set to a 64-char+ random string (no fallback)
- [ ] `ADMIN_PASSWORD` is set (no fallback)
- [ ] `JWT_EXPIRES_IN` is `15m` (not `7d`)
- [ ] `NODE_ENV=production`
- [ ] `SMTP_USER` and `SMTP_PASS` are configured and tested
- [ ] `CORS_ORIGINS` lists only your production domain(s)
- [ ] `data/` and `uploads/` are on a persistent volume (not ephemeral container storage)
- [ ] Automated daily backup of `data/` to S3 or equivalent is configured
- [ ] `manifest.json` `start_url` is `/app/`
- [ ] PWA icons are served from `/icons/` (not external CDN)
- [ ] HTTPS is enabled (required for PWA install and service worker)
- [ ] Nginx WebSocket proxy headers are set

---

## Configuration Reference

### Generating a secure JWT secret

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Complete `.env.example`

```bash
# ── Server ──────────────────────────────────────
PORT=4000
HOST=0.0.0.0
NODE_ENV=development

# ── Security (required in production) ───────────
JWT_SECRET=
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
BCRYPT_ROUNDS=12

# ── Database ─────────────────────────────────────
DB_PATH=./data
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=

# ── CORS ─────────────────────────────────────────
CORS_ORIGINS=http://localhost:4000

# ── Rate limiting ────────────────────────────────
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
AUTH_RATE_LIMIT_MAX=10

# ── Email ────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
EMAIL_FROM_NAME=Strat Planner Pro
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
FRONTEND_URL=http://localhost:4000

# ── AI proxy (server-side only) ──────────────────
ANTHROPIC_API_KEY=

# ── Uploads & WebSocket ──────────────────────────
UPLOAD_PATH=./uploads
WS_HEARTBEAT_INTERVAL=30000
```

---

## Development Guide

### Running locally

```bash
npm run dev          # starts with --watch (Node 18+ file-watch)
```

The server restarts automatically on file changes. Visit:

- `http://localhost:4000` — landing page
- `http://localhost:4000/login` — authentication
- `http://localhost:4000/app/` — dashboard (requires login)
- `http://localhost:4000/api/health` — API health check

### Database management

```bash
# Manual seed (idempotent — safe to run multiple times)
npm run seed

# ⚠ Wipe all data and re-seed (DEVELOPMENT ONLY)
npm run db:reset
```

### Testing the API

Using `curl`:

```bash
# Register
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"TestPass123!","firstName":"Test","lastName":"User"}'

# Login
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"TestPass123!"}'

# Use returned token
export TOKEN="eyJ..."
curl http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

Using a REST client (Postman, Bruno, Insomnia):

- Import the API structure from the [API Reference](#api-reference) section
- Set `{{base_url}}` to `http://localhost:4000/api`
- Use the login endpoint to obtain a token, then set `Authorization: Bearer {{token}}`

### Adding a new API route

1. Add the handler to `src/routes.js` in the appropriate route group
2. Apply `auth.requireAuth` for protected routes
3. Add `express-validator` validation for all inputs
4. Call `helpers.logActivity()` after successful DB writes
5. Call `ws.broadcastPlanUpdate()` for plan-scoped mutations

### Front-end wiring pattern

All state mutations in `public/app/index.html` should follow this pattern:

```javascript
async function saveSwotItem(quadrant) {
  const text = document.getElementById('swot-input').value.trim();
  if (!text) { showToast('Please enter item text', 'error'); return; }

  try {
    const res = await apiFetch(`/api/plans/${STATE.activePlan.id}/swot`, {
      method: 'POST',
      body: JSON.stringify({ category: quadrant, text }),
    });
    const { item } = await res.json();

    // Only update STATE on server success
    STATE.activePlan.swot[quadrant].push(item);
    closeModal();
    initSwot();
    showToast('SWOT item added', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to save item', 'error');
  }
}

// Shared fetch wrapper with auth header + 401 refresh logic
async function apiFetch(path, options = {}) {
  const token = sessionStorage.getItem('spp_access_token');
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    // Attempt token refresh
    const refreshed = await refreshAccessToken();
    if (refreshed) return apiFetch(path, options); // retry once
    window.location.href = '/login?redirect=' + encodeURIComponent(location.pathname);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return res;
}
```

---

## Known Issues & Roadmap

### Known issues requiring fix before production

| Priority | File | Issue |
|----------|------|-------|
| 🔴 Critical | `src/auth.js` | JWT secret has hardcoded fallback — remove entirely |
| 🔴 Critical | `src/db.js` | Admin password has hardcoded fallback — remove entirely |
| 🔴 Critical | `src/routes.js` | `GET /notifications` has broken query (double full scan) |
| 🔴 Critical | `src/routes.js` | AI proxy routes (`/api/ai/swot`, `/api/ai/strategy`) missing |
| 🔴 Critical | `public/app/index.html` | No API fetch calls — all STATE is demo/in-memory |
| 🔴 Critical | `public/app/index.html` | `innerHTML` assignments unsanitised (XSS risk) |
| 🔴 Critical | `public/app/index.html` | Service worker not registered |
| 🔴 Critical | `.gitignore` | `data/` and `uploads/` not excluded |
| 🟡 High | `src/auth.js` | JWT lifetime default is 7d — reduce to 15m |
| 🟡 High | `src/auth.js` | `requireAdmin` trusts JWT role — should re-query DB |
| 🟡 High | `public/sw.js` | Background sync has no `Authorization` header |
| 🟡 High | `public/manifest.json` | `start_url: "/"` should be `"/app/"` |
| 🟡 High | `public/manifest.json` | Icon URLs point to external CDN |
| 🟡 High | `public/style.css` | No `prefers-reduced-motion` media query |

### Roadmap

**v1.1 — Wiring sprint** (current focus)
- Connect all `app/index.html` STATE mutations to API endpoints
- Implement silent JWT refresh in the front-end
- Register service worker and wire offline sync
- Add `/api/ai/swot` and `/api/ai/strategy` server-side proxy routes

**v1.2 — Hardening**
- Migrate from NeDB to PostgreSQL (pg / Prisma)
- Add comprehensive test suite (API integration + unit tests)
- Implement CSP headers
- Add error monitoring (Sentry)
- Add structured logging (Pino)

**v1.3 — Collaboration++**
- Operational transform / CRDT for true concurrent SWOT editing
- Rich-text comment editor
- @mention notifications
- Plan versioning / history

**v2.0 — Scale**
- Multi-tenancy billing (Stripe integration)
- SSO / SAML for enterprise clients
- API key management for third-party integrations
- Mobile app (React Native) using the same REST API

---

## Contributing

Contributions are welcome. Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes with clear, focused commits
4. Add or update tests where applicable
5. Ensure `npm run check` (lint + test) passes
6. Open a pull request with a clear description of the change

### Commit convention

```
feat:     new feature
fix:      bug fix
security: security improvement
docs:     documentation only
refactor: code restructure (no feature/fix)
test:     test additions or corrections
chore:    tooling, config, dependencies
```

### Reporting security issues

Please do not file public GitHub issues for security vulnerabilities. Email **security@asilvainnovations.com** with a description of the issue and steps to reproduce.

---

## License

MIT License — Copyright © 2026 ASilva Innovations, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

*Strat Planner Pro v1.0.0 — Built by [ASilva Innovations](https://asilvainnovations.com)*
