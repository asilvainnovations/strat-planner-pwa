/**
 * ============================================================
 * STRAT PLANNER PRO — EMAIL SERVICE  (src/email.js)
 * ============================================================
 * All outbound transactional email. Seven branded HTML templates
 * sent via Nodemailer SMTP.
 *
 * Dev / prod switching:
 *   NODE_ENV=development OR SMTP_USER absent
 *     → console.log mock (no emails sent, safe for local dev)
 *   NODE_ENV=production AND SMTP_USER set
 *     → real SMTP delivery via nodemailer transporter
 *
 * Boot-time validation:
 *   validateEmailEnv() — called by server.js at startup.
 *   In production, throws if SMTP_USER or SMTP_PASS are absent.
 *   In development, logs a warning and continues.
 *
 * Template functions (all fire-and-forget in routes.js):
 *   sendWelcomeEmail(opts)         POST /api/auth/register
 *   sendInviteToOrg(opts)          POST /api/orgs/:id/invite
 *   sendSharePlan(opts)            POST /api/plans/:id/share
 *   sendCommentNotification(opts)  POST /api/plans/:planId/comments
 *   sendCommentResolved(opts)      PATCH /comments/:id/resolve
 *   sendKPIAlert(opts)             PATCH /kpis/:id (status→behind/at-risk)
 *   sendPasswordReset(opts)        POST /api/auth/forgot-password
 *
 * All functions return a Promise. Call with .catch(console.error)
 * in routes.js so email failures never crash the request.
 *
 * Wires to:
 *   src/routes.js → all seven send functions called after DB writes
 * ============================================================
 */

'use strict';

const nodemailer = require('nodemailer');

// ── Transporter (lazy-initialised on first send) ─────────────
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const isDev = process.env.NODE_ENV !== 'production' || !process.env.SMTP_USER;

  if (isDev) {
    // Development: return a mock that logs to console
    _transporter = {
      sendMail: (opts) => {
        console.log('\n[EMAIL] ─────────────────────────────────────');
        console.log(`[EMAIL] To:      ${opts.to}`);
        console.log(`[EMAIL] Subject: ${opts.subject}`);
        console.log('[EMAIL] (HTML body suppressed in dev mode)');
        console.log('[EMAIL] ─────────────────────────────────────\n');
        return Promise.resolve({ messageId: `dev-${Date.now()}` });
      },
    };
  } else {
    _transporter = nodemailer.createTransporter({
      host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
      port:   parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
    });
  }

  return _transporter;
}

/**
 * validateEmailEnv()
 * ──────────────────
 * Called by server.js at boot. Throws in production if SMTP config
 * is missing. Warns in development and continues safely.
 */
function validateEmailEnv() {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      throw new Error(
        '[EMAIL] SMTP_USER and SMTP_PASS must be set in production. ' +
        'See .env.example for required email configuration.'
      );
    }
  } else {
    if (!process.env.SMTP_USER) {
      console.warn('[EMAIL] SMTP_USER not set — emails will be logged to console only.');
    }
  }
}

// ── Shared send helper ────────────────────────────────────────
async function send({ to, subject, html }) {
  const transporter = getTransporter();
  const fromName    = process.env.EMAIL_FROM_NAME    || 'Strat Planner Pro';
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@stratplannerpro.app';

  return transporter.sendMail({
    from:    `"${fromName}" <${fromAddress}>`,
    to,
    subject: subject.length > 70 ? subject.slice(0, 67) + '...' : subject,
    html,
  });
}

