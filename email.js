/**
 * ============================================================
 * STRAT PLANNER PRO — EMAIL SERVICE
 * ============================================================
 * Handles all transactional email via SMTP (Nodemailer).
 * Falls back to console logging in development if SMTP not set.
 *
 * Templates:
 *  - inviteToOrg           — org invite
 *  - sharePlan             — plan shared with user
 *  - newComment            — new comment on watched item
 *  - commentResolved       — comment resolved
 *  - kpiAlert              — KPI behind target
 *  - welcomeEmail          — account created
 *  - passwordReset         — reset password link
 * ============================================================
 */

'use strict';

const nodemailer = require('nodemailer');

const SMTP_CONFIG = {
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
};

const FROM = `"${process.env.EMAIL_FROM_NAME || 'Strat Planner Pro'}" <${process.env.EMAIL_FROM_ADDRESS || 'noreply@strat-planner.app'}>`;
const APP_URL  = process.env.FRONTEND_URL || 'http://localhost:3000';
const LOGO_URL = 'https://appimize.app/assets/apps/user_1097/images/46fe704cc227_595_1097.png';

// ── Transporter factory ───────────────────────────────────
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const isDev = !process.env.SMTP_USER || process.env.NODE_ENV === 'development';
  if (isDev) {
    // In dev: just log to console
    _transporter = {
      sendMail: async (opts) => {
        console.log('\n[EMAIL] ─────────────────────────────────────────');
        console.log(`  To:      ${opts.to}`);
        console.log(`  Subject: ${opts.subject}`);
        console.log(`  Preview: ${opts.text?.slice(0, 120)}...`);
        console.log('[EMAIL] ─────────────────────────────────────────\n');
        return { messageId: 'dev-mode-' + Date.now() };
      }
    };
  } else {
    _transporter = nodemailer.createTransport(SMTP_CONFIG);
  }

  return _transporter;
}

