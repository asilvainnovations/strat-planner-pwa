/**
 * ============================================================
 * STRAT PLANNER PRO — DATABASE LAYER  (src/db.js)
 * ============================================================
 * Engine  : NeDB (embedded, file-backed, MongoDB-compatible API)
 * Wrapper : nedb-promises (async/await over nedb callbacks)
 * Location: ./data/*.db  — one file per collection (gitignored)
 *
 * This module is the single source of truth for:
 *   - All 15 collection definitions and their file paths
 *   - Every index that must exist before the server accepts traffic
 *   - Helper query functions used across routes.js
 *   - The seed function that bootstraps admin + built-in templates
 *   - The BUILT_IN_TEMPLATES array that populates templates.db
 *
 * ── Consumers ────────────────────────────────────────────────
 *   server.js   → ensureIndexes(), seed()  (called at boot)
 *   src/auth.js → db.refreshTokens         (token storage)
 *   src/routes.js → db.*, helpers.*        (all CRUD operations)
 *   scripts/seed.js     → db.*, ensureIndexes(), seed()
 *   scripts/reset-db.js → db.*, ensureIndexes(), seed()
 *
 * ── Collections (15) → data/*.db files ───────────────────────
 *   users              accounts & authentication
 *   organizations      org/team entities
 *   org_members        user↔org membership + roles
 *   plans              strategic plan headers
 *   plan_members       user↔plan sharing + permissions
 *   swot_items         SWOT entries per plan
 *   strategies         SO/ST/WO/WT per plan
 *   kpis               Balanced Scorecard KPIs
 *   initiatives        Programs / Activities / Projects
 *   comments           threaded comments on any entity
 *   notifications      in-app notification queue
 *   activity_log       full audit trail
 *   templates          reusable plan templates
 *   invitations        pending email invite tokens
 *   refresh_tokens     JWT refresh token store
 * ============================================================
 */

'use strict';

const path      = require('path');
const fs        = require('fs');
const Datastore = require('nedb-promises');

// ── Ensure data directory exists before NeDB tries to autoload ──
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(DB_PATH, { recursive: true });
}

/**
 * store(name, options?)
 * ---------------------
 * Factory that creates a NeDB Datastore instance for the given
 * collection name. Each collection maps to one flat file:
 *   store('users') → data/users.db
 *
 * Options:
 *   autoload: true   — NeDB loads the file immediately on creation
 *   timestampData    — auto-adds createdAt + updatedAt to every doc
 *
 * Called once per collection at module load time so all 15 files
 * are opened and indexed before the first request arrives.
 *
 * @param  {string} name       Filename stem (no extension)
 * @param  {object} [options]  Passed through to Datastore.create()
 * @returns {Datastore}
 */
function store(name, options = {}) {
  return Datastore.create({
    filename:      path.join(DB_PATH, `${name}.db`),
    autoload:      true,
    timestampData: true,   // sets createdAt on insert, updatedAt on update
    ...options,
  });
}

// ═══════════════════════════════════════════════════════════════
// COLLECTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * db — the single exported object containing all 15 Datastore instances.
 *
 * Imported by routes.js as:  const { db, helpers } = require('./db');
 * Imported by auth.js as:    const { db } = require('./db');
 * Imported by server.js as:  const { db, ensureIndexes, seed } = require('./src/db');
 *
 * NeDB API used across routes.js:
 *   db.*.insert(doc)                → create  → returns inserted doc (with _id)
 *   db.*.findOne(query)             → read    → returns doc or null
 *   db.*.find(query)                → read    → returns array
 *   db.*.count(query)               → count   → returns number
 *   db.*.update(query, update, opt) → update  → returns numReplaced
 *   db.*.remove(query, opt)         → delete  → returns numRemoved
 *
 * All methods return Promises via nedb-promises.
 */