// ── Shared HTML wrapper ───────────────────────────────────────
// All templates are wrapped in this branded shell so they share a
// consistent look without importing a template engine.
function wrap(title, bodyHtml) {
  const base = process.env.FRONTEND_URL || 'http://localhost:4000';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    body{margin:0;padding:0;background:#0A1628;font-family:'Inter',Arial,sans-serif;color:#e2e8f0}
    .outer{max-width:600px;margin:0 auto;padding:32px 16px}
    .card{background:#0D1F3C;border-radius:16px;border:1px solid rgba(255,255,255,0.1);padding:36px 40px}
    .logo{font-size:20px;font-weight:700;color:#60A5FA;margin-bottom:28px}
    .logo span{color:#06B6D4}
    h1{font-size:22px;font-weight:700;color:#fff;margin:0 0 14px}
    p{font-size:15px;line-height:1.7;color:#94a3b8;margin:0 0 16px}
    .btn{display:inline-block;padding:13px 28px;background:linear-gradient(135deg,#2563EB,#1d4ed8);color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;margin:8px 0 20px}
    .detail{background:rgba(255,255,255,0.05);border-radius:10px;padding:16px 20px;margin:16px 0}
    .detail-row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06)}
    .detail-row:last-child{border-bottom:none}
    .detail-label{color:#64748b}
    .detail-value{color:#e2e8f0;font-weight:500}
    .footer{text-align:center;font-size:12px;color:#334155;margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.07)}
    .footer a{color:#3B82F6;text-decoration:none}
    @media(max-width:600px){.card{padding:24px 20px}}
  </style>
</head>
<body>
  <div class="outer">
    <div class="card">
      <div class="logo">Strat <span>Planner</span> Pro</div>
      ${bodyHtml}
    </div>
    <div class="footer">
      <p>© 2026 ASilva Innovations · <a href="${base}/privacy">Privacy</a> · <a href="${base}/terms">Terms</a></p>
      <p>If you did not expect this email, you can safely ignore it.</p>
    </div>
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════

/**
 * sendWelcomeEmail({ to, firstName })
 * ─────────────────────────────────────
 * Triggered by: POST /api/auth/register
 * Recipient:    New user
 */
async function sendWelcomeEmail({ to, firstName }) {
  const base = process.env.FRONTEND_URL || 'http://localhost:4000';
  await send({
    to,
    subject: `Welcome to Strat Planner Pro, ${firstName}!`,
    html: wrap('Welcome', `
      <h1>Welcome aboard, ${firstName}! 🎉</h1>
      <p>Your Strat Planner Pro account is ready. Start building your first strategic plan in minutes.</p>
      <a href="${base}/app/" class="btn">Open Your Dashboard →</a>
      <div class="detail">
        <div class="detail-row"><span class="detail-label">What's next?</span></div>
        <div class="detail-row"><span class="detail-label">1.</span><span class="detail-value">Create your first plan</span></div>
        <div class="detail-row"><span class="detail-label">2.</span><span class="detail-value">Run a SWOT Analysis</span></div>
        <div class="detail-row"><span class="detail-label">3.</span><span class="detail-value">Generate AI strategies</span></div>
        <div class="detail-row"><span class="detail-label">4.</span><span class="detail-value">Track KPIs on your Balanced Scorecard</span></div>
      </div>
      <p>Questions? Reply to this email — we're here to help.</p>
    `),
  });
}

/**
 * sendInviteToOrg({ to, inviterName, orgName, role, token })
 * ──────────────────────────────────────────────────────────
 * Triggered by: POST /api/orgs/:id/invite
 * Recipient:    Invitee email (may not have an account yet)
 */
async function sendInviteToOrg({ to, inviterName, orgName, role, token }) {
  const base       = process.env.FRONTEND_URL || 'http://localhost:4000';
  const acceptLink = `${base}/login?mode=register&token=${encodeURIComponent(token)}&redirect=/app/`;

  await send({
    to,
    subject: `${inviterName} invited you to ${orgName} on Strat Planner Pro`,
    html: wrap('Invitation', `
      <h1>You're invited to collaborate</h1>
      <p><strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> as a <strong>${role}</strong> on Strat Planner Pro.</p>
      <div class="detail">
        <div class="detail-row"><span class="detail-label">Organisation</span><span class="detail-value">${orgName}</span></div>
        <div class="detail-row"><span class="detail-label">Invited by</span><span class="detail-value">${inviterName}</span></div>
        <div class="detail-row"><span class="detail-label">Your role</span><span class="detail-value">${role}</span></div>
        <div class="detail-row"><span class="detail-label">Expires</span><span class="detail-value">7 days from now</span></div>
      </div>
      <a href="${acceptLink}" class="btn">Accept Invitation →</a>
      <p>This invitation will expire in 7 days. If you don't have an account yet, you'll be prompted to create one.</p>
    `),
  });
}

/**
 * sendSharePlan({ to, sharerName, planName, permission, planId })
 * ──────────────────────────────────────────────────────────────
 * Triggered by: POST /api/plans/:id/share
 * Recipient:    User the plan was shared with
 */
async function sendSharePlan({ to, sharerName, planName, permission, planId }) {
  const base     = process.env.FRONTEND_URL || 'http://localhost:4000';
  const planLink = `${base}/app/#dashboard`;

  await send({
    to,
    subject: `${sharerName} shared "${planName}" with you`,
    html: wrap('Plan Shared', `
      <h1>A plan has been shared with you</h1>
      <p><strong>${sharerName}</strong> has shared a strategic plan with you on Strat Planner Pro.</p>
      <div class="detail">
        <div class="detail-row"><span class="detail-label">Plan name</span><span class="detail-value">${planName}</span></div>
        <div class="detail-row"><span class="detail-label">Shared by</span><span class="detail-value">${sharerName}</span></div>
        <div class="detail-row"><span class="detail-label">Your access</span><span class="detail-value">${permission}</span></div>
      </div>
      <a href="${planLink}" class="btn">Open Plan →</a>
    `),
  });
}

/**
 * sendCommentNotification({ to, commenterName, entityType, entityName, commentText, planId })
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * Triggered by: POST /api/plans/:planId/comments
 * Recipient:    Plan owner (when they're not the commenter)
 */
async function sendCommentNotification({ to, commenterName, entityType, entityName, commentText, planId }) {
  const base     = process.env.FRONTEND_URL || 'http://localhost:4000';
  const planLink = `${base}/app/#dashboard`;

  // Cap preview to avoid long subjects and body overflow
  const preview = commentText.length > 120 ? commentText.slice(0, 120) + '…' : commentText;
  const subject = `New comment on your ${entityType}`;

  await send({
    to,
    subject,
    html: wrap('New Comment', `
      <h1>New comment on your plan</h1>
      <p><strong>${commenterName}</strong> commented on <strong>${entityType}</strong>: ${entityName ? `"${entityName}"` : ''}.</p>
      <div class="detail">
        <div class="detail-row"><span class="detail-label">Comment</span></div>
        <div style="padding:10px 0;font-size:14px;color:#e2e8f0;line-height:1.6">${preview}</div>
      </div>
      <a href="${planLink}" class="btn">View Comment →</a>
    `),
  });
}

/**
 * sendCommentResolved({ to, resolverName, entityName, planId })
 * ──────────────────────────────────────────────────────────────
 * Triggered by: PATCH /api/plans/:planId/comments/:id/resolve
 * Recipient:    Comment author (when they're not the resolver)
 */
async function sendCommentResolved({ to, resolverName, entityName, planId }) {
  const base     = process.env.FRONTEND_URL || 'http://localhost:4000';
  const planLink = `${base}/app/#dashboard`;

  await send({
    to,
    subject: `Your comment on "${entityName}" was resolved`,
    html: wrap('Comment Resolved', `
      <h1>Comment resolved ✓</h1>
      <p><strong>${resolverName}</strong> marked your comment on <strong>"${entityName}"</strong> as resolved.</p>
      <a href="${planLink}" class="btn">View Plan →</a>
    `),
  });
}

/**
 * sendKPIAlert({ to, kpiName, target, actual, status, planName, planId })
 * ─────────────────────────────────────────────────────────────────────────
 * Triggered by: PATCH /api/plans/:planId/kpis/:id when status → behind | at-risk
 * Recipient:    Plan owner
 */
async function sendKPIAlert({ to, kpiName, target, actual, status, planName, planId }) {
  const base       = process.env.FRONTEND_URL || 'http://localhost:4000';
  const planLink   = `${base}/app/#scorecard`;
  const isBehind   = status === 'behind';
  const statusText = isBehind ? 'Behind Target' : 'At Risk';
  const colour     = isBehind ? '#EF4444' : '#F59E0B';

  await send({
    to,
    subject: `KPI Alert: "${kpiName}" is ${statusText} in ${planName}`,
    html: wrap('KPI Alert', `
      <h1 style="color:${colour}">KPI Alert — ${statusText}</h1>
      <p>A KPI in <strong>${planName}</strong> requires your attention.</p>
      <div class="detail">
        <div class="detail-row"><span class="detail-label">KPI</span><span class="detail-value">${kpiName}</span></div>
        <div class="detail-row"><span class="detail-label">Target</span><span class="detail-value">${target}</span></div>
        <div class="detail-row"><span class="detail-label">Actual</span><span class="detail-value">${actual || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value" style="color:${colour}">${statusText}</span></div>
        <div class="detail-row"><span class="detail-label">Plan</span><span class="detail-value">${planName}</span></div>
      </div>
      <a href="${planLink}" class="btn">Review Scorecard →</a>
    `),
  });
}

/**
 * sendPasswordReset({ to, firstName, token })
 * ────────────────────────────────────────────
 * Triggered by: POST /api/auth/forgot-password
 * Recipient:    Requesting user
 *
 * Token expires in 1 hour (enforced by routes.js expiresAt check).
 */
async function sendPasswordReset({ to, firstName, token }) {
  const base       = process.env.FRONTEND_URL || 'http://localhost:4000';
  const resetLink  = `${base}/login?reset_token=${encodeURIComponent(token)}`;

  await send({
    to,
    subject: 'Reset your Strat Planner Pro password',
    html: wrap('Password Reset', `
      <h1>Reset your password</h1>
      <p>Hi ${firstName || 'there'}, we received a request to reset your Strat Planner Pro password.</p>
      <a href="${resetLink}" class="btn">Reset Password →</a>
      <div class="detail">
        <div class="detail-row"><span class="detail-label">Link expires</span><span class="detail-value">1 hour from now</span></div>
      </div>
      <p>If you did not request a password reset, you can safely ignore this email. Your password has not been changed.</p>
    `),
  });
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  validateEmailEnv,
  sendWelcomeEmail,
  sendInviteToOrg,
  sendSharePlan,
  sendCommentNotification,
  sendCommentResolved,
  sendKPIAlert,
  sendPasswordReset,
};