// ── Base layout wrapper ───────────────────────────────────
function layout(title, body) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', Arial, sans-serif; background: #f0f4f8; padding: 40px 20px; color: #1a202c; }
  .wrapper { max-width: 560px; margin: 0 auto; }
  .header { background: linear-gradient(135deg, #0F2952, #1E4D9B); border-radius: 16px 16px 0 0; padding: 28px 32px; text-align: center; }
  .logo { width: 52px; height: 52px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.25); margin: 0 auto 12px; display: block; }
  .brand { color: white; font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
  .brand-sub { color: rgba(255,255,255,0.6); font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 2px; }
  .body { background: white; padding: 32px; }
  .title { font-size: 22px; font-weight: 700; color: #0F2952; margin-bottom: 12px; }
  .text { font-size: 15px; color: #4a5568; line-height: 1.7; margin-bottom: 16px; }
  .btn { display: inline-block; background: linear-gradient(135deg, #1E4D9B, #2563EB); color: white !important; text-decoration: none; padding: 14px 32px; border-radius: 50px; font-weight: 600; font-size: 15px; margin: 16px 0; }
  .divider { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
  .meta { font-size: 12px; color: #a0aec0; line-height: 1.6; }
  .highlight { background: #eff6ff; border-left: 4px solid #2563EB; border-radius: 0 8px 8px 0; padding: 14px 16px; margin: 16px 0; font-size: 14px; color: #1e40af; }
  .footer { background: #f7fafc; border-radius: 0 0 16px 16px; padding: 20px 32px; text-align: center; }
  .footer-text { font-size: 12px; color: #718096; }
  .badge { display: inline-block; background: #eff6ff; color: #2563EB; padding: 3px 10px; border-radius: 50px; font-size: 12px; font-weight: 600; margin-left: 6px; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <img src="${LOGO_URL}" class="logo" alt="Strat Planner Pro">
    <div class="brand">Strat Planner Pro</div>
    <div class="brand-sub">Strategic Planning Platform</div>
  </div>
  <div class="body">${body}</div>
  <div class="footer">
    <div class="footer-text">
      © ${new Date().getFullYear()} ASSILVA Innovations, Inc. All rights reserved.<br>
      <a href="${APP_URL}" style="color:#2563EB;">Open Strat Planner Pro</a> · 
      <a href="${APP_URL}/unsubscribe" style="color:#718096;">Unsubscribe</a>
    </div>
  </div>
</div>
</body>
</html>`.trim();
}

// ── Send helper ───────────────────────────────────────────
async function send({ to, subject, html, text }) {
  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from: FROM, to, subject, html,
      text: text || subject,
    });
    console.log(`[EMAIL] Sent "${subject}" → ${to} (${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EMAIL] Failed to send to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ── Email Templates ───────────────────────────────────────

/**
 * Send org invite email
 */
async function sendInviteToOrg({ to, inviterName, orgName, role, token }) {
  const inviteUrl = `${APP_URL}/accept-invite?token=${token}`;
  const html = layout('You\'ve been invited', `
    <div class="title">You've been invited to join ${orgName}</div>
    <p class="text"><strong>${inviterName}</strong> has invited you to collaborate on strategic plans in <strong>${orgName}</strong> on Strat Planner Pro.</p>
    <div class="highlight">
      You'll join as: <strong>${role}</strong><span class="badge">${role}</span><br>
      Organization: <strong>${orgName}</strong>
    </div>
    <center><a href="${inviteUrl}" class="btn">Accept Invitation →</a></center>
    <hr class="divider">
    <p class="meta">This invitation expires in 7 days. If you didn't expect this, you can safely ignore this email.</p>
    <p class="meta">Or copy this link: ${inviteUrl}</p>
  `);
  return send({ to, subject: `${inviterName} invited you to ${orgName} on Strat Planner Pro`, html });
}

/**
 * Send plan-shared email
 */
async function sendSharePlan({ to, sharerName, planName, permission, planId }) {
  const planUrl = `${APP_URL}/plans/${planId}`;
  const html = layout('A strategic plan was shared with you', `
    <div class="title">Strategic plan shared with you</div>
    <p class="text"><strong>${sharerName}</strong> has shared a strategic plan with you on Strat Planner Pro.</p>
    <div class="highlight">
      Plan: <strong>${planName}</strong><br>
      Your access: <strong>${permission}</strong><span class="badge">${permission}</span>
    </div>
    <center><a href="${planUrl}" class="btn">Open Plan →</a></center>
    <hr class="divider">
    <p class="meta">You now have ${permission} access to this plan. Log in to view and collaborate.</p>
  `);
  return send({ to, subject: `${sharerName} shared "${planName}" with you`, html });
}

/**
 * Send new comment notification
 */
async function sendCommentNotification({ to, commenterName, entityType, entityName, commentText, planId }) {
  const planUrl = `${APP_URL}/plans/${planId}`;
  const html = layout('New comment on your item', `
    <div class="title">New comment from ${commenterName}</div>
    <p class="text"><strong>${commenterName}</strong> commented on a <strong>${entityType}</strong> you're watching: <strong>${entityName}</strong></p>
    <div class="highlight">"${commentText.slice(0, 200)}${commentText.length > 200 ? '…' : ''}"</div>
    <center><a href="${planUrl}" class="btn">View Comment →</a></center>
    <hr class="divider">
    <p class="meta">To stop receiving these notifications, update your notification preferences in Strat Planner Pro settings.</p>
  `);
  return send({ to, subject: `${commenterName} commented on "${entityName}"`, html });
}

/**
 * Send comment resolved notification
 */
async function sendCommentResolved({ to, resolverName, entityName, planId }) {
  const planUrl = `${APP_URL}/plans/${planId}`;
  const html = layout('Your comment was resolved', `
    <div class="title">Comment resolved ✓</div>
    <p class="text"><strong>${resolverName}</strong> marked your comment on <strong>${entityName}</strong> as resolved.</p>
    <center><a href="${planUrl}" class="btn">View Plan →</a></center>
  `);
  return send({ to, subject: `Your comment on "${entityName}" was resolved`, html });
}

/**
 * Send KPI alert
 */
async function sendKPIAlert({ to, kpiName, target, actual, status, planName, planId }) {
  const planUrl = `${APP_URL}/plans/${planId}`;
  const statusColors = { behind: '#dc2626', 'at-risk': '#d97706', 'on-track': '#059669' };
  const color = statusColors[status] || '#2563EB';
  const html = layout(`KPI Alert: ${kpiName}`, `
    <div class="title">⚠️ KPI Requires Attention</div>
    <p class="text">A KPI in your plan <strong>${planName}</strong> is <span style="color:${color};font-weight:700;">${status.replace('-', ' ')}</span>.</p>
    <div class="highlight" style="border-left-color:${color};">
      <strong>${kpiName}</strong><br>
      Target: <strong>${target}</strong> &nbsp;|&nbsp; Actual: <strong>${actual}</strong><br>
      Status: <span style="color:${color}; font-weight:700;">${status.toUpperCase().replace('-', ' ')}</span>
    </div>
    <center><a href="${planUrl}" class="btn">Review Scorecard →</a></center>
  `);
  return send({ to, subject: `KPI Alert: "${kpiName}" is ${status.replace('-', ' ')} in ${planName}`, html });
}

/**
 * Welcome email on registration
 */
async function sendWelcomeEmail({ to, firstName }) {
  const html = layout('Welcome to Strat Planner Pro', `
    <div class="title">Welcome, ${firstName}! 👋</div>
    <p class="text">Your account is ready. Strat Planner Pro gives you everything you need for precision strategic planning:</p>
    <ul style="font-size:14px; color:#4a5568; margin:12px 0 20px 20px; line-height:2;">
      <li>🔍 Guided SWOT Analysis</li>
      <li>✦ AI-powered strategy generation</li>
      <li>🎯 Balanced Scorecard with smart KPIs</li>
      <li>🔄 Causal Loop Diagrams &amp; Systems Archetypes</li>
      <li>👥 Team collaboration &amp; real-time editing</li>
      <li>📄 Print-ready plan reports</li>
    </ul>
    <center><a href="${APP_URL}" class="btn">Open Strat Planner Pro →</a></center>
  `);
  return send({ to, subject: 'Welcome to Strat Planner Pro — Your account is ready', html });
}

/**
 * Password reset email
 */
async function sendPasswordReset({ to, firstName, token }) {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;
  const html = layout('Reset your password', `
    <div class="title">Password Reset Request</div>
    <p class="text">Hi ${firstName}, we received a request to reset your Strat Planner Pro password.</p>
    <center><a href="${resetUrl}" class="btn">Reset Password →</a></center>
    <hr class="divider">
    <p class="meta">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password will not change.</p>
  `);
  return send({ to, subject: 'Reset your Strat Planner Pro password', html });
}

module.exports = {
  send,
  sendInviteToOrg,
  sendSharePlan,
  sendCommentNotification,
  sendCommentResolved,
  sendKPIAlert,
  sendWelcomeEmail,
  sendPasswordReset,
};
