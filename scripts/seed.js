/**
 * ============================================================
 * STRAT PLANNER PRO — MANUAL SEED SCRIPT
 * ============================================================
 * Run: npm run seed
 *
 * Safe to run multiple times — all inserts are idempotent:
 *   - Admin user: only created if email not already in users.db
 *   - Built-in templates: only inserted if count === 0
 *   - Indexes: ensureIndex is a no-op if index already exists
 *
 * Reads from:   src/db.js  (collections, helpers, BUILT_IN_TEMPLATES)
 * Reads from:   src/auth.js (hashPassword)
 * Writes to:    data/users.db, data/templates.db (via NeDB)
 *
 * Called automatically on server startup via server.js:
 *   await ensureIndexes();
 *   await seed();
 *
 * This script is for manual re-seeding without starting the full server.
 * ============================================================
 */

'use strict';

require('dotenv').config();

const path = require('path');

// Resolve src/ from scripts/ directory
const { db, ensureIndexes, seed } = require(path.join(__dirname, '..', 'src', 'db'));

async function run() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     STRAT PLANNER PRO — DB SEED        ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('[SEED] Environment:', process.env.NODE_ENV || 'development');
  console.log('[SEED] DB path:', process.env.DB_PATH || './data');
  console.log('[SEED] Admin email:', process.env.ADMIN_EMAIL || '(using default — set ADMIN_EMAIL in .env)');

  try {
    // Step 1: Ensure all NeDB indexes exist across all 15 collections
    console.log('\n[SEED] Step 1/3 — Ensuring indexes...');
    await ensureIndexes();

    // Step 2: Seed admin user + built-in templates
    console.log('[SEED] Step 2/3 — Seeding admin user + templates...');
    await seed();

    // Step 3: Report current record counts across all collections
    console.log('[SEED] Step 3/3 — Verifying record counts...');
    const counts = await Promise.all([
      db.users.count({}),
      db.organizations.count({}),
      db.orgMembers.count({}),
      db.plans.count({}),
      db.planMembers.count({}),
      db.swotItems.count({}),
      db.strategies.count({}),
      db.kpis.count({}),
      db.initiatives.count({}),
      db.comments.count({}),
      db.notifications.count({}),
      db.activityLog.count({}),
      db.templates.count({}),
      db.invitations.count({}),
      db.refreshTokens.count({}),
    ]);

    const collections = [
      'users', 'organizations', 'org_members', 'plans', 'plan_members',
      'swot_items', 'strategies', 'kpis', 'initiatives', 'comments',
      'notifications', 'activity_log', 'templates', 'invitations', 'refresh_tokens',
    ];

    console.log('\n[SEED] ── Collection record counts ──────────────');
    collections.forEach((name, i) => {
      const padded = name.padEnd(20);
      const count  = String(counts[i]).padStart(4);
      const bar    = '█'.repeat(Math.min(counts[i], 20));
      console.log(`[SEED]   ${padded}  ${count}  ${bar}`);
    });

    console.log('\n[SEED] ✅ Seed complete.\n');
    process.exit(0);

  } catch (err) {
    // In production build phase (Heroku slug compilation), config vars
    // are not yet available — ADMIN_EMAIL/ADMIN_PASSWORD will be missing.
    // This is expected: the heroku-postbuild hook runs after config vars
    // are injected and will complete the seed successfully at that point.
    // We treat a missing-credentials error as a warning here, not fatal.
    const isMissingCreds = err.message && (
      err.message.includes('ADMIN_EMAIL') ||
      err.message.includes('ADMIN_PASSWORD')
    );
    if (isMissingCreds) {
      console.warn('\n[SEED] ⚠  Skipping admin seed — config vars not yet available.');
      console.warn('[SEED]    Set ADMIN_EMAIL and ADMIN_PASSWORD in Heroku Config Vars.');
      console.warn('[SEED]    The seed will complete on next dyno start.\n');
      process.exit(0); // exit 0 so Heroku build does not fail
    }
    console.error('\n[SEED] ❌ Fatal error during seed:', err);
    process.exit(1);
  }
}

run();