const db = {

  /**
   * users.db
   * ─────────────────────────────────────────────────────────
   * One document per registered account.
   *
   * Fields:
   *   email*          string   Unique, lowercased on insert/query
   *   password        string   bcrypt hash (12 rounds) — NEVER returned to client
   *   firstName       string
   *   lastName        string
   *   role            enum     'user' | 'super_admin'
   *   initials        string   e.g. 'MS' — derived from firstName + lastName
   *   color           string   CSS gradient for avatar display
   *   isActive        boolean  false = soft-deleted account
   *   emailVerified   boolean  true after email confirmation flow
   *
   * Written by:  routes.js POST /api/auth/register
   *              routes.js PATCH /api/auth/me
   *              routes.js POST /api/auth/change-password
   *              routes.js PATCH /api/admin/users/:id
   *              db.seed()
   *
   * Read by:     routes.js POST /api/auth/login (helpers.findUserByEmail)
   *              routes.js GET  /api/auth/me
   *              routes.js GET  /api/admin/users
   *              routes.js POST /api/plans/:id/share
   *              ws.js (indirectly via auth.js JWT payload)
   *
   * Unique index: email (enforced by NeDB — duplicate inserts throw)
   */
  users: store('users'),

  /**
   * organizations.db
   * ─────────────────────────────────────────────────────────
   * One document per organisation / team entity.
   * Users belong to organisations via org_members.db (many-to-many).
   * Plans belong to organisations via plans.orgId (optional FK).
   *
   * Fields:
   *   name            string   Organisation display name
   *   type            string   e.g. 'Corporation', 'Government Agency', 'NGO'
   *   description     string   Optional free-text
   *   ownerId         string   FK → users._id of the creating user
   *   planCount       number   Denormalised count (incremented on plan create)
   *
   * Written by:  routes.js POST /api/orgs
   * Read by:     routes.js GET  /api/orgs
   *              routes.js GET  /api/orgs/:id/members
   *              routes.js POST /api/orgs/:id/invite (reads name for email)
   *              routes.js GET  /api/admin/stats
   */
  organizations: store('organizations'),

  /**
   * org_members.db
   * ─────────────────────────────────────────────────────────
   * Join table for user↔organisation membership with roles.
   * A user can belong to multiple organisations with different roles.
   *
   * Fields:
   *   orgId*          string   FK → organizations._id  (indexed)
   *   userId*         string   FK → users._id          (indexed)
   *   role            enum     'viewer' | 'editor' | 'admin'
   *   invitedBy       string   FK → users._id of the inviting user
   *
   * Written by:  routes.js POST /api/orgs  (creator auto-added as admin)
   *              routes.js POST /api/orgs/accept-invite
   * Read by:     routes.js GET  /api/orgs  (helpers.getOrgRole)
   *              routes.js GET  /api/orgs/:id/members
   *              routes.js POST /api/orgs/:id/invite (checks caller role)
   *              helpers.getOrgRole()
   */
  orgMembers: store('org_members'),

  /**
   * plans.db
   * ─────────────────────────────────────────────────────────
   * The header record for each strategic plan. All plan content
   * (SWOT items, strategies, KPIs, initiatives) is stored in
   * separate collections referencing planId.
   *
   * Fields:
   *   name            string   Plan display name, e.g. 'Q2 2025 Corporate Strategy'
   *   orgId*          string   FK → organizations._id (optional — plan may be personal)
   *   ownerId*        string   FK → users._id  (indexed)
   *   period          string   Human-readable period, e.g. 'January – June 2025'
   *   description     string
   *   isDeleted       boolean  Soft-delete flag (hard deletes never happen)
   *
   * Written by:  routes.js POST   /api/plans
   *              routes.js PATCH  /api/plans/:id
   *              routes.js DELETE /api/plans/:id  (sets isDeleted: true)
   *
   * Read by:     helpers.getUserPlans()      — plan selector
   *              helpers.findPlanWithAccess() — access check
   *              routes.js GET /api/plans/:id — full plan load
   *              routes.js GET /api/admin/plans
   *
   * Indexes: orgId, ownerId (for fast ownership + org-scoped queries)
   */
  plans: store('plans'),

  /**
   * plan_members.db
   * ─────────────────────────────────────────────────────────
   * Join table for user↔plan sharing with permission levels.
   * Distinct from org_members — a plan can be shared with
   * individual users regardless of their org membership.
   *
   * Fields:
   *   planId*         string   FK → plans._id (indexed)
   *   userId*         string   FK → users._id (indexed)
   *   role            enum     'viewer' | 'editor' | 'admin'
   *   sharedBy        string   FK → users._id of the sharing user
   *
   * Written by:  routes.js POST /api/plans/:id/share
   * Read by:     helpers.findPlanWithAccess()
   *              helpers.getUserPlans()  (shared plans branch)
   *              helpers.getPlanRole()
   *              routes.js GET /api/plans/:id  (members field)
   */
  planMembers: store('plan_members'),

  /**
   * swot_items.db
   * ─────────────────────────────────────────────────────────
   * Individual SWOT entries. One plan can have many items per category.
   * The front-end groups them by category into the four quadrants.
   *
   * Fields:
   *   planId*         string   FK → plans._id (indexed)
   *   category        enum     'strengths' | 'weaknesses' | 'opportunities' | 'threats'
   *   text            string   The SWOT statement (1–2 sentences recommended)
   *   evidence        string   Supporting data, source, or rationale
   *   impact          enum     'high' | 'medium' | 'low'
   *   ownerId         string   FK → users._id of the creating user
   *   isDeleted       boolean  Soft-delete (filters on isDeleted: { $ne: true })
   *
   * Written by:  routes.js POST   /api/plans/:planId/swot
   *              routes.js PATCH  /api/plans/:planId/swot/:id
   *              routes.js DELETE /api/plans/:planId/swot/:id  (soft)
   *              routes.js POST   /api/plans  (template pre-seed, if templateId provided)
   *              routes.js POST   /api/templates (clone from plan)
   *
   * Read by:     routes.js GET /api/plans/:id       (full plan load)
   *              routes.js GET /api/plans/:planId/swot
   *              routes.js POST /api/sync            (conflict resolution)
   *
   * After write: ws.broadcastPlanUpdate(planId, 'PLAN_UPDATED', { section:'swot' })
   *              helpers.logActivity()
   *
   * Indexes: planId (primary access pattern is always planId-scoped)
   */
  swotItems: store('swot_items'),

  /**
   * strategies.db
   * ─────────────────────────────────────────────────────────
   * SO / ST / WO / WT strategic options derived from SWOT analysis.
   * Each type represents a strategic posture:
   *   SO — use Strengths to seize Opportunities
   *   ST — use Strengths to counter Threats
   *   WO — overcome Weaknesses via Opportunities
   *   WT — minimise Weaknesses, avoid Threats
   *
   * Fields:
   *   planId*         string   FK → plans._id (indexed)
   *   type            enum     'so' | 'st' | 'wo' | 'wt'
   *   text            string   Strategy statement
   *   priority        enum     'high' | 'medium' | 'low'
   *   ownerId         string   FK → users._id
   *   isDeleted       boolean
   *
   * Written by:  routes.js POST   /api/plans/:planId/strategies
   *              routes.js PATCH  /api/plans/:planId/strategies/:id
   *              routes.js DELETE /api/plans/:planId/strategies/:id
   *              routes.js POST   /api/plans  (template pre-seed)
   *              routes.js POST   /api/templates  (plan clone)
   *
   * Read by:     routes.js GET /api/plans/:id
   *              routes.js GET /api/plans/:planId/strategies
   *              routes.js POST /api/sync
   *
   * After write: ws.broadcastPlanUpdate(planId, 'PLAN_UPDATED', { section:'strategies' })
   *
   * Indexes: planId
   */
  strategies: store('strategies'),

  /**
   * kpis.db
   * ─────────────────────────────────────────────────────────
   * Balanced Scorecard KPIs across four perspectives.
   * KPI status changes to 'behind' or 'at-risk' trigger:
   *   → email.sendKPIAlert() to the plan owner
   *   → ws.broadcastPlanUpdate() to all plan subscribers
   *
   * Fields:
   *   planId*         string   FK → plans._id (indexed)
   *   perspective     enum     'financial' | 'customer' | 'internal' | 'learning'
   *   kpi             string   KPI name, e.g. 'Revenue Growth'
   *   target          string   Target value, e.g. '15%'  (string for flexibility)
   *   actual          string   Actual value, e.g. '12%'
   *   unit            string   Unit label, e.g. '%', 'days', '₱'
   *   status          enum     'on-track' | 'at-risk' | 'behind' | 'complete'
   *   weight          number   0.0–1.0 weighting within perspective
   *   ownerId         string   FK → users._id
   *   isDeleted       boolean
   *
   * Written by:  routes.js POST   /api/plans/:planId/kpis
   *              routes.js PATCH  /api/plans/:planId/kpis/:id  (alert trigger on status change)
   *              routes.js DELETE /api/plans/:planId/kpis/:id
   *              routes.js POST   /api/plans  (template pre-seed)
   *
   * Read by:     routes.js GET /api/plans/:id
   *              routes.js GET /api/plans/:planId/kpis
   *              routes.js POST /api/sync
   *              routes.js PATCH /api/plans/:planId/kpis/:id  (reads plan for owner lookup)
   *
   * Alert flow (PATCH only):
   *   if update.status in ['behind','at-risk']:
   *     → db.plans.findOne → db.users.findOne(plan.ownerId)
   *     → email.sendKPIAlert({ to: owner.email, ... })
   *
   * Indexes: planId
   */
  kpis: store('kpis'),

  /**
   * initiatives.db
   * ─────────────────────────────────────────────────────────
   * Programs, Activities, and Projects (PAPs) — the execution layer
   * that links strategies to concrete actions with owners and budgets.
   *
   * Budget totals are computed server-side on GET /api/plans/:planId/initiatives:
   *   totalBudget   = SUM(items[].budget)
   *   totalUtilized = SUM(items[].utilized)
   *   remaining     = totalBudget − totalUtilized
   *
   * Fields:
   *   planId*         string   FK → plans._id (indexed)
   *   name            string   Initiative name
   *   type            enum     'program' | 'activity' | 'project'
   *   owner           string   Department name or person — free text
   *   budget          number   Total allocated amount (₱)
   *   utilized        number   Amount spent to date (₱)
   *   progress        number   0–100 (percentage completion)
   *   status          enum     'on-track' | 'at-risk' | 'behind' | 'complete'
   *   dueDate         string   ISO date string, e.g. '2025-12-31'
   *   ownerId         string   FK → users._id (the creating user)
   *   isDeleted       boolean
   *
   * Written by:  routes.js POST   /api/plans/:planId/initiatives
   *              routes.js PATCH  /api/plans/:planId/initiatives/:id
   *              routes.js DELETE /api/plans/:planId/initiatives/:id
   *              routes.js POST   /api/plans  (template pre-seed)
   *
   * Read by:     routes.js GET /api/plans/:id
   *              routes.js GET /api/plans/:planId/initiatives  (+ budget computation)
   *              routes.js POST /api/sync
   *
   * After write: ws.broadcastPlanUpdate(planId, 'PLAN_UPDATED', { section:'initiatives' })
   *
   * Indexes: planId
   */
  initiatives: store('initiatives'),

  /**
   * comments.db
   * ─────────────────────────────────────────────────────────
   * Threaded comments that can be attached to any entity in a plan:
   * SWOT items, KPIs, initiatives, or strategies.
   *
   * On new comment POST:
   *   → helpers.createNotification() for plan owner (if not the commenter)
   *   → ws.pushToUser(owner._id, NOTIFICATION)
   *   → email.sendCommentNotification() (fire-and-forget)
   *   → ws.broadcastPlanUpdate(planId, 'COMMENT_ADDED', { comment })
   *
   * On resolve PATCH:
   *   → email.sendCommentResolved() to comment author (if not the resolver)
   *
   * Fields:
   *   planId*         string   FK → plans._id (indexed)
   *   entityId*       string   FK → the commented-on item's _id (indexed)
   *   entityType      string   'swot' | 'kpi' | 'initiative' | 'strategy'
   *   entityName      string   Display name used in notification emails
   *   text            string   Comment body
   *   authorId        string   FK → users._id
   *   authorName      string   Denormalised display name
   *   resolved        boolean  true = comment thread closed
   *   resolvedBy      string   FK → users._id of the resolver
   *   isDeleted       boolean  Soft-delete (authors can delete own; super_admin can delete any)
   *
   * Written by:  routes.js POST  /api/plans/:planId/comments
   *              routes.js PATCH /api/plans/:planId/comments/:id/resolve
   *              routes.js DELETE /api/plans/:planId/comments/:id
   *
   * Read by:     routes.js GET /api/plans/:id   (all plan comments)
   *              routes.js GET /api/plans/:planId/comments?entityId=...  (filtered)
   *
   * Indexes: entityId, planId
   */
  comments: store('comments'),

  /**
   * notifications.db
   * ─────────────────────────────────────────────────────────
   * In-app notification queue. Displayed in the notification panel
   * of the app dashboard. Also broadcast via WebSocket on creation.
   *
   * Types (type field):
   *   'invite'    — org invitation received
   *   'comment'   — new comment on a plan item you own
   *   'share'     — a plan was shared with you
   *   'mention'   — you were @mentioned (future)
   *   'kpi_alert' — a KPI you own went behind or at-risk
   *
   * Fields:
   *   userId*         string   FK → users._id — notification recipient (indexed)
   *   type            enum     see types above
   *   title           string   Short notification heading
   *   message         string   Full notification body
   *   planId          string   FK → plans._id (optional, for deep-link)
   *   entityId        string   FK to the related entity (optional)
   *   actionUrl       string   Relative URL to link to on click (optional)
   *   read*           boolean  false = unread  (indexed for unread count query)
   *
   * Written by:  helpers.createNotification() — called from routes.js on:
   *                POST /api/plans/:id/share
   *                POST /api/plans/:planId/comments
   *
   * Read by:     routes.js GET   /api/notifications  (sorted, sliced to 50)
   *              routes.js PATCH /api/notifications/read-all
   *              routes.js PATCH /api/notifications/:id/read
   *
   * ⚠ Known bug in routes.js GET /notifications:
   *   The query contains a broken ternary that runs two full scans.
   *   Fix:
   *     const items = (await db.notifications.find({ userId: req.user.id }))
   *       .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
   *       .slice(0, 50);
   *
   * Indexes: userId, read (compound unread count pattern)
   */
  notifications: store('notifications'),

  /**
   * activity_log.db
   * ─────────────────────────────────────────────────────────
   * Full, immutable audit trail of all significant user actions.
   * Never updated or deleted — append-only by design.
   * Shown in: app/index.html Activity Log page, admin audit-log.
   *
   * Written by helpers.logActivity(data), called after every mutation
   * in routes.js. Also written directly in server.js boot sequence.
   *
   * Fields:
   *   userId*         string   FK → users._id (indexed)
   *   userEmail       string   Denormalised (stable even if name changes)
   *   userName        string   Denormalised display name
   *   planId*         string   FK → plans._id (indexed, nullable for system events)
   *   action          string   Snake_case verb, e.g. 'added_swot_item', 'logged_in'
   *   entityType      string   'swot' | 'strategy' | 'kpi' | 'initiative' | 'plan' | 'user'
   *   entityId        string   FK to the affected entity
   *   details         string   Human-readable description for audit log display
   *   ipAddress       string   req.ip (from Express, respects X-Forwarded-For)
   *
   * Action vocabulary (used in routes.js helpers.logActivity calls):
   *   registered         logged_in          logged_out
   *   created_plan       updated_plan       deleted_plan
   *   added_swot_item    updated_swot_item  deleted_swot_item
   *   added_strategy     updated_strategy   deleted_strategy
   *   added_kpi          updated_kpi        deleted_kpi
   *   added_initiative   updated_initiative deleted_initiative
   *   added_comment      resolved_comment   deleted_comment
   *   invited            shared_plan        accepted_invite
   *
   * Read by:     routes.js GET /api/plans/:planId/activity (sorted, limit 100)
   *              routes.js GET /api/admin/audit-log        (sorted, limit 200)
   *
   * Indexes: planId, userId
   */
  activityLog: store('activity_log'),

  /**
   * templates.db
   * ─────────────────────────────────────────────────────────
   * Reusable plan templates. Two categories:
   *   Built-in  (isBuiltIn: true)  — seeded by db.seed(), immutable
   *   User-created (isBuiltIn: false) — created by POST /api/templates
   *
   * Templates can be:
   *   Public  (isPublic: true)  — visible to all users via GET /api/templates
   *   Private (isPublic: false) — visible to the owning user only
   *
   * When a plan is created with templateId, routes.js pre-seeds all
   * nested items (swotItems, strategies, kpis, initiatives) into the
   * new plan's respective collections.
   *
   * Fields:
   *   name            string   Template display name
   *   industry*       string   Filter key (indexed) — see enum below
   *   emoji           string   Industry emoji for UI display
   *   description     string
   *   ownerId         string   FK → users._id (null for built-in)
   *   isBuiltIn       boolean
   *   isPublic*       boolean  (indexed — primary filter on GET /api/templates)
   *   swotItems       object   { strengths:[], weaknesses:[], opportunities:[], threats:[] }
   *   strategies      object   { so:[], st:[], wo:[], wt:[] }
   *   kpis            array    [{ perspective, kpi, target, unit }]
   *   initiatives     array    [{ name, type }]
   *
   * Industry enum:
   *   'government' | 'healthcare' | 'technology' | 'education'
   *   'finance' | 'retail' | 'manufacturing' | 'ngos'
   *
   * Written by:  db.seed()  (5 built-in templates on first boot)
   *              routes.js POST   /api/templates   (user-created, optionally cloned from plan)
   *              routes.js DELETE /api/templates/:id
   *
   * Read by:     routes.js GET /api/templates?industry=government
   *              routes.js POST /api/plans  (pre-seed if templateId provided)
   *              app/index.html initTemplates()
   *
   * Indexes: industry, isPublic
   */
  templates: store('templates'),

  /**
   * invitations.db
   * ─────────────────────────────────────────────────────────
   * Pending org-level email invitation tokens.
   * Tokens expire after 7 days. Once accepted, status → 'accepted'.
   * Inviting org members to plans is handled via plan_members, not here.
   *
   * Fields:
   *   token*          string   UUID pair (unique) — sent in invite email link
   *   orgId           string   FK → organizations._id
   *   email*          string   Invitee email address (indexed for duplicate check)
   *   role            enum     'viewer' | 'editor' | 'admin'
   *   invitedBy       string   FK → users._id
   *   inviterName     string   Denormalised name for email template
   *   status          enum     'pending' | 'accepted' | 'expired'
   *   expiresAt       date     7 days from creation
   *
   * Written by:  routes.js POST /api/orgs/:id/invite  (creates pending record)
   *              routes.js POST /api/orgs/accept-invite  (updates status → 'accepted')
   *              routes.js POST /api/orgs/accept-invite  (updates status → 'expired' if stale)
   *
   * Read by:     routes.js POST /api/orgs/accept-invite  (looks up by token + status:'pending')
   *
   * Email trigger: email.sendInviteToOrg() — called immediately after insert in routes.js
   *
   * Indexes: token (unique — lookup key), email (duplicate invite check)
   */
  invitations: store('invitations'),

  /**
   * refresh_tokens.db
   * ─────────────────────────────────────────────────────────
   * JWT refresh token storage. One record per active session.
   * Implements one-time-use rotation: on refresh, the old token is
   * marked used:true BEFORE the new token is issued. Prevents replay attacks.
   *
   * Fields:
   *   token*          string   UUID pair (unique) — returned to client on login/register
   *   userId*         string   FK → users._id (indexed — for revokeAllUserTokens)
   *   expiresAt       date     30 days from creation (configurable via JWT_REFRESH_EXPIRES_IN)
   *   used            boolean  true = token has been rotated (can never be used again)
   *
   * Written by:  auth.createRefreshToken()   — insert on login/register/refresh
   *              auth.rotateRefreshToken()   — update used:true, then insert new
   *              auth.revokeRefreshToken()   — remove single token on logout
   *              auth.revokeAllUserTokens()  — remove all user's tokens (password change)
   *              routes.js DELETE /api/admin/users/:id — revokeAllUserTokens on deactivate
   *
   * Read by:     auth.rotateRefreshToken()   — findOne({ token, used: false })
   *              routes.js POST /api/auth/refresh  (indirectly via auth module)
   *
   * Indexes: token (unique — primary lookup), userId (revoke all sessions)
   */
  refreshTokens: store('refresh_tokens'),
};

