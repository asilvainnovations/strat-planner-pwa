#!/usr/bin/env node
/**
 * ============================================================
 * STRAT PLANNER PRO — NeDB → Supabase Migration Script
 * scripts/migrate-nedb-to-supabase.js
 * ============================================================
 * One-shot migration that reads all 15 NeDB .db files and
 * inserts their documents into Supabase PostgreSQL via Prisma.
 *
 * Run ONCE on first deployment after:
 *   1. Setting DATABASE_URL and DIRECT_URL in .env
 *   2. Running: npx prisma migrate deploy
 *   3. Running: node scripts/migrate-nedb-to-supabase.js
 *
 * Safe to re-run — uses upsert to avoid duplicate errors.
 * All NeDB _id values are preserved as Postgres id values
 * so all foreign key references remain intact.
 *
 * Order matters — tables with foreign keys must be inserted
 * after the tables they reference:
 *   users → organizations → org_members
 *   users → plans → plan_members
 *   plans → swot_items, strategies, kpis, initiatives, comments
 *   users → notifications, activity_log, refresh_tokens
 *   users → templates
 *   organizations → invitations
 * ============================================================
 */

'use strict';

require('dotenv').config();

const fs         = require('fs');
const path       = require('path');
const readline   = require('readline');
const { PrismaClient } = require('@prisma/client');

const prisma  = new PrismaClient({ log: ['warn', 'error'] });
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data');

// ── Helpers ───────────────────────────────────────────────────

/** Read a NeDB .db file, return array of parsed JSON documents */
function readCollection(name) {
  const file = path.join(DB_PATH, `${name}.db`);
  if (!fs.existsSync(file)) {
    console.warn(`  [SKIP] ${name}.db not found — skipping`);
    return [];
  }
  const lines = fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean);
  const docs = [];
  for (const line of lines) {
    try {
      const doc = JSON.parse(line);
      if (!doc.$$deleted) docs.push(doc); // NeDB marks deleted docs with $$deleted
    } catch {
      // skip malformed lines (partial writes from crashes)
    }
  }
  return docs;
}

/** Map NeDB _id → Prisma id, strip NeDB internals */
function mapId(doc) {
  const { _id, __v, $$deleted, ...rest } = doc;
  return { id: _id, ...rest };
}

/** Convert hyphenated enum values to underscore (on-track → on_track) */
function fixEnum(val) {
  return val ? val.replace(/-/g, '_') : val;
}

/** Log migration step with count */
function log(collection, count, skipped = 0) {
  const skip = skipped > 0 ? ` (${skipped} skipped)` : '';
  console.log(`  ✓ ${collection.padEnd(18)} ${String(count).padStart(4)} records${skip}`);
}

// ── Migration steps ───────────────────────────────────────────

