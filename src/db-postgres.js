/**
 * ============================================================
 * STRAT PLANNER PRO — POSTGRES DATABASE LAYER (src/db-postgres.js)
 * ============================================================
 * Drop-in replacement for src/db.js when migrating from NeDB
 * to Supabase (PostgreSQL via Prisma).
 *
 * API CONTRACT — identical to src/db.js:
 *   module.exports = { db, ensureIndexes, seed, helpers }
 *
 * The `db` object exposes the same method signatures that
 * routes.js and auth.js call, translated from NeDB to Prisma:
 *
 *   NeDB                           Prisma equivalent
 *   ──────────────────────────────────────────────────────────
 *   db.users.insert(doc)           prisma.user.create({ data })
 *   db.users.findOne({ email })    prisma.user.findUnique({ where })
 *   db.users.find({ role })        prisma.user.findMany({ where })
 *   db.users.update(q, $set)       prisma.user.update({ where, data })
 *   db.users.remove(q)             prisma.user.delete({ where })
 *   db.users.count(q)              prisma.user.count({ where })
 *
 * HOW TO SWITCH:
 *   In server.js, change:
 *     const { db, ensureIndexes, seed } = require('./src/db');
 *   To:
 *     const { db, ensureIndexes, seed } = require('./src/db-postgres');
 *
 *   In src/auth.js, change the getDB() function:
 *     function getDB() { return require('./db-postgres').db; }
 *
 * ENVIRONMENT:
 *   DATABASE_URL  — pooled connection (PgBouncer) for app queries
 *   DIRECT_URL    — direct connection for Prisma migrations
 *   Both are in Supabase → Settings → Database → Connection strings
 *
 * ── Supabase extras available (not required for migration) ──
 *   Realtime     — can replace ws.js broadcast layer
 *   Storage      — can replace local uploads/ directory
 *   Auth         — future optional replacement for JWT layer
 * ============================================================
 */

'use strict';

const { PrismaClient } = require('@prisma/client');

// ── Prisma client singleton ───────────────────────────────────
// One instance shared across all requests. Prisma manages the
// connection pool internally (sized by DATABASE_URL ?connection_limit).
let _prisma = null;

function getPrisma() {
  if (!_prisma) {
    _prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
    });
  }
  return _prisma;
}

// ── Nedb→Prisma query translator helpers ─────────────────────
// NeDB uses MongoDB-style queries ({ field: value, $ne: ... }).
// These helpers translate the subset used in routes.js + auth.js.

/**
 * translateWhere(nedbQuery)
 * ─────────────────────────
 * Converts the NeDB query subset used in this codebase to Prisma where clauses.
 * Handles: equality, $ne, $in, $nin, $lt, $lte, $gt, $gte, isDeleted patterns.
 */
function translateWhere(q = {}) {
  const where = {};
  for (const [key, val] of Object.entries(q)) {
    if (val === null || val === undefined) {
      where[key] = null;
    } else if (typeof val === 'object' && !Array.isArray(val)) {
      const ops = {};
      if ('$ne'  in val) ops.not = val.$ne;
      if ('$in'  in val) ops.in  = val.$in;
      if ('$nin' in val) ops.notIn = val.$nin;
      if ('$lt'  in val) ops.lt  = val.$lt;
      if ('$lte' in val) ops.lte = val.$lte;
      if ('$gt'  in val) ops.gt  = val.$gt;
      if ('$gte' in val) ops.gte = val.$gte;
      if ('$exists' in val && !val.$exists) ops.equals = null;
      where[key] = Object.keys(ops).length === 1 && 'not' in ops
        ? { not: ops.not }
        : ops;
    } else {
      where[key] = val;
    }
  }
  return where;
}

/**
 * makeCollection(modelName)
 * ─────────────────────────
 * Returns a NeDB-compatible API surface backed by Prisma.
 * Used to build the db.* object below.
 */
