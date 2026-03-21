# Strat Planner Pro — Production Deployment Runbook

## Prerequisites

- VPS or cloud instance with Node.js 20+, Nginx, Certbot
- Domain pointing to your server IP
- S3-compatible bucket for backups (AWS S3, Cloudflare R2, DigitalOcean Spaces)
- (Optional) Sentry account for error monitoring
- (Optional) Uptime monitoring service (Better Uptime, UptimeRobot, etc.)

---

## 1. Environment Variables

Set ALL of the following on your hosting platform before first deploy.
Never commit these to git.

### Required ★

| Variable | Description | Example |
|---|---|---|
| `JWT_SECRET` | 64+ char random string | `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `ADMIN_EMAIL` | Admin account email | `admin@yourdomain.com` |
| `ADMIN_PASSWORD` | Admin account password (strong) | min 12 chars, mixed case + symbols |
| `CORS_ORIGINS` | Production domain only | `https://yourdomain.com` |
| `FRONTEND_URL` | Base URL for email links | `https://yourdomain.com` |
| `NODE_ENV` | Must be `production` | `production` |

### Required for email ★

| Variable | Description |
|---|---|
| `SMTP_HOST` | SMTP server (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | Usually `587` (TLS) or `465` (SSL) |
| `SMTP_SECURE` | `false` for 587, `true` for 465 |
| `SMTP_USER` | SMTP username / email address |
| `SMTP_PASS` | SMTP password or app-specific password |
| `EMAIL_FROM_NAME` | Sender display name |
| `EMAIL_FROM_ADDRESS` | Sender email address |

### Required for AI features ★

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Get from console.anthropic.com |

### Optional — Observability

| Variable | Description |
|---|---|
| `SENTRY_DSN` | Sentry project DSN (error monitoring) |
| `LOG_LEVEL` | `info` (default), `debug`, `warn`, `error` |
| `S3_BUCKET` | S3 path for backups (e.g. `s3://my-bucket/backups`) |
| `AWS_ACCESS_KEY_ID` | AWS credentials for backup script |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials for backup script |
| `AWS_DEFAULT_REGION` | e.g. `ap-southeast-1` |

---

## 2. Server Setup

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Nginx
sudo apt-get install -y nginx

# Install Certbot (Let's Encrypt)
sudo apt-get install -y certbot python3-certbot-nginx

# Install AWS CLI (for backups)
pip install awscli

# Install PM2 (process manager)
npm install -g pm2
```

---

## 3. Deploy Application

```bash
# Clone repository
git clone https://github.com/asilvainnovations/strat-planner-pwa.git /app
cd /app

# Install dependencies (production only)
npm ci --omit=dev

# Install optional observability packages
npm install @sentry/node pino pino-http pino-pretty

# Create .env with all required variables (see section 1)
cp .env.example .env
nano .env   # fill in all ★ required values

# Create persistent directories (mount as volumes on cloud platforms)
mkdir -p data uploads
chmod 755 data uploads

# Run seed — creates admin user + 5 built-in templates
npm run seed
```

---

## 4. Nginx Configuration

```bash
# Copy Nginx config
sudo cp nginx.conf /etc/nginx/sites-available/stratplannerpro
sudo ln -s /etc/nginx/sites-available/stratplannerpro \
           /etc/nginx/sites-enabled/stratplannerpro

# Edit to replace stratplannerpro.app with your actual domain
sudo nano /etc/nginx/sites-available/stratplannerpro

# Obtain SSL certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Test and reload Nginx
sudo nginx -t && sudo nginx -s reload
```

**Verify WebSocket works after Nginx setup:**
```bash
# Should return: {"status":"ok"}
curl https://yourdomain.com/api/health
```

---

## 5. Start Application with PM2

```bash
cd /app

# Start server
pm2 start server.js --name strat-planner-pro \
    --env production \
    --max-memory-restart 512M

# Save PM2 config to restart on reboot
pm2 save
pm2 startup   # follow the printed command to enable on boot

# Monitor
pm2 logs strat-planner-pro
pm2 monit
```

---

## 6. Persistent Volumes

On cloud platforms (Railway, Render, Fly.io, DigitalOcean App Platform):

```
Mount: /app/data    → persistent volume (NeDB database files)
Mount: /app/uploads → persistent volume (user-uploaded files)
```

On VPS with PM2, these are local directories — back them up daily (see section 8).

**Never delete the `data/` directory.** It contains all user data.

---

## 7. Uptime Monitoring

Set up a monitor on `GET https://yourdomain.com/api/health`.

Expected response:
```json
{
  "status": "ok",
  "service": "Strat Planner Pro API",
  "version": "1.0.0",
  "uptime": 12345.67
}
```

**Recommended services (free tier available):**
- Better Uptime: https://betterstack.com/better-uptime
- UptimeRobot: https://uptimerobot.com
- Freshping: https://www.freshworks.com/website-monitoring

Monitor settings:
- Check interval: every 1 minute
- Alert on: non-2xx response OR timeout > 10s
- Alert channels: email + Slack/Teams

---

## 8. Automated Backups

```bash
# Make backup script executable
chmod +x /app/scripts/backup.sh

# Test manually first
S3_BUCKET=s3://your-bucket/backups \
AWS_ACCESS_KEY_ID=your-key \
AWS_SECRET_ACCESS_KEY=your-secret \
AWS_DEFAULT_REGION=ap-southeast-1 \
/app/scripts/backup.sh

# Schedule daily at 2 AM
crontab -e
# Add this line:
0 2 * * * /app/scripts/backup.sh >> /var/log/spp-backup.log 2>&1
```

For **Cloudflare R2** (S3-compatible, generous free tier):
```bash
S3_BUCKET=s3://your-r2-bucket
S3_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
```

---

## 9. Sentry Error Monitoring

```bash
# Install Sentry
npm install @sentry/node

# Add to .env
SENTRY_DSN=https://your-dsn@sentry.io/your-project-id
```

1. Create account at https://sentry.io
2. Create new Node.js project
3. Copy the DSN to your `.env`
4. Deploy — errors automatically appear in Sentry dashboard

---

## 10. PWA Screenshots

The `manifest.json` references screenshot files that must exist for the
enhanced PWA install dialog to work.

Create these screenshots:
```
public/screenshots/dashboard.png      1280×800  (wide / desktop)
public/screenshots/swot.png           1280×800  (wide / desktop)
public/screenshots/scorecard.png      1280×800  (wide / desktop)
public/screenshots/dashboard-mobile.png  390×844  (narrow / mobile)
```

Take screenshots directly from the running app using your browser's
DevTools screenshot tool, or use a tool like Playwright:

```bash
npx playwright screenshot --viewport-size 1280,800 \
  https://yourdomain.com/app/#dashboard \
  public/screenshots/dashboard.png
```

### Maskable icon safe zone

The `icon-512-maskable.png` file must follow the maskable icon safe zone:
- Content must fit within the **central 80%** (409×409 px of the 512×512 canvas)
- The outer 10% on each side can be cropped by the OS
- Use https://maskable.app/editor to verify and generate

---

## 11. Post-Launch Hardening (Roadmap)

These are planned items beyond this deployment:

### NeDB → PostgreSQL Migration
Plan this before reaching **100 active organisations**.

**Why:** NeDB has no WAL (write-ahead log), no connection pooling,
and degrades under concurrent writes. A single corrupted .db file can
lose all data with no recovery path.

**Migration path:**
```bash
npm install prisma @prisma/client pg
npx prisma init
# Define schema matching the 15 NeDB collections
# Write migration script: npx ts-node scripts/migrate-nedb-to-pg.js
# Swap require('./src/db') → require('./src/db-postgres')
```

Recommended: **Prisma + Neon** (serverless Postgres, generous free tier)
or **Prisma + Supabase** (includes realtime, auth, storage).

### File Upload Feature
`multer` was referenced in early planning but never installed.
Either implement the upload feature or confirm it is not needed.

To add file uploads to initiatives/plans:
```bash
npm install multer
```
Then add `POST /api/plans/:id/upload` route using `multer({ dest: process.env.UPLOAD_PATH })`.

---

## 12. First-Deploy Checklist

- [ ] All ★ env vars set on hosting platform
- [ ] `npm run seed` completed successfully  
- [ ] Admin login works at `https://yourdomain.com/login`
- [ ] `GET /api/health` returns 200
- [ ] PWA install prompt appears (HTTPS required)
- [ ] Service worker registered (check DevTools → Application → Service Workers)
- [ ] WebSocket connected (check browser console: `[App] WebSocket connected`)
- [ ] Email sending tested (try forgot-password flow)
- [ ] Backup script tested manually
- [ ] Uptime monitor configured and alerting
- [ ] Sentry receiving test error (optional but recommended)
- [ ] Screenshots added to `public/screenshots/`
- [ ] Maskable icon verified at maskable.app

---

*Strat Planner Pro — ASilva Innovations*