async function migrateUsers() {
  const docs = readCollection('users');
  let count = 0, skipped = 0;
  for (const doc of docs) {
    const data = mapId(doc);
    // Remove NeDB timestamp meta if present
    delete data.createdAt;
    delete data.updatedAt;
    // Normalise role enum
    data.role = data.role === 'super_admin' ? 'super_admin' : 'user';
    try {
      await prisma.user.upsert({
        where:  { id: data.id },
        update: {},              // don't overwrite on re-run
        create: {
          id:                  data.id,
          email:               data.email?.toLowerCase().trim() || '',
          password:            data.password || '',
          firstName:           data.firstName || 'Unknown',
          lastName:            data.lastName  || 'Unknown',
          role:                data.role,
          initials:            data.initials  || 'UU',
          color:               data.color     || 'linear-gradient(135deg,#3B82F6,#06B6D4)',
          isActive:            data.isActive  ?? true,
          emailVerified:       data.emailVerified ?? false,
          failedLoginAttempts: data.failedLoginAttempts ?? 0,
          lockedUntil:         data.lockedUntil ? new Date(data.lockedUntil) : null,
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] user ${data.id}: ${e.message}`); skipped++; }
  }
  log('users', count, skipped);
}

async function migrateOrganizations() {
  const docs = readCollection('organizations');
  let count = 0, skipped = 0;
  for (const doc of docs) {
    const data = mapId(doc);
    try {
      await prisma.organization.upsert({
        where:  { id: data.id },
        update: {},
        create: {
          id:          data.id,
          name:        data.name || 'Unnamed Organisation',
          type:        data.type        || null,
          description: data.description || null,
          ownerId:     data.ownerId,
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] org ${data.id}: ${e.message}`); skipped++; }
  }
  log('organizations', count, skipped);
}

async function migrateOrgMembers() {
  const docs = readCollection('org_members');
  let count = 0, skipped = 0;
  for (const doc of docs) {
    const data = mapId(doc);
    try {
      await prisma.orgMember.upsert({
        where:  { orgId_userId: { orgId: data.orgId, userId: data.userId } },
        update: {},
        create: {
          id:        data.id,
          orgId:     data.orgId,
          userId:    data.userId,
          role:      data.role || 'viewer',
          invitedBy: data.invitedBy || null,
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] orgMember ${data.id}: ${e.message}`); skipped++; }
  }
  log('org_members', count, skipped);
}

async function migratePlans() {
  const docs = readCollection('plans');
  let count = 0, skipped = 0;
  for (const doc of docs) {
    const data = mapId(doc);
    try {
      await prisma.plan.upsert({
        where:  { id: data.id },
        update: {},
        create: {
          id:          data.id,
          name:        data.name || 'Unnamed Plan',
          orgId:       data.orgId       || null,
          ownerId:     data.ownerId,
          period:      data.period      || null,
          description: data.description || null,
          isDeleted:   data.isDeleted   ?? false,
          deletedAt:   data.deletedAt   ? new Date(data.deletedAt) : null,
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] plan ${data.id}: ${e.message}`); skipped++; }
  }
  log('plans', count, skipped);
}

async function migratePlanMembers() {
  const docs = readCollection('plan_members');
  let count = 0, skipped = 0;
  for (const doc of docs) {
    const data = mapId(doc);
    try {
      await prisma.planMember.upsert({
        where:  { planId_userId: { planId: data.planId, userId: data.userId } },
        update: {},
        create: {
          id:        data.id,
          planId:    data.planId,
          userId:    data.userId,
          role:      data.role  || 'viewer',
          sharedBy:  data.sharedBy  || null,
          isDeleted: data.isDeleted ?? false,
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] planMember ${data.id}: ${e.message}`); skipped++; }
  }
  log('plan_members', count, skipped);
}

async function migrateSwotItems() {
  const docs = readCollection('swot_items');
  let count = 0, skipped = 0;
  for (const doc of docs) {
    const data = mapId(doc);
    const validCategories = ['strengths','weaknesses','opportunities','threats'];
    if (!validCategories.includes(data.category)) { skipped++; continue; }
    try {
      await prisma.swotItem.upsert({
        where:  { id: data.id },
        update: {},
        create: {
          id:        data.id,
          planId:    data.planId,
          category:  data.category,
          text:      data.text || '',
          evidence:  data.evidence  || null,
          impact:    fixEnum(data.impact) || 'medium',
          ownerId:   data.ownerId,
          isDeleted: data.isDeleted ?? false,
          deletedAt: data.deletedAt ? new Date(data.deletedAt) : null,
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] swotItem ${data.id}: ${e.message}`); skipped++; }
  }
  log('swot_items', count, skipped);
}

async function migrateStrategies() {
  const docs = readCollection('strategies');
  let count = 0, skipped = 0;
  for (const doc of docs) {
    const data = mapId(doc);
    const validTypes = ['so','st','wo','wt'];
    if (!validTypes.includes(data.type)) { skipped++; continue; }
    try {
      await prisma.strategy.upsert({
        where:  { id: data.id },
        update: {},
        create: {
          id:        data.id,
          planId:    data.planId,
          type:      data.type,
          text:      data.text || '',
          priority:  fixEnum(data.priority) || 'medium',
          ownerId:   data.ownerId,
          isDeleted: data.isDeleted ?? false,
          deletedAt: data.deletedAt ? new Date(data.deletedAt) : null,
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] strategy ${data.id}: ${e.message}`); skipped++; }
  }
  log('strategies', count, skipped);
}

async function migrateKPIs() {
  const docs = readCollection('kpis');
  let count = 0, skipped = 0;
  const validPerspectives = ['financial','customer','internal','learning'];
  for (const doc of docs) {
    const data = mapId(doc);
    const perspective = validPerspectives.includes(data.perspective)
      ? data.perspective : 'financial';
    try {
      await prisma.kPI.upsert({
        where:  { id: data.id },
        update: {},
        create: {
          id:          data.id,
          planId:      data.planId,
          perspective,
          kpi:         data.kpi    || 'Unnamed KPI',
          target:      data.target || '0',
          actual:      data.actual || null,
          unit:        data.unit   || null,
          status:      fixEnum(data.status) || 'on_track',
          weight:      data.weight ?? null,
          ownerId:     data.ownerId,
          isDeleted:   data.isDeleted ?? false,
          deletedAt:   data.deletedAt ? new Date(data.deletedAt) : null,
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] kpi ${data.id}: ${e.message}`); skipped++; }
  }
  log('kpis', count, skipped);
}

async function migrateInitiatives() {
  const docs = readCollection('initiatives');
  let count = 0, skipped = 0;
  for (const doc of docs) {
    const data = mapId(doc);
    const validTypes = ['program','activity','project'];
    try {
      await prisma.initiative.upsert({
        where:  { id: data.id },
        update: {},
        create: {
          id:        data.id,
          planId:    data.planId,
          name:      data.name || 'Unnamed Initiative',
          type:      validTypes.includes(data.type) ? data.type : 'program',
          owner:     data.owner    || null,
          budget:    data.budget   ?? null,
          utilized:  data.utilized ?? null,
          progress:  Math.min(100, Math.max(0, data.progress || 0)),
          status:    fixEnum(data.status) || 'on_track',
          dueDate:   data.dueDate  ? new Date(data.dueDate) : null,
          ownerId:   data.ownerId,
          isDeleted: data.isDeleted ?? false,
          deletedAt: data.deletedAt ? new Date(data.deletedAt) : null,
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] initiative ${data.id}: ${e.message}`); skipped++; }
  }
  log('initiatives', count, skipped);
}

async function migrateComments() {
  const docs = readCollection('comments');
  let count = 0, skipped = 0;
  for (const doc of docs) {
    const data = mapId(doc);
    try {
      await prisma.comment.upsert({
        where:  { id: data.id },
        update: {},
        create: {
          id:         data.id,
          planId:     data.planId,
          entityId:   data.entityId   || '',
          entityType: data.entityType || '',
          entityName: data.entityName || null,
          text:       data.text       || '',
          authorId:   data.authorId,
          authorName: data.authorName || '',
          resolved:   data.resolved   ?? false,
          resolvedBy: data.resolvedBy || null,
          isDeleted:  data.isDeleted  ?? false,
          deletedAt:  data.deletedAt  ? new Date(data.deletedAt) : null,
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] comment ${data.id}: ${e.message}`); skipped++; }
  }
  log('comments', count, skipped);
}

async function migrateNotifications() {
  const docs = readCollection('notifications');
  let count = 0, skipped = 0;
  const validTypes = ['invite','comment','share','mention','kpi_alert'];
  for (const doc of docs) {
    const data = mapId(doc);
    const type = fixEnum(data.type);
    const normType = validTypes.includes(type) ? type : 'mention';
    try {
      await prisma.notification.upsert({
        where:  { id: data.id },
        update: {},
        create: {
          id:        data.id,
          userId:    data.userId,
          type:      normType,
          title:     data.title   || 'Notification',
          message:   data.message || '',
          planId:    data.planId    || null,
          entityId:  data.entityId  || null,
          actionUrl: data.actionUrl || null,
          read:      data.read      ?? false,
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] notification ${data.id}: ${e.message}`); skipped++; }
  }
  log('notifications', count, skipped);
}

async function migrateActivityLog() {
  const docs = readCollection('activity_log');
  let count = 0, skipped = 0;
  for (const doc of docs) {
    const data = mapId(doc);
    try {
      await prisma.activityLog.upsert({
        where:  { id: data.id },
        update: {},
        create: {
          id:         data.id,
          userId:     data.userId     || null,
          userEmail:  data.userEmail  || null,
          userName:   data.userName   || null,
          planId:     data.planId     || null,
          action:     data.action     || 'unknown',
          entityType: data.entityType || null,
          entityId:   data.entityId   || null,
          details:    data.details    || null,
          ipAddress:  data.ipAddress  || null,
          createdAt:  data.createdAt  ? new Date(data.createdAt) : new Date(),
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] activity ${data.id}: ${e.message}`); skipped++; }
  }
  log('activity_log', count, skipped);
}

async function migrateTemplates() {
  const docs = readCollection('templates');
  let count = 0, skipped = 0;
  const validIndustries = ['government','healthcare','technology','education','finance','retail','manufacturing','ngos'];
  for (const doc of docs) {
    const data = mapId(doc);
    const industry = validIndustries.includes(data.industry) ? data.industry : 'technology';
    try {
      await prisma.template.upsert({
        where:  { id: data.id },
        update: {},
        create: {
          id:          data.id,
          name:        data.name || 'Template',
          industry,
          emoji:       data.emoji       || null,
          description: data.description || null,
          ownerId:     data.ownerId     || null,
          isBuiltIn:   data.isBuiltIn   ?? false,
          isPublic:    data.isPublic    ?? true,
          swotItems:   data.swotItems   ?? null,
          strategies:  data.strategies  ?? null,
          kpis:        data.kpis        ?? null,
          initiatives: data.initiatives ?? null,
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] template ${data.id}: ${e.message}`); skipped++; }
  }
  log('templates', count, skipped);
}

async function migrateInvitations() {
  const docs = readCollection('invitations');
  let count = 0, skipped = 0;
  for (const doc of docs) {
    const data = mapId(doc);
    try {
      await prisma.invitation.upsert({
        where:  { id: data.id },
        update: {},
        create: {
          id:          data.id,
          token:       data.token || data.id,
          orgId:       data.orgId,
          email:       data.email || '',
          role:        data.role  || 'viewer',
          invitedBy:   data.invitedBy,
          inviterName: data.inviterName || '',
          status:      data.status      || 'pending',
          expiresAt:   data.expiresAt   ? new Date(data.expiresAt) : new Date(Date.now() + 7*86400000),
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] invitation ${data.id}: ${e.message}`); skipped++; }
  }
  log('invitations', count, skipped);
}

async function migrateRefreshTokens() {
  const docs = readCollection('refresh_tokens');
  let count = 0, skipped = 0;
  for (const doc of docs) {
    const data = mapId(doc);
    // Skip expired tokens — no point migrating them
    if (data.expiresAt && new Date(data.expiresAt) < new Date()) { skipped++; continue; }
    try {
      await prisma.refreshToken.upsert({
        where:  { id: data.id },
        update: {},
        create: {
          id:        data.id,
          token:     data.token || data.id,
          userId:    data.userId,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + 30*86400000),
          used:      data.used ?? false,
        },
      });
      count++;
    } catch (e) { console.warn(`  [WARN] refreshToken ${data.id}: ${e.message}`); skipped++; }
  }
  log('refresh_tokens', count, skipped);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  STRAT PLANNER PRO — NeDB → Supabase      ║');
  console.log('╚════════════════════════════════════════════╝\n');

  // Verify Supabase connection
  console.log('Verifying Supabase connection...');
  try {
    await prisma.$queryRaw`SELECT version()`;
    console.log('✓ Connected to Supabase PostgreSQL\n');
  } catch (err) {
    console.error('✗ Cannot connect to Supabase:', err.message);
    console.error('  Check DATABASE_URL in your .env file');
    process.exit(1);
  }

  // Verify NeDB data directory
  if (!fs.existsSync(DB_PATH)) {
    console.error(`✗ NeDB data directory not found: ${DB_PATH}`);
    console.error('  Set DB_PATH in .env to point to your data/ directory');
    process.exit(1);
  }

  console.log(`Reading NeDB files from: ${DB_PATH}`);
  console.log('Migrating collections (order preserves FK constraints):\n');

  const start = Date.now();

  // Migration order: parents before children
  await migrateUsers();
  await migrateOrganizations();
  await migrateOrgMembers();
  await migratePlans();
  await migratePlanMembers();
  await migrateSwotItems();
  await migrateStrategies();
  await migrateKPIs();
  await migrateInitiatives();
  await migrateComments();
  await migrateNotifications();
  await migrateActivityLog();
  await migrateTemplates();
  await migrateInvitations();
  await migrateRefreshTokens();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n✅ Migration complete in ${elapsed}s`);
  console.log('\nNext steps:');
  console.log('  1. Verify record counts in Supabase Table Editor');
  console.log('  2. In server.js: change require("./src/db") → require("./src/db-postgres")');
  console.log('  3. In src/auth.js getDB(): return require("./db-postgres").db');
  console.log('  4. Run: npm run dev  and verify the app works');
  console.log('  5. Keep data/ directory as backup until confirmed working\n');
}

main()
  .catch((err) => {
    console.error('\n✗ Migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