// ═══════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════

/**
 * ensureIndexes()
 * ───────────────
 * Creates all required NeDB indexes across all 15 collections.
 * Called by server.js at boot before any requests are accepted,
 * and by scripts/seed.js and scripts/reset-db.js.
 *
 * NeDB's ensureIndex() is idempotent — safe to call on every startup.
 * Unique indexes cause insert() to throw if a duplicate is attempted,
 * which routes.js handles with 409 Conflict responses.
 *
 * Index strategy mirrors the access patterns in routes.js:
 *   - Unique: email, token fields where collisions must be prevented
 *   - FK: planId, userId, orgId on join tables and child collections
 *   - Filter: industry, isPublic, read for common query filters
 *
 * @returns {Promise<void>}
 */
async function ensureIndexes() {

  // ── users ────────────────────────────────────────────────
  // Unique email prevents duplicate accounts and enables fast login lookup
  await db.users.ensureIndex({ fieldName: 'email', unique: true });

  // ── org_members ───────────────────────────────────────────
  // Both FK fields indexed: membership queries go both directions
  await db.orgMembers.ensureIndex({ fieldName: 'orgId' });
  await db.orgMembers.ensureIndex({ fieldName: 'userId' });

  // ── plans ─────────────────────────────────────────────────
  // orgId: for org-scoped plan lists (admin panel)
  // ownerId: for helpers.getUserPlans() owned branch
  await db.plans.ensureIndex({ fieldName: 'orgId' });
  await db.plans.ensureIndex({ fieldName: 'ownerId' });

  // ── plan_members ──────────────────────────────────────────
  // planId: for helpers.findPlanWithAccess() shared branch
  // userId: for helpers.getUserPlans() shared branch
  await db.planMembers.ensureIndex({ fieldName: 'planId' });
  await db.planMembers.ensureIndex({ fieldName: 'userId' });

  // ── swot_items ────────────────────────────────────────────
  // All queries are planId-scoped — this is the hot path
  await db.swotItems.ensureIndex({ fieldName: 'planId' });

  // ── strategies ────────────────────────────────────────────
  await db.strategies.ensureIndex({ fieldName: 'planId' });

  // ── kpis ──────────────────────────────────────────────────
  await db.kpis.ensureIndex({ fieldName: 'planId' });

  // ── initiatives ───────────────────────────────────────────
  await db.initiatives.ensureIndex({ fieldName: 'planId' });

  // ── comments ──────────────────────────────────────────────
  // entityId: for GET /comments?entityId=... filtered queries
  // planId: for GET /plans/:id full-plan load and cascade checks
  await db.comments.ensureIndex({ fieldName: 'entityId' });
  await db.comments.ensureIndex({ fieldName: 'planId' });

  // ── notifications ─────────────────────────────────────────
  // userId: primary access pattern — all queries are user-scoped
  // read: for fast unread count without full collection scan
  await db.notifications.ensureIndex({ fieldName: 'userId' });
  await db.notifications.ensureIndex({ fieldName: 'read' });

  // ── activity_log ──────────────────────────────────────────
  // planId: GET /api/plans/:planId/activity
  // userId: GET /api/admin/audit-log (user attribution)
  await db.activityLog.ensureIndex({ fieldName: 'planId' });
  await db.activityLog.ensureIndex({ fieldName: 'userId' });

  // ── templates ─────────────────────────────────────────────
  // industry: GET /api/templates?industry=government filter
  // isPublic: separates built-in public templates from private user templates
  await db.templates.ensureIndex({ fieldName: 'industry' });
  await db.templates.ensureIndex({ fieldName: 'isPublic' });

  // ── invitations ───────────────────────────────────────────
  // token: unique — the accept-invite lookup key; prevents duplicate tokens
  // email: for duplicate invite detection before insert
  await db.invitations.ensureIndex({ fieldName: 'token', unique: true });
  await db.invitations.ensureIndex({ fieldName: 'email' });

  // ── refresh_tokens ────────────────────────────────────────
  // token: unique — the primary lookup key on every /auth/refresh call
  // userId: for revokeAllUserTokens() called on password change + account deactivation
  await db.refreshTokens.ensureIndex({ fieldName: 'token', unique: true });
  await db.refreshTokens.ensureIndex({ fieldName: 'userId' });

  console.log('[DB] All indexes verified across 15 collections');
}