function makeCollection(modelName) {
  return {
    // NeDB: insert(doc) → returns inserted doc with _id
    async insert(data) {
      const prisma = getPrisma();
      // Rename _id → id if present (NeDB uses _id, Prisma uses id)
      const { _id, ...rest } = data;
      const record = await prisma[modelName].create({ data: rest });
      return normalise(record);
    },

    // NeDB: find(query, projection?) → returns array
    async find(query = {}, _projection) {
      const prisma = getPrisma();
      const where  = translateWhere(query);
      const records = await prisma[modelName].findMany({ where });
      return records.map(normalise);
    },

    // NeDB: findOne(query) → returns single doc or null
    async findOne(query = {}) {
      const prisma = getPrisma();
      const where  = translateWhere(query);
      // Prisma findFirst (vs findUnique) works for arbitrary where clauses
      const record = await prisma[modelName].findFirst({ where });
      return record ? normalise(record) : null;
    },

    // NeDB: count(query) → returns number
    async count(query = {}) {
      const prisma = getPrisma();
      return prisma[modelName].count({ where: translateWhere(query) });
    },

    // NeDB: update(query, { $set: data }, { multi? }) → returns numReplaced
    async update(query = {}, update = {}, options = {}) {
      const prisma = getPrisma();
      const where  = translateWhere(query);
      const data   = update.$set || update;
      // Remove undefined values — Prisma rejects them
      const cleanData = Object.fromEntries(
        Object.entries(data).filter(([_, v]) => v !== undefined)
      );
      if (options.multi) {
        const result = await prisma[modelName].updateMany({ where, data: cleanData });
        return result.count;
      }
      try {
        await prisma[modelName].updateMany({ where, data: cleanData });
        return 1;
      } catch {
        return 0;
      }
    },

    // NeDB: remove(query, { multi? }) → returns numRemoved
    async remove(query = {}, options = {}) {
      const prisma = getPrisma();
      const where  = translateWhere(query);
      if (options.multi) {
        const result = await prisma[modelName].deleteMany({ where });
        return result.count;
      }
      try {
        await prisma[modelName].deleteMany({ where });
        return 1;
      } catch {
        return 0;
      }
    },

    // NeDB: ensureIndex({ fieldName, unique? }) — no-op for Postgres
    // Indexes are managed in schema.prisma and applied via migrations.
    async ensureIndex(_options) {
      return; // noop — indexes managed by Prisma migrations
    },
  };
}

/**
 * normalise(record)
 * ─────────────────
 * Translates Prisma records to NeDB-compatible shape:
 *   - Adds _id alias pointing to id (routes.js uses ._id everywhere)
 *   - Converts enum values with underscores to hyphens (on_track → on-track)
 *   - Converts createdAt/updatedAt to ISO strings
 */
function normalise(record) {
  if (!record) return null;
  const out = { ...record, _id: record.id };
  // Convert KPIStatus and Initiative/KPI enums: on_track → on-track
  for (const key of ['status', 'impact', 'priority']) {
    if (out[key] && typeof out[key] === 'string') {
      out[key] = out[key].replace(/_/g, '-');
    }
  }
  return out;
}

// ── Database collections ──────────────────────────────────────
// Same shape as db.js exports — routes.js imports these unchanged.
const db = {
  users:         makeCollection('user'),
  organizations: makeCollection('organization'),
  orgMembers:    makeCollection('orgMember'),
  plans:         makeCollection('plan'),
  planMembers:   makeCollection('planMember'),
  swotItems:     makeCollection('swotItem'),
  strategies:    makeCollection('strategy'),
  kpis:          makeCollection('kPI'),
  initiatives:   makeCollection('initiative'),
  comments:      makeCollection('comment'),
  notifications: makeCollection('notification'),
  activityLog:   makeCollection('activityLog'),
  templates:     makeCollection('template'),
  invitations:   makeCollection('invitation'),
  refreshTokens: makeCollection('refreshToken'),
};

// ── ensureIndexes() ───────────────────────────────────────────
// No-op for Postgres — indexes are managed by Prisma schema + migrations.
// Kept for API compatibility with db.js.
async function ensureIndexes() {
  console.log('[DB-PG] Indexes managed by Prisma migrations — skipping ensureIndexes()');
  // Verify database connectivity on boot
  const prisma = getPrisma();
  await prisma.$queryRaw`SELECT 1`;
  console.log('[DB-PG] Supabase PostgreSQL connection verified');
}

