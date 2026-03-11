# Strat Planner Pro — Backend API

> Production-ready REST + WebSocket backend for the Strat Planner Pro strategic planning platform.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ |
| HTTP Framework | Express 4 |
| Database | NeDB (embedded, file-backed, MongoDB-like) |
| Auth | JWT (access token) + UUID refresh tokens |
| Password hashing | bcrypt (12 rounds) |
| Real-time | WebSocket (`ws` library) |
| Email | Nodemailer (SMTP) |
| Validation | express-validator |
| Security | helmet, cors, express-rate-limit |
| Logging | morgan |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET, SMTP credentials, etc.

# 3. Start the server
npm start          # production
npm run dev        # development with file watch

# 4. (optional) Reset and re-seed database
npm run db:reset
```

The API will be available at `http://localhost:4000`.

---

## Directory Structure

```
strat-planner-backend/
├── server.js              # Entry point — Express + HTTP server
├── src/
│   ├── db.js              # NeDB collections, indexes, seed, helper queries
│   ├── auth.js            # JWT, bcrypt, middleware
│   ├── email.js           # Nodemailer email templates
│   ├── ws.js              # WebSocket manager (real-time collaboration)
│   └── routes.js          # All API route handlers
├── scripts/
│   ├── seed.js            # Standalone seed runner
│   └── reset-db.js        # ⚠ Wipe + reseed
├── data/                  # NeDB .db files (auto-created)
├── uploads/               # File uploads (auto-created)
├── .env.example           # Environment template
└── README.md
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP server port |
| `JWT_SECRET` | *(required)* | Min 64-char secret for signing JWTs |
| `JWT_EXPIRES_IN` | `7d` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | Refresh token lifetime |
| `BCRYPT_ROUNDS` | `12` | Password hash cost factor |
| `DB_PATH` | `./data` | Directory for NeDB `.db` files |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username / email |
| `SMTP_PASS` | — | SMTP password / app password |
| `ADMIN_EMAIL` | `admin@asilvainnovations.com` | Auto-seeded admin email |
| `ADMIN_PASSWORD` | `StratAdmin@2025!` | Auto-seeded admin password |
| `FRONTEND_URL` | `http://localhost:3000` | Used in email links |

---

## API Reference

All endpoints are prefixed with `/api`.

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/register` | Create account |
| `POST` | `/auth/login` | Log in, receive tokens |
| `POST` | `/auth/refresh` | Rotate refresh token |
| `POST` | `/auth/logout` | Revoke refresh token |
| `GET`  | `/auth/me` | Get current user |
| `PATCH`| `/auth/me` | Update profile |
| `POST` | `/auth/change-password` | Change password |

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "maria@example.com",
  "password": "SecurePass123!",
  "firstName": "Maria",
  "lastName": "Santos"
}
```
Response:
```json
{
  "user": { "_id": "...", "email": "...", "firstName": "Maria", ... },
  "accessToken": "eyJ...",
  "refreshToken": "uuid-uuid-..."
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{ "email": "maria@example.com", "password": "SecurePass123!" }
```

#### Protected requests
```http
GET /api/auth/me
Authorization: Bearer eyJ...
```

---

### Organizations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/orgs` | List user's organizations |
| `POST` | `/orgs` | Create organization |
| `GET`  | `/orgs/:id/members` | List members |
| `POST` | `/orgs/:id/invite` | Send email invite |
| `POST` | `/orgs/accept-invite` | Accept invite (auth required) |

---

### Plans

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/plans` | List owned + shared plans |
| `POST` | `/plans` | Create plan (optionally from template) |
| `GET`  | `/plans/:id` | Full plan with all sections |
| `PATCH`| `/plans/:id` | Update plan metadata |
| `DELETE`| `/plans/:id` | Soft-delete plan |
| `POST` | `/plans/:id/share` | Share plan with user by email |

#### Create plan
```http
POST /api/plans
Authorization: Bearer ...
Content-Type: application/json

{
  "name": "Q2 2025 Corporate Strategy",
  "period": "January – June 2025",
  "orgId": "org-id-here",
  "templateId": "optional-template-id"
}
```

---

### SWOT Items

```
GET    /api/plans/:planId/swot
POST   /api/plans/:planId/swot
PATCH  /api/plans/:planId/swot/:id
DELETE /api/plans/:planId/swot/:id
```

#### Add SWOT item
```json
{
  "category": "strengths",
  "text": "Strong brand recognition in Southeast Asia",
  "evidence": "Brand tracking study Q1 2025",
  "impact": "high"
}
```
`category`: `strengths | weaknesses | opportunities | threats`

---

### Strategies

```
GET    /api/plans/:planId/strategies
POST   /api/plans/:planId/strategies
PATCH  /api/plans/:planId/strategies/:id
DELETE /api/plans/:planId/strategies/:id
```
`type`: `so | st | wo | wt`

---

### KPIs (Balanced Scorecard)

```
GET    /api/plans/:planId/kpis
POST   /api/plans/:planId/kpis
PATCH  /api/plans/:planId/kpis/:id
DELETE /api/plans/:planId/kpis/:id
```

#### Add KPI
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

> **KPI alerts**: When a KPI is updated to `behind` or `at-risk`, the plan owner automatically receives an email notification.

---

### Initiatives

```
GET    /api/plans/:planId/initiatives    → includes totalBudget, totalUtilized, remaining
POST   /api/plans/:planId/initiatives
PATCH  /api/plans/:planId/initiatives/:id
DELETE /api/plans/:planId/initiatives/:id
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

---

### Comments

```
GET    /api/plans/:planId/comments?entityId=...
POST   /api/plans/:planId/comments
PATCH  /api/plans/:planId/comments/:id/resolve
DELETE /api/plans/:planId/comments/:id
```