// ═══════════════════════════════════════════════════════════════
// SEED
// ═══════════════════════════════════════════════════════════════

/**
 * seed()
 * ──────
 * Idempotent bootstrap function. Called by server.js at every startup.
 *
 * Creates:
 *   1. Admin user   — only if ADMIN_EMAIL is not already in users.db
 *   2. Built-in templates — only if templates.db has 0 isBuiltIn records
 *
 * Required env vars:
 *   ADMIN_EMAIL     — no hardcoded fallback (server refuses to boot without it)
 *   ADMIN_PASSWORD  — no hardcoded fallback (server refuses to boot without it)
 *
 * Calls auth.hashPassword() — imported here (not at module top-level)
 * to avoid circular dependency:
 *   db.js → auth.js imports db.js for db.refreshTokens
 * By requiring auth inside the function, the circular reference is
 * deferred until after both modules have finished loading.
 *
 * @returns {Promise<void>}
 */
async function seed() {
  // Deferred require avoids circular import: db.js ↔ auth.js
  const { hashPassword } = require('./auth');

  const adminEmail    = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  // Hard fail if required env vars are missing — prevents silent insecure boot
  if (!adminEmail || !adminPassword) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[DB] ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env for production. ' +
        'See .env.example for required variables.'
      );
    }
    // In development, warn but continue so the dev can log in manually
    console.warn('[DB] ⚠ ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin seed.');
    console.warn('[DB]   Copy .env.example to .env and fill in the required values.');
  } else {
    // Only insert admin if not already present
    const existing = await db.users.findOne({ email: adminEmail.toLowerCase().trim() });
    if (!existing) {
      const hash = await hashPassword(adminPassword);
      await db.users.insert({
        email:         adminEmail.toLowerCase().trim(),
        password:      hash,
        firstName:     'Admin',
        lastName:      'User',
        role:          'super_admin',
        initials:      'AD',
        color:         'linear-gradient(135deg,#FFD700,#FFA500)',
        isActive:      true,
        emailVerified: true,
      });
      console.log(`[DB] Admin seeded: ${adminEmail}`);
    } else {
      console.log(`[DB] Admin already exists: ${adminEmail}`);
    }
  }

  // Seed built-in templates only if none exist yet
  const templateCount = await db.templates.count({ isBuiltIn: true });
  if (templateCount === 0) {
    await db.templates.insert(BUILT_IN_TEMPLATES);
    console.log(`[DB] ${BUILT_IN_TEMPLATES.length} built-in templates seeded`);
  } else {
    console.log(`[DB] Built-in templates already present (${templateCount})`);
  }
}