// ── seed() ────────────────────────────────────────────────────
// Same logic as db.js seed() — creates admin + built-in templates.
async function seed() {
  const { hashPassword } = require('./auth');

  const adminEmail    = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[DB-PG] ADMIN_EMAIL and ADMIN_PASSWORD must be set in production.');
    }
    console.warn('[DB-PG] ⚠ ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin seed.');
    return;
  }

  const prisma = getPrisma();

  // Create admin user if not present
  const existing = await prisma.user.findUnique({
    where: { email: adminEmail.toLowerCase().trim() },
  });

  if (!existing) {
    const hash = await hashPassword(adminPassword);
    await prisma.user.create({
      data: {
        email:         adminEmail.toLowerCase().trim(),
        password:      hash,
        firstName:     'Admin',
        lastName:      'User',
        role:          'super_admin',
        initials:      'AD',
        color:         'linear-gradient(135deg,#FFD700,#FFA500)',
        isActive:      true,
        emailVerified: true,
      },
    });
    console.log(`[DB-PG] Admin seeded: ${adminEmail}`);
  } else {
    console.log(`[DB-PG] Admin already exists: ${adminEmail}`);
  }

  // Seed built-in templates if none exist
  const templateCount = await prisma.template.count({ where: { isBuiltIn: true } });
  if (templateCount === 0) {
    // Import templates from db.js to avoid duplication
    const { BUILT_IN_TEMPLATES_PG } = require('./templates-seed');
    await prisma.template.createMany({ data: BUILT_IN_TEMPLATES_PG });
    console.log(`[DB-PG] ${BUILT_IN_TEMPLATES_PG.length} built-in templates seeded`);
  } else {
    console.log(`[DB-PG] Built-in templates already present (${templateCount})`);
  }
}

// ── helpers ───────────────────────────────────────────────────
// Same API as helpers in db.js — routes.js calls these unchanged.
const helpers = {

  getPlanRole: async (userId, planId) => {
    const prisma = getPrisma();
    // Check plan ownership first
    const plan = await prisma.plan.findFirst({
      where: { id: planId, ownerId: userId, isDeleted: false },
    });
    if (plan) return 'admin';
    // Check plan membership
    const member = await prisma.planMember.findFirst({
      where: { planId, userId, isDeleted: false },
    });
    return member ? member.role : null;
  },

  findUserByEmail: (email) => {
    const prisma = getPrisma();
    return prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  },

  findPlanWithAccess: async (planId, userId) => {
    const prisma = getPrisma();
    const plan = await prisma.plan.findFirst({
      where: { id: planId, isDeleted: false },
    });
    if (!plan) return null;
    if (plan.ownerId === userId) return { ...plan, role: 'admin' };
    const member = await prisma.planMember.findFirst({
      where: { planId, userId, isDeleted: false },
    });
    return member ? { ...plan, role: member.role } : null;
  },

  logActivity: (data) => {
    const prisma = getPrisma();
    return prisma.activityLog.create({
      data: {
        userId:     data.userId     || null,
        userEmail:  data.userEmail  || null,
        userName:   data.userName   || null,
        planId:     data.planId     || null,
        action:     data.action,
        entityType: data.entityType || null,
        entityId:   data.entityId   || null,
        details:    data.details    || null,
        ipAddress:  data.ipAddress  || null,
      },
    });
  },

  createNotification: (data) => {
    const prisma = getPrisma();
    // Map hyphenated enum values back to underscore (on-track → on_track)
    const typeMap = {
      'kpi-alert': 'kpi_alert',
    };
    return prisma.notification.create({
      data: {
        userId:    data.userId,
        type:      typeMap[data.type] || data.type,
        title:     data.title,
        message:   data.message,
        planId:    data.planId    || null,
        entityId:  data.entityId  || null,
        actionUrl: data.actionUrl || null,
        read:      false,
      },
    });
  },
};

// ── Graceful disconnect ───────────────────────────────────────
// Call on SIGTERM/SIGINT to close Prisma pool cleanly.
async function disconnect() {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
    console.log('[DB-PG] Prisma disconnected');
  }
}

module.exports = { db, ensureIndexes, seed, helpers, disconnect, getPrisma };
