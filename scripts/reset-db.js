/**
 * ============================================================
 * STRAT PLANNER PRO — DATABASE RESET SCRIPT
 * ============================================================
 * Run: npm run db:reset
 *
 * ⚠ DESTRUCTIVE — wipes every .db file in data/ then re-seeds.
 * ⚠ Refuses to run when NODE_ENV=production.
 *
 * Intended for:
 *   - Development environment reset
 *   - CI/CD test-suite setup
 *   - Reproducing a clean slate before demos
 *
 * Reads from:   src/db.js  (collection names, ensureIndexes, seed)
 * Writes to:    data/*.db  (deletes then recreates)
 *
 * Collections wiped (15 total — matches data/ directory):
 *   users, organizations, org_members, plans, plan_members,
 *   swot_items, strategies, kpis, initiatives, comments,
 *   notifications, activity_log, templates, invitations,
 *   refresh_tokens
 * ============================================================
 */

'use strict';

require('dotenv').config();

// ── Safety gate ───────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  console.error('\n[RESET] ❌ Refused: NODE_ENV is "production".');
  console.error('[RESET]    This script is not safe to run in production.');
  console.error('[RESET]    Unset NODE_ENV or set it to "development" to proceed.\n');
  process.exit(1);
}

const path = require('path');
const fs   = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data');

// These must match the filename stems used in src/db.js store() calls
const DB_FILES = [
  'users',
  'organizations',
  'org_members',
  'plans',
  'plan_members',
  'swot_items',
  'strategies',
  'kpis',
  'initiatives',
  'comments',
  'notifications',
  'activity_log',
  'templates',
  'invitations',
  'refresh_tokens',
];

async function reset() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   STRAT PLANNER PRO — DB RESET  ⚠     ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('[RESET] Environment:', process.env.NODE_ENV || 'development');
  console.log('[RESET] DB path:', DB_PATH);
  console.log('[RESET] Files to wipe:', DB_FILES.length);

  // ── Step 1: Delete all .db files ─────────────────────
  console.log('\n[RESET] Step 1/3 — Wiping .db files...');

  let wiped = 0;
  let missing = 0;

  for (const name of DB_FILES) {
    const filePath = path.join(DB_PATH, `${name}.db`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[RESET]   ✓ Deleted ${name}.db`);
      wiped++;
    } else {
      console.log(`[RESET]   ─ Not found: ${name}.db (skipped)`);
      missing++;
    }

    // Also remove NeDB's journal/WAL companion files if present
    const walPath = filePath + '~';
    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }
  }

  console.log(`[RESET]   Wiped: ${wiped}  Not found: ${missing}`);

  // ── Step 2: Re-create the data directory if needed ───
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(DB_PATH, { recursive: true });
    console.log(`[RESET] Created directory: ${DB_PATH}`);
  }

  // ── Step 3: Re-seed fresh databases ──────────────────
  console.log('\n[RESET] Step 2/3 — Re-initialising collections...');

  // Import AFTER deletion so NeDB autoloads into fresh empty files
  const { db, ensureIndexes, seed } = require(path.join(__dirname, '..', 'src', 'db'));

  await ensureIndexes();
  console.log('[RESET]   Indexes created');

  console.log('[RESET] Step 3/3 — Seeding admin + built-in templates...');
  await seed();

  // ── Verify ───────────────────────────────────────────
  const [userCount, templateCount] = await Promise.all([
    db.users.count({}),
    db.templates.count({}),
  ]);

  console.log(`\n[RESET] Verification:`);
  console.log(`[RESET]   users.db     → ${userCount} record(s)`);
  console.log(`[RESET]   templates.db → ${templateCount} record(s)`);

  if (userCount === 0) {
    console.warn('[RESET] ⚠ No admin user was created.');
    console.warn('[RESET]   Set ADMIN_EMAIL and ADMIN_PASSWORD in your .env file.');
  }

  console.log('\n[RESET] ✅ Database reset complete.\n');
  process.exit(0);
}

reset().catch(err => {
  console.error('\n[RESET] ❌ Fatal error during reset:', err);
  process.exit(1);
});