// ═══════════════════════════════════════════════════════════════
// BUILT-IN TEMPLATES
// ═══════════════════════════════════════════════════════════════

/**
 * BUILT_IN_TEMPLATES
 * ──────────────────
 * The five industry templates seeded into templates.db on first boot.
 * Displayed in app/index.html → Template Library page.
 * Consumed by routes.js POST /api/plans when templateId is provided.
 *
 * Each template contains:
 *   swotItems   — grouped by category, used to pre-seed swot_items.db
 *   strategies  — grouped by type (so/st/wo/wt), pre-seeds strategies.db
 *   kpis        — array of { perspective, kpi, target, unit }, pre-seeds kpis.db
 *   initiatives — array of { name, type }, pre-seeds initiatives.db
 *
 * Industry coverage:
 *   government  — Philippine LGU + National Agency
 *   healthcare  — Hospital / Health System
 *   technology  — Tech Startup + Digital Transformation
 *   education   — Higher Education Institution (HEI)
 *
 * Context alignment: Templates use Philippine-specific terminology
 * (PhilHealth, CHED, DILG, DepEd, IRA, NDRRMC, CMO) reflecting the
 * primary market of ASilva Innovations.
 */
const BUILT_IN_TEMPLATES = [

  // ── 1. Local Government Unit (LGU) ─────────────────────────
  {
    name:        'Local Government Unit (LGU) Strategic Plan',
    industry:    'government',
    emoji:       '🏛️',
    description: '5-year development plan template aligned with Philippine Comprehensive Land Use Plan (CLUP) and DILG guidelines.',
    isBuiltIn:   true,
    isPublic:    true,

    swotItems: {
      strengths: [
        'Strong executive leadership with clear governance mandate and political will',
        'Established community partnerships and multi-stakeholder consultation mechanisms',
        'Access to national government funding through DILG, DPWH, and Congressional allocations',
        'Functional local development council and planning office with trained technical staff',
      ],
      weaknesses: [
        'Limited digital infrastructure and e-government capabilities hindering service delivery',
        'Understaffed technical departments causing project execution delays',
        'Heavy dependence on Internal Revenue Allotment (IRA) limiting financial flexibility',
        'Low local tax compliance rates reducing own-source revenue base',
      ],
      opportunities: [
        'Digital Governance programs under DICT and DILG mandates enabling e-service delivery',
        'Public-Private Partnership (PPP) frameworks enabling co-investment in infrastructure',
        'Tourism and economic zone development potential driving local economic growth',
        'National government priority programs (Build Better More) aligning with local priorities',
      ],
      threats: [
        'Natural disaster risk requiring significant resilience and DRRM investment',
        'Rapid urbanization creating service demand beyond current fiscal and infrastructure capacity',
        'Political transition risks affecting multi-year program continuity across administrations',
        'Rising costs of materials and services outpacing budget appropriations',
      ],
    },

    strategies: {
      so: [
        'Leverage executive mandate and PPP frameworks to fast-track smart city infrastructure',
        'Use stakeholder networks to co-design and co-fund disaster resilience infrastructure',
      ],
      st: [
        'Build NDRRMC-aligned disaster resilience programs leveraging leadership mandate',
        'Institutionalise succession and transition protocols to ensure program continuity',
      ],
      wo: [
        'Apply for DILG Digital Governance grants to modernise e-government systems',
        'Engage national agencies for technical assistance to fill department staffing gaps',
      ],
      wt: [
        'Diversify revenue base with local resource mobilisation strategies to reduce IRA dependence',
        'Establish multi-year development agreements to insulate programs from political transition',
      ],
    },

    kpis: [
      { perspective: 'financial', kpi: 'Own-Source Revenue Growth',          target: '15%',    unit: '%' },
      { perspective: 'financial', kpi: 'Budget Utilisation Rate',             target: '90%',    unit: '%' },
      { perspective: 'customer',  kpi: 'Citizen Satisfaction Rating (CSIS)', target: '80%',    unit: '%' },
      { perspective: 'customer',  kpi: 'Business Permit Processing Time',    target: '3 days', unit: 'days' },
      { perspective: 'internal',  kpi: 'e-Government Services Deployed',     target: '10',     unit: 'services' },
      { perspective: 'internal',  kpi: 'Infrastructure Projects Completed',  target: '85%',    unit: '%' },
      { perspective: 'learning',  kpi: 'Staff Training Hours / Year',        target: '40',     unit: 'hours' },
      { perspective: 'learning',  kpi: 'Local Officials Trained on DRRM',   target: '100%',   unit: '%' },
    ],

    initiatives: [
      { name: 'e-Gov Portal & Online Services Launch',   type: 'project' },
      { name: 'Local Revenue Enhancement Program',        type: 'program' },
      { name: 'Disaster Risk Reduction & Climate Action Plan', type: 'activity' },
      { name: 'Infrastructure Development Program',       type: 'program' },
      { name: 'Livelihood & Economic Development Program', type: 'activity' },
    ],
  },

  // ── 2. Hospital / Health System ────────────────────────────
  {
    name:        'Hospital / Health System Strategy',
    industry:    'healthcare',
    emoji:       '🏥',
    description: 'Quality improvement and patient safety focused strategic plan for regional and tertiary hospitals in the Philippine health system.',
    isBuiltIn:   true,
    isPublic:    true,

    swotItems: {
      strengths: [
        'DOH-accredited clinical programs with highly trained medical and nursing specialists',
        'Strong referral network with community health centres and rural health units',
        'PhilHealth accreditation securing consistent and growing revenue base',
        'Established hospital systems and protocols with institutional memory',
      ],
      weaknesses: [
        'Ageing medical equipment limiting diagnostic accuracy and patient throughput',
        'High nurse-to-patient ratio creating burnout risk and quality-of-care concerns',
        'Paper-based clinical records slowing decision-making and increasing error risk',
        'Limited telemedicine infrastructure excluding geographically isolated communities',
      ],
      opportunities: [
        'Universal Health Care (UHC) Act increasing PhilHealth coverage and reimbursement rates',
        'DOH digital health roadmap funding for hospital information system upgrades',
        'Telemedicine adoption enabling expanded geographic service reach post-pandemic',
        'Medical tourism growth in ASEAN creating premium service revenue opportunities',
      ],
      threats: [
        'Health worker brain drain to international hospitals and Middle East markets',
        'Rising pharmaceutical, medical supply, and utility costs compressing operating margins',
        'Emerging and re-emerging infectious disease threats requiring surge capacity',
        'Increasing patient expectations amid constrained government health budgets',
      ],
    },

    strategies: {
      so: [
        'Scale telemedicine services using clinical expertise to reach geographically isolated communities',
        'Leverage PhilHealth accreditation to expand service lines and increase case mix',
      ],
      st: [
        'Develop competitive retention packages and career pathways to counter international recruitment',
        'Build infectious disease surge capacity protocols leveraging existing clinical expertise',
      ],
      wo: [
        'Access UHC funding to modernise diagnostic equipment and deploy hospital information system',
        'Partner with DOH and DICT for telemedicine infrastructure in underserved areas',
      ],
      wt: [
        'Implement cost-efficiency programme to offset supply cost increases without reducing quality',
        'Develop local health workforce pipeline with academic institutions to reduce attrition impact',
      ],
    },

    kpis: [
      { perspective: 'financial', kpi: 'Revenue per Bed per Day',             target: '₱8,500',  unit: '₱' },
      { perspective: 'financial', kpi: 'Operating Cost per Admission',        target: '₱15,000', unit: '₱' },
      { perspective: 'customer',  kpi: 'Patient Satisfaction Score (HCAHPS)', target: '90%',     unit: '%' },
      { perspective: 'customer',  kpi: 'Hospital-Acquired Infection Rate',    target: '<1%',     unit: '%' },
      { perspective: 'internal',  kpi: 'Average Length of Stay',              target: '4.2 days', unit: 'days' },
      { perspective: 'internal',  kpi: 'Bed Occupancy Rate',                  target: '80%',     unit: '%' },
      { perspective: 'learning',  kpi: 'CME Hours per Physician per Year',    target: '50',      unit: 'hours' },
      { perspective: 'learning',  kpi: 'Staff Turnover Rate',                 target: '<10%',    unit: '%' },
    ],

    initiatives: [
      { name: 'Hospital Information System (HIS) Deployment', type: 'project' },
      { name: 'Telemedicine Platform Rollout',                 type: 'program' },
      { name: 'Nurse & Allied Health Retention Program',       type: 'activity' },
      { name: 'Diagnostic Equipment Modernisation',            type: 'project' },
      { name: 'Accreditation Maintenance & Quality Program',   type: 'activity' },
    ],
  },

  // ── 3. Tech Startup Growth Strategy ────────────────────────
  {
    name:        'Tech Startup Growth Strategy',
    industry:    'technology',
    emoji:       '💻',
    description: 'Lean strategy framework for early-stage technology companies targeting Series A or Series B funding rounds.',
    isBuiltIn:   true,
    isPublic:    true,

    swotItems: {
      strengths: [
        'Agile engineering team with rapid iteration capability and short release cycles',
        'Unique IP and proprietary algorithm providing defensible competitive moat',
        'Early adopter base providing validated product-market fit signals and case studies',
        'Founder-led sales pipeline with strong domain credibility in target market',
      ],
      weaknesses: [
        'Limited runway (under 18 months) creating investor-dependency and execution urgency',
        'Single-threaded revenue model concentrated in one customer segment',
        'Founder-dependent operations lacking process maturity for scale',
        'Thin engineering bench creating key-person risk in core product functions',
      ],
      opportunities: [
        'AI/ML tooling maturation reducing development costs and accelerating feature velocity',
        'Enterprise digital transformation budgets expanding total addressable market (TAM)',
        'Regional fintech, govtech, and healthtech regulatory sandbox programs reducing market entry barriers',
        'ASEAN market integration opening cross-border opportunities without separate entity requirements',
      ],
      threats: [
        'Well-funded global incumbents with established distribution and enterprise relationships',
        'Talent war for senior engineers and ML specialists driving up burn rate',
        'Data privacy regulatory changes (NPC, GDPR) requiring costly product re-architecture',
        'VC market tightening extending fundraising timelines and increasing dilution risk',
      ],
    },

    strategies: {
      so: [
        'Accelerate AI feature development to widen moat before incumbents catch up to our niche',
        'Use validated case studies to accelerate enterprise sales and shorten deal cycles',
      ],
      st: [
        'Build enterprise-grade compliance and security features to neutralise regulatory risk as a selling point',
        'Establish equity retention and ESOP program to compete for engineering talent on non-cash terms',
      ],
      wo: [
        'Pursue Series A to extend runway, hire process-oriented operators, and reduce founder dependency',
        'Develop second revenue stream to diversify concentration risk before next funding round',
      ],
      wt: [
        'Establish strategic partnership with established regional player for distribution and market credibility',
        'Implement rigorous burn rate management to extend runway despite funding market tightening',
      ],
    },

    kpis: [
      { perspective: 'financial', kpi: 'Monthly Recurring Revenue (MRR)',         target: '₱2.5M',  unit: '₱' },
      { perspective: 'financial', kpi: 'Gross Revenue Retention Rate',            target: '90%',    unit: '%' },
      { perspective: 'customer',  kpi: 'Net Revenue Retention (NRR)',             target: '110%',   unit: '%' },
      { perspective: 'customer',  kpi: 'Customer Acquisition Cost (CAC) Payback', target: '12 mo', unit: 'months' },
      { perspective: 'internal',  kpi: 'Product Velocity (story points / sprint)', target: '85',   unit: 'pts' },
      { perspective: 'internal',  kpi: 'Deployment Frequency',                    target: 'Daily',  unit: '' },
      { perspective: 'learning',  kpi: 'Employee Net Promoter Score (eNPS)',       target: '55',    unit: 'score' },
      { perspective: 'learning',  kpi: 'Time-to-Hire (senior roles)',             target: '45 days', unit: 'days' },
    ],

    initiatives: [
      { name: 'Series A Fundraising Campaign',     type: 'program' },
      { name: 'Enterprise Product Track Build',    type: 'activity' },
      { name: 'Platform AI/ML Feature Layer',      type: 'project' },
      { name: 'Second Revenue Stream Development', type: 'activity' },
      { name: 'Engineering Talent Acquisition',    type: 'program' },
    ],
  },

  // ── 4. Higher Education Institution ────────────────────────
  {
    name:        'Higher Education Institution Strategic Plan',
    industry:    'education',
    emoji:       '🎓',
    description: 'Institutional strategic plan aligned with CHED requirements, CMO standards, and the Philippine Qualifications Framework (PQF).',
    isBuiltIn:   true,
    isPublic:    true,

    swotItems: {
      strengths: [
        'CHED Center of Excellence or Center of Development recognition in core academic programs',
        'Strong and active alumni network with industry placement reach and mentoring capacity',
        'Research-active faculty with international publications and funded research projects',
        'Established governance structures and quality assurance systems (ISO, AACCUP)',
      ],
      weaknesses: [
        'Ageing campus infrastructure limiting student experience quality and laboratory capability',
        'Limited industry linkage programs reducing graduate employability and curriculum relevance',
        'Low faculty-to-student ratio in high-demand programs creating quality and workload concerns',
        'Inadequate digital learning infrastructure for blended and online modality delivery',
      ],
      opportunities: [
        'Online and hybrid learning modalities expanding enrollment beyond geographic constraints',
        'Industry-academe partnership programs funded by CHED K-to-12 transition support',
        'International student recruitment from ASEAN markets as Philippine HEIs gain global recognition',
        'Research commercialisation and technology transfer opportunities through DOST programs',
      ],
      threats: [
        'Declining K-12 SHS pipeline due to demographic shifts in feeder communities',
        'Competition from online universities, foreign branch campuses, and micro-credential providers',
        'CHED regulatory changes (new CMOs, program closure orders) requiring costly program revisions',
        'Faculty attrition to industry and overseas employment reducing institutional knowledge depth',
      ],
    },

    strategies: {
      so: [
        'Leverage CoE recognition and alumni network to recruit international students and global partners',
        'Use research capacity to commercialise IP through DOST-funded technology transfer programs',
      ],
      st: [
        'Develop stackable micro-credential programs to compete with online and non-traditional providers',
        'Build faculty development pipeline to address attrition through CHED-funded graduate scholarships',
      ],
      wo: [
        'Apply for CHED grants to upgrade laboratory facilities, digital infrastructure, and faculty qualifications',
        'Establish industry advisory councils to align curriculum with real-time labour market needs',
      ],
      wt: [
        'Diversify enrollment base through online programs to buffer against local demographic decline',
        'Build flexible credit recognition policies to attract returning learners and retain at-risk students',
      ],
    },

    kpis: [
      { perspective: 'financial', kpi: 'Revenue per Student Enrolled',               target: '₱85,000', unit: '₱' },
      { perspective: 'financial', kpi: 'Research Grant Revenue',                     target: '₱5M',     unit: '₱' },
      { perspective: 'customer',  kpi: 'Graduate Employment Rate (within 6 months)', target: '92%',     unit: '%' },
      { perspective: 'customer',  kpi: 'Student Satisfaction Score',                 target: '85%',     unit: '%' },
      { perspective: 'internal',  kpi: 'Research Output (ISI / Scopus publications)', target: '45',     unit: 'pubs' },
      { perspective: 'internal',  kpi: 'Program Accreditation Level (AACCUP)',        target: 'Level 3', unit: '' },
      { perspective: 'learning',  kpi: 'Faculty with Doctoral Degree',               target: '65%',     unit: '%' },
      { perspective: 'learning',  kpi: 'Faculty with CHED-funded Scholarship',       target: '20%',     unit: '%' },
    ],

    initiatives: [
      { name: 'Online Learning Platform Deployment',     type: 'project' },
      { name: 'Industry Linkage & OJT Enhancement Program', type: 'program' },
      { name: 'Research Excellence & Publication Initiative', type: 'activity' },
      { name: 'Campus Infrastructure Modernisation',     type: 'project' },
      { name: 'Faculty Development & Doctoral Scholarship Program', type: 'activity' },
    ],
  },

  // ── 5. Digital Transformation Roadmap ──────────────────────
  {
    name:        'Digital Transformation Roadmap',
    industry:    'technology',
    emoji:       '🔄',
    description: 'Enterprise IT modernisation and digitalization strategy with phased implementation plan and change management integration.',
    isBuiltIn:   true,
    isPublic:    true,

    swotItems: {
      strengths: [
        'Executive commitment secured with digital transformation budget formally approved',
        'Existing ERP foundation providing integration pathways for new digital platforms',
        'Skilled change management team with prior large-scale transformation experience',
        'Strong customer relationships providing stability during transition period',
      ],
      weaknesses: [
        'Legacy monolithic systems with high technical debt slowing integration and innovation',
        'Low digital literacy among frontline staff requiring significant upskilling investment',
        'Data silos across business units preventing enterprise-wide analytics and reporting',
        'Shadow IT proliferation creating security vulnerabilities and integration complexity',
      ],
      opportunities: [
        'Cloud-native platforms reducing infrastructure cost by 30–40% and enabling elastic capacity',
        'AI-powered process automation eliminating 25–35% of manual, low-value tasks',
        'Open banking / open data ecosystems enabling new data-driven business models and partnerships',
        'Government digitalization mandates creating co-funding and market expansion opportunities',
      ],
      threats: [
        'Cybersecurity risks expanding dramatically with broader digital attack surface',
        'Vendor lock-in to legacy systems creating high switching costs and transition risk',
        'Regulatory data sovereignty and privacy requirements adding compliance complexity',
        'Change fatigue and employee resistance undermining adoption and ROI realisation',
      ],
    },

    strategies: {
      so: [
        'Accelerate cloud migration using approved budget and executive mandate before competitive pressure intensifies',
        'Leverage existing ERP foundation to fast-track AI automation of high-volume manual processes',
      ],
      st: [
        'Build zero-trust security architecture from day one of transformation, not as an afterthought',
        'Adopt open-standards API architecture to prevent vendor lock-in and reduce switching costs',
      ],
      wo: [
        'Launch digital upskilling academy before systems go live to reduce change resistance and adoption delays',
        'Implement enterprise data governance framework to break silos and enable AI/analytics use cases',
      ],
      wt: [
        'Establish a phased migration plan with clear rollback procedures to manage cybersecurity exposure during transition',
        'Create transformation communication and engagement programme to pre-empt change fatigue',
      ],
    },

    kpis: [
      { perspective: 'financial', kpi: 'IT Operating Cost Reduction',             target: '25%',   unit: '%' },
      { perspective: 'financial', kpi: 'ROI from Automation (annual FTE savings)', target: '₱8M',  unit: '₱' },
      { perspective: 'customer',  kpi: 'Digital Channel Adoption Rate',           target: '75%',   unit: '%' },
      { perspective: 'customer',  kpi: 'Digital Service Customer Satisfaction',   target: '88%',   unit: '%' },
      { perspective: 'internal',  kpi: 'Process Automation Coverage',             target: '50%',   unit: '%' },
      { perspective: 'internal',  kpi: 'System Downtime (monthly)',               target: '<2 hrs', unit: 'hrs' },
      { perspective: 'learning',  kpi: 'Staff Digital Literacy Score',            target: '80/100', unit: 'score' },
      { perspective: 'learning',  kpi: 'Change Readiness Index',                  target: '75%',   unit: '%' },
    ],

    initiatives: [
      { name: 'Cloud Migration Programme (Phase 1 & 2)', type: 'program' },
      { name: 'Enterprise Data Platform Build',           type: 'project' },
      { name: 'Digital Upskilling Academy',               type: 'activity' },
      { name: 'Cybersecurity Zero-Trust Implementation',  type: 'project' },
      { name: 'Process Automation (RPA / AI)',            type: 'program' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
// HELPER QUERY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * helpers
 * ────────
 * Reusable query functions used across routes.js.
 * Centralised here to avoid duplicated DB logic across route handlers
 * and to make the access control patterns testable in isolation.
 *
 * All functions are async and return Promises.
 * All functions handle null/missing records gracefully.
 */
const helpers = {

  /**
   * findUserByEmail(email)
   * ─────────────────────
   * Case-insensitive email lookup with trim.
   * Used in: routes.js POST /api/auth/login, /api/auth/register,
   *          routes.js POST /api/plans/:id/share
   *
   * @param  {string} email
   * @returns {Promise<object|null>} User doc including password hash, or null
   */
  findUserByEmail(email) {
    return db.users.findOne({ email: email.toLowerCase().trim() });
  },

  /**
   * findPlanWithAccess(planId, userId)
   * ──────────────────────────────────
   * Checks whether userId has any access to planId, and returns
   * both the plan doc and the caller's effective role.
   *
   * Access hierarchy:
   *   1. Plan owner → role: 'admin'  (highest — can delete plan)
   *   2. plan_members entry → role from that record
   *   3. No access → returns null
   *
   * Used in: routes.js GET /api/plans/:id, and all section GETs
   *          (swot, strategies, kpis, initiatives, comments, activity)
   *
   * @param  {string} planId
   * @param  {string} userId
   * @returns {Promise<{ plan: object, role: string }|null>}
   */
  async findPlanWithAccess(planId, userId) {
    const plan = await db.plans.findOne({ _id: planId, isDeleted: { $ne: true } });
    if (!plan) return null;

    // Owner always has admin role regardless of plan_members entries
    if (plan.ownerId === userId) return { plan, role: 'admin' };

    // Check explicit sharing
    const member = await db.planMembers.findOne({ planId, userId });
    if (!member) return null;

    return { plan, role: member.role };
  },

  /**
   * getUserPlans(userId)
   * ────────────────────
   * Returns all non-deleted plans accessible to userId,
   * split into owned and shared for the plan selector UI.
   *
   * Called by: routes.js GET /api/plans
   *
   * ⚠ Performance note: makes 3 sequential DB calls.
   * At NeDB scale (<100 organisations) this is acceptable.
   * Index on plans.ownerId and planMembers.userId reduces scan cost.
   *
   * @param  {string} userId
   * @returns {Promise<{ owned: object[], shared: object[] }>}
   */
  async getUserPlans(userId) {
    // Plans the user created
    const owned = await db.plans.find({
      ownerId:   userId,
      isDeleted: { $ne: true },
    });

    // Plans shared with the user (via plan_members)
    const memberships = await db.planMembers.find({ userId });
    const sharedIds   = memberships.map(m => m.planId);
    const shared      = sharedIds.length
      ? await db.plans.find({ _id: { $in: sharedIds }, isDeleted: { $ne: true } })
      : [];

    return { owned, shared };
  },

  /**
   * getPlanRole(userId, planId)
   * ───────────────────────────
   * Returns the caller's role string for a given plan, or null if no access.
   * Used on all write routes (POST/PATCH/DELETE) to enforce:
   *   - 'viewer' → 403 (cannot mutate)
   *   - 'editor' / 'admin' → proceed
   *   - null → 403 (no access at all)
   *
   * Called by: routes.js before every plan-scoped write operation
   *
   * @param  {string} userId
   * @param  {string} planId
   * @returns {Promise<string|null>}  'viewer' | 'editor' | 'admin' | null
   */
  async getPlanRole(userId, planId) {
    const plan = await db.plans.findOne({ _id: planId, isDeleted: { $ne: true } });
    if (!plan) return null;

    // Owner always has admin
    if (plan.ownerId === userId) return 'admin';

    const member = await db.planMembers.findOne({ userId, planId });
    return member ? member.role : null;
  },

  /**
   * getOrgRole(userId, orgId)
   * ─────────────────────────
   * Returns the caller's membership role within an organisation, or null.
   * Used on org-scoped write routes (invite, create) to enforce:
   *   - 'viewer' → 403 (cannot invite or modify)
   *   - 'editor' / 'admin' → proceed
   *   - null → 403 (not a member)
   *
   * Called by: routes.js GET/POST /api/orgs/:id/members
   *            routes.js POST /api/orgs/:id/invite
   *
   * @param  {string} userId
   * @param  {string} orgId
   * @returns {Promise<string|null>}  'viewer' | 'editor' | 'admin' | null
   */
  async getOrgRole(userId, orgId) {
    const member = await db.orgMembers.findOne({ userId, orgId });
    return member ? member.role : null;
  },

  /**
   * logActivity(data)
   * ─────────────────
   * Appends one record to activity_log.db. Called after every
   * significant mutation in routes.js (fire-and-forget, no await needed
   * in non-critical paths, but awaited in routes.js for correctness).
   *
   * The log is immutable — records are never updated or deleted.
   * Returns the inserted doc with its auto-generated _id and createdAt.
   *
   * @param  {object} data
   * @param  {string} data.userId
   * @param  {string} data.userEmail
   * @param  {string} data.userName
   * @param  {string} [data.planId]
   * @param  {string} data.action        e.g. 'added_swot_item'
   * @param  {string} [data.entityType]  e.g. 'swot'
   * @param  {string} [data.entityId]
   * @param  {string} [data.details]     Human-readable description
   * @param  {string} [data.ipAddress]   req.ip
   * @returns {Promise<object>}  Inserted activity_log doc
   */
  logActivity(data) {
    return db.activityLog.insert({
      userId:     data.userId,
      userEmail:  data.userEmail,
      userName:   data.userName,
      planId:     data.planId     || null,
      action:     data.action,
      entityType: data.entityType || null,
      entityId:   data.entityId   || null,
      details:    data.details    || null,
      ipAddress:  data.ipAddress  || null,
    });
  },

  /**
   * createNotification(data)
   * ────────────────────────
   * Creates an in-app notification for a specific user.
   * Called from routes.js after:
   *   - POST /api/plans/:id/share  → notify target user
   *   - POST /api/plans/:planId/comments → notify plan owner
   *
   * After insert, the caller in routes.js also calls:
   *   ws.pushToUser(data.userId, { type: 'NOTIFICATION', payload: ... })
   * to deliver the notification in real-time if the user is online.
   *
   * @param  {object} data
   * @param  {string} data.userId       Notification recipient
   * @param  {string} data.type         'invite'|'comment'|'share'|'mention'|'kpi_alert'
   * @param  {string} data.title        Short heading
   * @param  {string} data.message      Full body text
   * @param  {string} [data.planId]
   * @param  {string} [data.entityId]
   * @param  {string} [data.actionUrl]  Relative URL for click-through
   * @returns {Promise<object>}  Inserted notification doc
   */
  createNotification(data) {
    return db.notifications.insert({
      userId:    data.userId,
      type:      data.type,
      title:     data.title,
      message:   data.message,
      planId:    data.planId    || null,
      entityId:  data.entityId  || null,
      actionUrl: data.actionUrl || null,
      read:      false,
    });
  },
};

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = { db, ensureIndexes, seed, helpers };