```json
{
  "entityId": "swot-item-id",
  "entityType": "swot",
  "entityName": "Strong brand recognition...",
  "text": "Should we also mention APAC coverage?"
}
```

---

### Notifications

```
GET   /api/notifications           → { items, unread }
PATCH /api/notifications/read-all
PATCH /api/notifications/:id/read
```

---

### Activity Log

```
GET /api/plans/:planId/activity
```

---

### Templates

```
GET    /api/templates?industry=government
POST   /api/templates
DELETE /api/templates/:id
```

---

### Sync (Offline-first)

```
POST /api/sync
```
Accepts an array of offline changes and applies them with last-write-wins conflict resolution.

```json
{
  "changes": [
    {
      "clientId": "local-id-1",
      "type": "swot",
      "operation": "upsert",
      "planId": "plan-id",
      "timestamp": 1718000000000,
      "data": { "category": "strengths", "text": "New item added offline" }
    }
  ]
}
```

Response:
```json
{
  "results": [
    { "id": "local-id-1", "status": "applied", "serverId": "server-id-abc" }
  ],
  "syncedAt": "2025-06-15T10:00:00.000Z"
}
```
`status`: `applied | conflict | rejected | error`

---

### Admin (super_admin only)

```
GET   /api/admin/stats
GET   /api/admin/users?page=1&limit=20
PATCH /api/admin/users/:id      → { role, isActive }
DELETE /api/admin/users/:id     → soft-deactivate
GET   /api/admin/audit-log
GET   /api/admin/plans
```

---

## WebSocket Protocol

Connect to `ws://localhost:4000/ws?token=YOUR_ACCESS_TOKEN`

### Client → Server

```json
{ "type": "SUBSCRIBE_PLAN",   "planId": "plan-id" }
{ "type": "UNSUBSCRIBE_PLAN", "planId": "plan-id" }
{ "type": "CURSOR_MOVE",      "planId": "plan-id", "payload": { "section": "swot" } }
{ "type": "PING" }
```

### Server → Client

```json
{ "type": "CONNECTED",        "payload": { "userId": "...", "name": "..." } }
{ "type": "PRESENCE_UPDATE",  "planId": "...", "payload": { "members": [...] } }
{ "type": "PLAN_UPDATED",     "planId": "...", "payload": { "section": "swot", "action": "add", "item": {...} } }
{ "type": "COMMENT_ADDED",    "planId": "...", "payload": { "comment": {...} } }
{ "type": "NOTIFICATION",     "payload": { "type": "share", "message": "..." } }
{ "type": "CURSOR_UPDATE",    "planId": "...", "payload": { "userId": "...", "section": "..." } }
{ "type": "PONG" }
```

---

## Database Schema

### users
```
_id, email*, firstName, lastName, password(hashed), role,
initials, color, isActive, emailVerified, createdAt, updatedAt
```

### organizations
```
_id, name, type, description, ownerId, createdAt, updatedAt
```

### org_members
```
_id, orgId*, userId*, role (viewer|editor|admin), invitedBy, createdAt
```

### plans
```
_id, name, orgId, ownerId*, period, description, isDeleted, createdAt, updatedAt
```

### plan_members
```
_id, planId*, userId*, role (viewer|editor|admin), sharedBy, createdAt
```

### swot_items
```
_id, planId*, category (strengths|weaknesses|opportunities|threats),
text, evidence, impact, ownerId, isDeleted, createdAt, updatedAt
```

### strategies
```
_id, planId*, type (so|st|wo|wt), text, priority, ownerId, isDeleted, createdAt
```

### kpis
```
_id, planId*, perspective, kpi, target, actual, unit, status, weight,
ownerId, isDeleted, createdAt, updatedAt
```

### initiatives
```
_id, planId*, name, type (program|activity|project), owner, budget,
utilized, progress, status, dueDate, ownerId, isDeleted, createdAt, updatedAt
```

### comments
```
_id, planId*, entityId*, entityType, entityName, text, authorId, authorName,
resolved, resolvedBy, isDeleted, createdAt
```

### notifications
```
_id, userId*, type, title, message, planId, entityId, actionUrl, read, createdAt
```

### activity_log
```
_id, userId, userEmail, userName, planId, action, entityType, entityId,
details, ipAddress, createdAt
```

### templates
```
_id, name, industry, description, ownerId, isBuiltIn, isPublic,
swotItems, strategies, kpis, initiatives, createdAt
```

### invitations
```
_id, token*, orgId, email, role, invitedBy, inviterName, status, expiresAt, createdAt
```

### refresh_tokens
```
_id, token*, userId*, expiresAt, used, createdAt
```

---

## Security Features

- **Passwords**: bcrypt hashed with configurable cost factor (default: 12 rounds)
- **JWT**: Short-lived access tokens (7d) + rotating refresh tokens (30d)
- **Rate limiting**: Global 100 req/15min, auth endpoints 10 req/15min
- **CORS**: Strict allow-list, credentials support
- **Helmet**: Security headers (HSTS, X-Frame-Options, CSP, etc.)
- **Input validation**: express-validator on all write endpoints
- **Soft deletes**: No hard deletes — data is never destroyed
- **Role-based access**: viewer / editor / admin per-plan, super_admin for system

---

## Deployment

### PM2 (recommended)
```bash
npm install -g pm2
pm2 start server.js --name strat-planner-api
pm2 save && pm2 startup
```

### Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p data uploads
EXPOSE 4000
CMD ["node", "server.js"]
```

### Nginx reverse proxy
```nginx
location /api/ {
    proxy_pass http://localhost:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
location /ws {
    proxy_pass http://localhost:4000/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

---

*Strat Planner Pro Backend v1.0.0 — ASilva Innovations*
