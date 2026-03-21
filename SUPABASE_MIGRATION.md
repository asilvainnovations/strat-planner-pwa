# NeDB → Supabase Migration Guide

## Why Supabase

NeDB is excellent for prototyping but has hard limits in production:

| Concern | NeDB | Supabase |
|---|---|---|
| Concurrent writes | Serialised (one at a time) | Full MVCC, connection pooling |
| Data safety | Single flat file — one crash can corrupt it | WAL, point-in-time recovery, daily backups |
| Scalability limit | ~100 concurrent organisations before degradation | Scales to millions of rows |
| Realtime | Custom WebSocket layer (ws.js) | Built-in Postgres realtime channels |
| File storage | Local `uploads/` directory | Supabase Storage (S3-compatible CDN) |
| Admin UI | None | Supabase Table Editor, SQL editor |
| Free tier | N/A | 500 MB database, 1 GB storage, 50K MAU |

**Migrate before reaching 100 active organisations.**

---

## Prerequisites

```bash
# Install Prisma
npm install prisma @prisma/client

# Install Supabase client (optional — for Realtime + Storage later)
npm install @supabase/supabase-js
```

---

## Step 1 — Create Supabase Project

1. Go to https://supabase.com and create a free account
2. Click **New Project**
3. Choose your region (pick closest to your users — for Philippines: `ap-southeast-1`)
4. Set a strong database password and save it
5. Wait ~2 minutes for the project to provision

---

## Step 2 — Get Connection Strings

In your Supabase project:

1. Go to **Settings → Database → Connection string**
2. Copy two URLs:

**Pooled (for app queries)** — uses PgBouncer, handles connection spikes:
```
postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Direct (for migrations only)** — bypasses PgBouncer:
```
postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
```

Add both to your `.env`:
```
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres"
```

---

## Step 3 — Initialise Prisma

```bash
# Initialise (creates prisma/ directory)
npx prisma init

# Copy the schema file from this project
cp prisma/schema.prisma prisma/schema.prisma
# (The schema.prisma file is included in this project's prisma/ directory)
```

---

## Step 4 — Run Migration

This creates all 15 tables in Supabase:

```bash
# Push schema to Supabase (dev workflow)
npx prisma migrate dev --name init

# OR for production (no dev prompt)
npx prisma migrate deploy

# Verify tables were created
npx prisma studio
# Opens browser UI showing all tables
```

You should see all 15 tables in Supabase Table Editor:
`users`, `organizations`, `org_members`, `plans`, `plan_members`,
`swot_items`, `strategies`, `kpis`, `initiatives`, `comments`,
`notifications`, `activity_log`, `templates`, `invitations`, `refresh_tokens`

---

## Step 5 — Migrate Existing Data

If you have existing users/plans in NeDB, run the migration script to transfer them:

```bash
# Ensure DB_PATH points to your existing data/ directory
DB_PATH=./data node scripts/migrate-nedb-to-supabase.js
```

Expected output:
```
╔════════════════════════════════════════════╗
║  STRAT PLANNER PRO — NeDB → Supabase      ║
╚════════════════════════════════════════════╝

Verifying Supabase connection...
✓ Connected to Supabase PostgreSQL

Reading NeDB files from: ./data
Migrating collections (order preserves FK constraints):

  ✓ users                  2 records
  ✓ organizations          0 records
  ✓ org_members            0 records
  ✓ plans                  0 records
  ...
  ✓ templates              5 records

✅ Migration complete in 1.4s
```

The script is **safe to re-run** — it uses `upsert` so no duplicates.

---

## Step 6 — Switch the App to Postgres

**Two file changes only:**

### `server.js` — change the db import:
```js
// Before:
const { db, ensureIndexes, seed } = require('./src/db');

// After:
const { db, ensureIndexes, seed } = require('./src/db-postgres');
```

### `src/auth.js` — update the getDB() function:
```js
// Before:
function getDB() {
  return require('./db').db;
}

// After:
function getDB() {
  return require('./db-postgres').db;
}
```

### `server.js` — add graceful disconnect:
```js
// In the shutdown() function, before process.exit(0):
const { disconnect } = require('./src/db-postgres');
await disconnect();
```

---

## Step 7 — Run Seed on Postgres

```bash
# Creates admin user + 5 built-in templates in Supabase
npm run seed
```

---

## Step 8 — Verify

```bash
npm run dev
```

Then:
1. Open `http://localhost:8080/login`
2. Sign in with admin credentials
3. Create a test plan, add SWOT items, check KPIs
4. Verify data appears in **Supabase Table Editor**
5. Check `npx prisma studio` to browse all records visually

---

## Step 9 — Enable Row Level Security (RLS)

Supabase has Row Level Security disabled by default. Enable it so the
database enforces access control at the SQL level (defence in depth):

Run this in Supabase **SQL Editor**:

```sql
-- Enable RLS on all tables
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE swot_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpis            ENABLE ROW LEVEL SECURITY;
ALTER TABLE initiatives     ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens  ENABLE ROW LEVEL SECURITY;

-- Allow the service role (used by Prisma) to bypass RLS
-- (Prisma connects as the service role, so it needs full access)
CREATE POLICY "service_role_bypass" ON users
  TO service_role USING (true) WITH CHECK (true);
-- Repeat for each table or use a DO loop:
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'CREATE POLICY "service_role_bypass_%s" ON %I TO service_role USING (true) WITH CHECK (true)',
      t, t
    );
  END LOOP;
END $$;
```

---

## Optional — Supabase Realtime (replaces ws.js)

In a future iteration, `ws.js` can be replaced with Supabase Realtime channels.
This gives you free collaborative presence and live updates without managing
a WebSocket server:

```js
// Future: replace broadcastPlanUpdate() in ws.js with:
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function broadcastPlanUpdate(planId, eventType, data) {
  await supabase.channel(`plan:${planId}`)
    .send({ type: 'broadcast', event: eventType, payload: data });
}
```

---

## Optional — Supabase Storage (replaces uploads/)

Replace the local `uploads/` directory with Supabase Storage:

```bash
npm install @supabase/supabase-js
```

```js
// In routes.js, replace multer + local file serving with:
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Upload a file
const { data, error } = await supabase.storage
  .from('plan-attachments')
  .upload(`${planId}/${filename}`, fileBuffer, { contentType });

// Get public URL
const { data: { publicUrl } } = supabase.storage
  .from('plan-attachments')
  .getPublicUrl(`${planId}/${filename}`);
```

---

## Rollback Plan

The NeDB files in `data/` are untouched by the migration script.
If anything goes wrong after switching to Postgres:

1. Revert the two file changes in `server.js` and `src/auth.js`
2. `npm run dev` — NeDB is back, all original data intact

Keep the `data/` directory for at least 30 days after confirming
Postgres is working correctly in production.

---

## Environment Variables Added for Supabase

Add to `.env`:
```
# Supabase PostgreSQL (replaces DB_PATH when using db-postgres.js)
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."

# Supabase project credentials (for Realtime + Storage — optional)
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
```

Add to `.env.example`:
```
# Supabase (used when src/db-postgres.js is active)
DATABASE_URL=
DIRECT_URL=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
```
