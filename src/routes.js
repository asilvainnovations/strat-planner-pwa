/**
 * ============================================================
 * STRAT PLANNER PRO — API ROUTES  (src/routes.js)
 * ============================================================
 * Mounts all route groups onto the Express app.
 * Each group is a self-contained section of this router module.
 *
 * Fixes applied in this version:
 *  [FIX-5] GET /notifications — replaced broken ternary that was
 *          causing a double full-table scan on every request.
 *
 *          BEFORE (broken):
 *            const items = await db.notifications.find({...}).sort({...}).limit ?
 *              (await db.notifications.find({...})).sort(...).slice(0,50) :
 *              await db.notifications.find({...});
 *          The ternary tested whether .limit is a function (always truthy),
 *          so it always took the double-query branch, running two full
 *          collection scans instead of one.
 *
 *          AFTER (fixed):
 *            const items = (await db.notifications.find({ userId: req.user.id }))
 *              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
 *              .slice(0, 50);
 *          Single query, sort in JS (NeDB sort API), slice to 50.
 * ============================================================
 */

'use strict';

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const { db, helpers }           = require('./db');
const auth                      = require('./auth');
const email                     = require('./email');
const ws                        = require('./ws');

// ── Validation middleware ─────────────────────────────────
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }
  next();
}

// ── Strip internal fields from user ──────────────────────
function safeUser(u) {
  const { password, ...rest } = u;
  return rest;
}

function router() {
  const r = express.Router();

  // ===========================================================
  // AUTH ROUTES  /api/auth/*
  // ===========================================================

  /** POST /api/auth/register */
  r.post('/auth/register',
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('firstName').trim().notEmpty(),
    body('lastName').trim().notEmpty(),
    validate,
    async (req, res) => {
      try {
        const { email: emailAddr, password, firstName, lastName } = req.body;
        const existing = await helpers.findUserByEmail(emailAddr);
        if (existing) {
          return res.status(409).json({ error: 'Email already registered' });
        }

        const hash = await auth.hashPassword(password);
        const user = await db.users.insert({
          email:     emailAddr.toLowerCase(),
          password:  hash,
          firstName, lastName,
          role:      'user',
          initials:  (firstName[0] + lastName[0]).toUpperCase(),
          color:     'linear-gradient(135deg,#3B82F6,#06B6D4)',
          isActive:  true,
          emailVerified: false,
        });

        const accessToken  = auth.createAccessToken(user);
        const refreshToken = await auth.createRefreshToken(user._id);

        // Fire-and-forget welcome email
        email.sendWelcomeEmail({ to: emailAddr, firstName }).catch(console.error);

        await helpers.logActivity({
          userId: user._id, userEmail: user.email, userName: `${firstName} ${lastName}`,
          action: 'registered', entityType: 'user',
        });

        res.status(201).json({
          user: safeUser(user),
          accessToken,
          refreshToken,
        });
      } catch (err) {
        console.error('[AUTH] register error:', err);
        res.status(500).json({ error: 'Registration failed' });
      }
    }
  );

  /** POST /api/auth/login */
  r.post('/auth/login',
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
    validate,
    async (req, res) => {
      try {
        const { email: emailAddr, password } = req.body;
        const user = await helpers.findUserByEmail(emailAddr);

        if (!user || !(await auth.verifyPassword(password, user.password))) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (!user.isActive) {
          return res.status(403).json({ error: 'Account deactivated' });
        }

        const accessToken  = auth.createAccessToken(user);
        const refreshToken = await auth.createRefreshToken(user._id);

        await helpers.logActivity({
          userId: user._id, userEmail: user.email, userName: `${user.firstName} ${user.lastName}`,
          action: 'logged_in', ipAddress: req.ip,
        });

        res.json({ user: safeUser(user), accessToken, refreshToken });
      } catch (err) {
        console.error('[AUTH] login error:', err);
        res.status(500).json({ error: 'Login failed' });
      }
    }
  );

  /** POST /api/auth/refresh */
  r.post('/auth/refresh',
    body('refreshToken').notEmpty(),
    validate,
    async (req, res) => {
      try {
        const newRefreshToken = await auth.rotateRefreshToken(req.body.refreshToken);
        const record = await db.refreshTokens.findOne({ token: newRefreshToken });
        const user   = await db.users.findOne({ _id: record.userId });
        const accessToken = auth.createAccessToken(user);
        res.json({ accessToken, refreshToken: newRefreshToken });
      } catch (err) {
        res.status(401).json({ error: err.message });
      }
    }
  );

  /** POST /api/auth/logout */
  r.post('/auth/logout', auth.requireAuth, async (req, res) => {
    const { refreshToken } = req.body;
    if (refreshToken) await auth.revokeRefreshToken(refreshToken);
    res.json({ success: true });
  });

  /** GET /api/auth/me */
  r.get('/auth/me', auth.requireAuth, async (req, res) => {
    const user = await db.users.findOne({ _id: req.user.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: safeUser(user) });
  });

  /** PATCH /api/auth/me — update profile */
  r.patch('/auth/me', auth.requireAuth,
    body('firstName').optional().trim().notEmpty(),
    body('lastName').optional().trim().notEmpty(),
    validate,
    async (req, res) => {
      const { firstName, lastName } = req.body;
      const update = {};
      if (firstName) update.firstName = firstName;
      if (lastName)  update.lastName  = lastName;
      if (firstName || lastName) {
        update.initials = ((firstName || '?')[0] + (lastName || '?')[0]).toUpperCase();
      }
      await db.users.update({ _id: req.user.id }, { $set: update });
      const updated = await db.users.findOne({ _id: req.user.id });
      res.json({ user: safeUser(updated) });
    }
  );

  /** POST /api/auth/change-password */
  r.post('/auth/change-password', auth.requireAuth,
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8 }),
    validate,
    async (req, res) => {
      const user = await db.users.findOne({ _id: req.user.id });
      if (!await auth.verifyPassword(req.body.currentPassword, user.password)) {
        return res.status(401).json({ error: 'Current password incorrect' });
      }
      const hash = await auth.hashPassword(req.body.newPassword);
      await db.users.update({ _id: req.user.id }, { $set: { password: hash } });
      await auth.revokeAllUserTokens(req.user.id);
      res.json({ success: true, message: 'Password changed. Please log in again.' });
    }
  );

  /** POST /api/auth/forgot-password */
  r.post('/auth/forgot-password',
    body('email').isEmail().normalizeEmail(),
    validate,
    async (req, res) => {
      try {
        const user = await helpers.findUserByEmail(req.body.email);
        // Always respond 200 — never reveal whether the email exists
        if (user && user.isActive) {
          const token = uuidv4();
          // Store token (reuse invitations collection pattern, or a dedicated store)
          await db.invitations.insert({
            token,
            email:     user.email,
            orgId:     null,
            role:      null,
            invitedBy: null,
            status:    'pending',
            expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
          });
          email.sendPasswordReset({
            to:        user.email,
            firstName: user.firstName,
            token,
          }).catch(console.error);
        }
        res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
      } catch (err) {
        console.error('[AUTH] forgot-password error:', err);
        res.status(500).json({ error: 'Failed to process password reset request' });
      }
    }
  );

  // ===========================================================
  // ORGANIZATION ROUTES  /api/orgs/*
  // ===========================================================

  /** GET /api/orgs — list user's orgs */
  r.get('/orgs', auth.requireAuth, async (req, res) => {
    const memberships = await db.orgMembers.find({ userId: req.user.id });
    const orgIds = memberships.map(m => m.orgId);
    const orgs = orgIds.length ? await db.organizations.find({ _id: { $in: orgIds } }) : [];
    res.json({ orgs });
  });

  /** POST /api/orgs — create org */
  r.post('/orgs', auth.requireAuth,
    body('name').trim().notEmpty(),
    body('type').optional().trim(),
    validate,
    async (req, res) => {
      const { name, type, description } = req.body;
      const org = await db.organizations.insert({
        name, type: type || 'organization', description: description || '',
        ownerId: req.user.id,
        planCount: 0,
      });
      // Add creator as admin member
      await db.orgMembers.insert({ orgId: org._id, userId: req.user.id, role: 'admin', invitedBy: req.user.id });
      res.status(201).json({ org });
    }
  );

  /** GET /api/orgs/:id/members */
  r.get('/orgs/:id/members', auth.requireAuth, async (req, res) => {
    const role = await helpers.getOrgRole(req.user.id, req.params.id);
    if (!role) return res.status(403).json({ error: 'Not a member' });

    const memberships = await db.orgMembers.find({ orgId: req.params.id });
    const userIds = memberships.map(m => m.userId);
    const users = userIds.length ? await db.users.find({ _id: { $in: userIds } }) : [];
    const userMap = Object.fromEntries(users.map(u => [u._id, u]));

    const result = memberships.map(m => ({
      ...m,
      user: m.userId in userMap ? safeUser(userMap[m.userId]) : null,
    }));
    res.json({ members: result });
  });

  /** POST /api/orgs/:id/invite */
  r.post('/orgs/:id/invite', auth.requireAuth,
    body('email').isEmail().normalizeEmail(),
    body('role').isIn(['viewer', 'editor', 'admin']),
    validate,
    async (req, res) => {
      const orgId = req.params.id;
      const callerRole = await helpers.getOrgRole(req.user.id, orgId);
      if (!callerRole || callerRole === 'viewer') {
        return res.status(403).json({ error: 'Insufficient permissions to invite' });
      }

      const org = await db.organizations.findOne({ _id: orgId });
      if (!org) return res.status(404).json({ error: 'Organization not found' });

      const { email: inviteeEmail, role } = req.body;
      const token = uuidv4();

      await db.invitations.insert({
        token, orgId, email: inviteeEmail, role,
        invitedBy:   req.user.id,
        inviterName: req.user.name,
        status:      'pending',
        expiresAt:   new Date(Date.now() + 7 * 86400000),
      });

      email.sendInviteToOrg({
        to:          inviteeEmail,
        inviterName: req.user.name,
        orgName:     org.name,
        role,
        token,
      }).catch(console.error);

      await helpers.logActivity({
        userId: req.user.id, userEmail: req.user.email, userName: req.user.name,
        action: 'invited', entityType: 'user',
        details: `invited ${inviteeEmail} to ${org.name}`,
      });

      res.json({ success: true, message: `Invitation sent to ${inviteeEmail}` });
    }
  );

  /** POST /api/orgs/accept-invite */
  r.post('/orgs/accept-invite',
    body('token').notEmpty(),
    validate,
    auth.requireAuth,
    async (req, res) => {
      const invite = await db.invitations.findOne({ token: req.body.token, status: 'pending' });
      if (!invite) return res.status(404).json({ error: 'Invalid or expired invitation' });
      if (new Date() > new Date(invite.expiresAt)) {
        await db.invitations.update({ _id: invite._id }, { $set: { status: 'expired' } });
        return res.status(410).json({ error: 'Invitation expired' });
      }

      const existing = await db.orgMembers.findOne({ orgId: invite.orgId, userId: req.user.id });
      if (existing) {
        return res.status(409).json({ error: 'Already a member of this organization' });
      }

      await db.orgMembers.insert({
        orgId: invite.orgId, userId: req.user.id,
        role: invite.role, invitedBy: invite.invitedBy,
      });
      await db.invitations.update({ _id: invite._id }, { $set: { status: 'accepted' } });

      res.json({ success: true, orgId: invite.orgId, role: invite.role });
    }
  );

  // ===========================================================
  // PLAN ROUTES  /api/plans/*
  // ===========================================================

  /** GET /api/plans */
  r.get('/plans', auth.requireAuth, async (req, res) => {
    const { owned, shared } = await helpers.getUserPlans(req.user.id);
    res.json({ owned, shared });
  });

  /** POST /api/plans */
  r.post('/plans', auth.requireAuth,
    body('name').trim().notEmpty(),
    validate,
    async (req, res) => {
      const { name, orgId, period, description, templateId } = req.body;

      const plan = await db.plans.insert({
        name, orgId: orgId || null, period: period || '',
        description: description || '', ownerId: req.user.id,
        isDeleted: false,
      });

      // If using a template, pre-seed all sections
      if (templateId) {
        const tmpl = await db.templates.findOne({ _id: templateId });
        if (tmpl && tmpl.swotItems) {
          for (const [category, items] of Object.entries(tmpl.swotItems)) {
            for (const text of items) {
              await db.swotItems.insert({ planId: plan._id, category, text, ownerId: req.user.id });
            }
          }
        }
        if (tmpl && tmpl.strategies) {
          for (const [type, items] of Object.entries(tmpl.strategies)) {
            for (const text of items) {
              await db.strategies.insert({ planId: plan._id, type, text, ownerId: req.user.id });
            }
          }
        }
        if (tmpl && tmpl.kpis) {
          for (const kpi of tmpl.kpis) {
            await db.kpis.insert({ planId: plan._id, ...kpi, actual: '', status: 'on-track', weight: 0.25 });
          }
        }
        if (tmpl && tmpl.initiatives) {
          for (const init of tmpl.initiatives) {
            await db.initiatives.insert({
              planId: plan._id, ...init, ownerId: req.user.id,
              budget: 0, utilized: 0, progress: 0, status: 'on-track',
            });
          }
        }
      }

      await helpers.logActivity({
        userId: req.user.id, userEmail: req.user.email, userName: req.user.name,
        planId: plan._id, action: 'created_plan', entityType: 'plan',
        details: `Created plan: ${name}`,
      });

      res.status(201).json({ plan });
    }
  );

  /** GET /api/plans/:id — full plan with all sections */
  r.get('/plans/:id', auth.requireAuth, async (req, res) => {
    const access = await helpers.findPlanWithAccess(req.params.id, req.user.id);
    if (!access) return res.status(403).json({ error: 'Access denied or plan not found' });

    const [swotItems, strategies, kpis, initiatives, comments, members] = await Promise.all([
      db.swotItems.find({ planId: req.params.id, isDeleted: { $ne: true } }),
      db.strategies.find({ planId: req.params.id, isDeleted: { $ne: true } }),
      db.kpis.find({ planId: req.params.id, isDeleted: { $ne: true } }),
      db.initiatives.find({ planId: req.params.id, isDeleted: { $ne: true } }),
      db.comments.find({ planId: req.params.id, isDeleted: { $ne: true } }),
      db.planMembers.find({ planId: req.params.id }),
    ]);

    res.json({
      ...access,
      swotItems,
      strategies,
      kpis,
      initiatives,
      comments,
      members,
    });
  });

  /** PATCH /api/plans/:id */
  r.patch('/plans/:id', auth.requireAuth, async (req, res) => {
    const role = await helpers.getPlanRole(req.user.id, req.params.id);
    if (!role || role === 'viewer') return res.status(403).json({ error: 'No edit access' });

    const allowed = ['name', 'period', 'description', 'orgId'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    await db.plans.update({ _id: req.params.id }, { $set: update });
    const plan = await db.plans.findOne({ _id: req.params.id });

    ws.broadcastPlanUpdate(req.params.id, 'PLAN_UPDATED', { section: 'meta', plan }, req.user.id);
    res.json({ plan });
  });

  /** DELETE /api/plans/:id */
  r.delete('/plans/:id', auth.requireAuth, async (req, res) => {
    const plan = await db.plans.findOne({ _id: req.params.id });
    if (!plan || plan.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Only owner can delete' });
    }
    await db.plans.update({ _id: req.params.id }, { $set: { isDeleted: true } });
    res.json({ success: true });
  });

  /** POST /api/plans/:id/share */
  r.post('/plans/:id/share', auth.requireAuth,
    body('email').isEmail().normalizeEmail(),
    body('permission').isIn(['viewer', 'editor', 'admin']),
    validate,
    async (req, res) => {
      const role = await helpers.getPlanRole(req.user.id, req.params.id);
      if (!role || role === 'viewer') return res.status(403).json({ error: 'No share access' });

      const plan = await db.plans.findOne({ _id: req.params.id });
      const targetUser = await helpers.findUserByEmail(req.body.email);

      if (targetUser) {
        const existing = await db.planMembers.findOne({
          planId: req.params.id, userId: targetUser._id,
        });
        if (existing) {
          await db.planMembers.update(
            { _id: existing._id },
            { $set: { role: req.body.permission } }
          );
        } else {
          await db.planMembers.insert({
            planId: req.params.id, userId: targetUser._id,
            role: req.body.permission, sharedBy: req.user.id,
          });
        }

        await helpers.createNotification({
          userId:  targetUser._id,
          type:    'share',
          title:   'Plan shared with you',
          message: `${req.user.name} shared "${plan.name}" with you (${req.body.permission} access)`,
          planId:  req.params.id,
        });

        ws.pushToUser(targetUser._id, {
          type:    'NOTIFICATION',
          payload: {
            message: `${req.user.name} shared "${plan.name}" with you`,
            type:    'share',
          },
        });
      }

      email.sendSharePlan({
        to:          req.body.email,
        sharerName:  req.user.name,
        planName:    plan.name,
        permission:  req.body.permission,
        planId:      req.params.id,
      }).catch(console.error);

      res.json({ success: true });
    }
  );

  // ===========================================================
  // SWOT ROUTES  /api/plans/:planId/swot
  // ===========================================================

  r.get('/plans/:planId/swot', auth.requireAuth, async (req, res) => {
    const access = await helpers.findPlanWithAccess(req.params.planId, req.user.id);
    if (!access) return res.status(403).json({ error: 'Access denied' });
    const items = await db.swotItems.find({ planId: req.params.planId, isDeleted: { $ne: true } });
    res.json({ items });
  });

  r.post('/plans/:planId/swot', auth.requireAuth,
    body('category').isIn(['strengths', 'weaknesses', 'opportunities', 'threats']),
    body('text').trim().notEmpty(),
    validate,
    async (req, res) => {
      const role = await helpers.getPlanRole(req.user.id, req.params.planId);
      if (!role || role === 'viewer') return res.status(403).json({ error: 'No edit access' });

      const item = await db.swotItems.insert({
        planId:    req.params.planId,
        category:  req.body.category,
        text:      req.body.text,
        evidence:  req.body.evidence || '',
        impact:    req.body.impact   || 'medium',
        ownerId:   req.user.id,
        isDeleted: false,
      });

      await helpers.logActivity({
        userId: req.user.id, userEmail: req.user.email, userName: req.user.name,
        planId: req.params.planId, action: 'added_swot_item', entityType: 'swot',
        entityId: item._id, details: `Added ${req.body.category}: ${req.body.text.slice(0, 60)}`,
      });

      ws.broadcastPlanUpdate(req.params.planId, 'PLAN_UPDATED', {
        section: 'swot', action: 'add', item, userName: req.user.name,
      }, req.user.id);

      res.status(201).json({ item });
    }
  );

  r.patch('/plans/:planId/swot/:id', auth.requireAuth, async (req, res) => {
    const role = await helpers.getPlanRole(req.user.id, req.params.planId);
    if (!role || role === 'viewer') return res.status(403).json({ error: 'No edit access' });

    const allowed = ['text', 'evidence', 'impact', 'category'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    await db.swotItems.update(
      { _id: req.params.id, planId: req.params.planId },
      { $set: update }
    );
    const item = await db.swotItems.findOne({ _id: req.params.id });

    ws.broadcastPlanUpdate(req.params.planId, 'PLAN_UPDATED',
      { section: 'swot', action: 'update', item }, req.user.id);
    res.json({ item });
  });

  r.delete('/plans/:planId/swot/:id', auth.requireAuth, async (req, res) => {
    const role = await helpers.getPlanRole(req.user.id, req.params.planId);
    if (!role || role === 'viewer') return res.status(403).json({ error: 'No edit access' });

    await db.swotItems.update({ _id: req.params.id }, { $set: { isDeleted: true } });
    ws.broadcastPlanUpdate(req.params.planId, 'PLAN_UPDATED',
      { section: 'swot', action: 'delete', id: req.params.id }, req.user.id);
    res.json({ success: true });
  });

  // ===========================================================
  // STRATEGY ROUTES  /api/plans/:planId/strategies
  // ===========================================================

  r.get('/plans/:planId/strategies', auth.requireAuth, async (req, res) => {
    const access = await helpers.findPlanWithAccess(req.params.planId, req.user.id);
    if (!access) return res.status(403).json({ error: 'Access denied' });
    const items = await db.strategies.find({ planId: req.params.planId, isDeleted: { $ne: true } });
    res.json({ items });
  });

  r.post('/plans/:planId/strategies', auth.requireAuth,
    body('type').isIn(['so', 'st', 'wo', 'wt']),
    body('text').trim().notEmpty(),
    validate,
    async (req, res) => {
      const role = await helpers.getPlanRole(req.user.id, req.params.planId);
      if (!role || role === 'viewer') return res.status(403).json({ error: 'No edit access' });

      const item = await db.strategies.insert({
        planId:    req.params.planId,
        type:      req.body.type,
        text:      req.body.text,
        priority:  req.body.priority || 'medium',
        ownerId:   req.user.id,
        isDeleted: false,
      });

      await helpers.logActivity({
        userId: req.user.id, userEmail: req.user.email, userName: req.user.name,
        planId: req.params.planId, action: 'added_strategy', entityType: 'strategy',
        details: `Added ${req.body.type.toUpperCase()} strategy`,
      });

      ws.broadcastPlanUpdate(req.params.planId, 'PLAN_UPDATED',
        { section: 'strategies', action: 'add', item }, req.user.id);
      res.status(201).json({ item });
    }
  );

  r.patch('/plans/:planId/strategies/:id', auth.requireAuth, async (req, res) => {
    const role = await helpers.getPlanRole(req.user.id, req.params.planId);
    if (!role || role === 'viewer') return res.status(403).json({ error: 'No edit access' });

    const update = {};
    for (const key of ['text', 'type', 'priority']) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    await db.strategies.update({ _id: req.params.id }, { $set: update });
    const item = await db.strategies.findOne({ _id: req.params.id });

    ws.broadcastPlanUpdate(req.params.planId, 'PLAN_UPDATED',
      { section: 'strategies', action: 'update', item }, req.user.id);
    res.json({ item });
  });

  r.delete('/plans/:planId/strategies/:id', auth.requireAuth, async (req, res) => {
    const role = await helpers.getPlanRole(req.user.id, req.params.planId);
    if (!role || role === 'viewer') return res.status(403).json({ error: 'No edit access' });

    await db.strategies.update({ _id: req.params.id }, { $set: { isDeleted: true } });
    ws.broadcastPlanUpdate(req.params.planId, 'PLAN_UPDATED',
      { section: 'strategies', action: 'delete', id: req.params.id }, req.user.id);
    res.json({ success: true });
  });

  // ===========================================================
  // KPI / SCORECARD ROUTES  /api/plans/:planId/kpis
  // ===========================================================

  r.get('/plans/:planId/kpis', auth.requireAuth, async (req, res) => {
    const access = await helpers.findPlanWithAccess(req.params.planId, req.user.id);
    if (!access) return res.status(403).json({ error: 'Access denied' });
    const items = await db.kpis.find({ planId: req.params.planId, isDeleted: { $ne: true } });
    res.json({ items });
  });

  r.post('/plans/:planId/kpis', auth.requireAuth,
    body('perspective').isIn(['financial', 'customer', 'internal', 'learning']),
    body('kpi').trim().notEmpty(),
    body('target').notEmpty(),
    validate,
    async (req, res) => {
      const role = await helpers.getPlanRole(req.user.id, req.params.planId);
      if (!role || role === 'viewer') return res.status(403).json({ error: 'No edit access' });

      const item = await db.kpis.insert({
        planId:      req.params.planId,
        perspective: req.body.perspective,
        kpi:         req.body.kpi,
        target:      req.body.target,
        actual:      req.body.actual || '',
        unit:        req.body.unit   || '',
        status:      req.body.status || 'on-track',
        weight:      parseFloat(req.body.weight) || 0.25,
        ownerId:     req.user.id,
        isDeleted:   false,
      });

      await helpers.logActivity({
        userId: req.user.id, userEmail: req.user.email, userName: req.user.name,
        planId: req.params.planId, action: 'added_kpi', entityType: 'kpi',
        details: `Added KPI: ${req.body.kpi}`,
      });

      ws.broadcastPlanUpdate(req.params.planId, 'PLAN_UPDATED',
        { section: 'kpis', action: 'add', item }, req.user.id);
      res.status(201).json({ item });
    }
  );

  r.patch('/plans/:planId/kpis/:id', auth.requireAuth, async (req, res) => {
    const role = await helpers.getPlanRole(req.user.id, req.params.planId);
    if (!role || role === 'viewer') return res.status(403).json({ error: 'No edit access' });

    const allowed = ['kpi', 'target', 'actual', 'unit', 'status', 'weight', 'perspective'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    await db.kpis.update({ _id: req.params.id }, { $set: update });
    const item = await db.kpis.findOne({ _id: req.params.id });

    // KPI alert: email plan owner when KPI falls behind or at-risk
    if (update.status && ['behind', 'at-risk'].includes(update.status)) {
      const plan  = await db.plans.findOne({ _id: req.params.planId });
      const owner = await db.users.findOne({ _id: plan.ownerId });
      if (owner) {
        email.sendKPIAlert({
          to:        owner.email,
          kpiName:   item.kpi,
          target:    item.target,
          actual:    item.actual,
          status:    update.status,
          planName:  plan.name,
          planId:    plan._id,
        }).catch(console.error);
      }
    }

    ws.broadcastPlanUpdate(req.params.planId, 'PLAN_UPDATED',
      { section: 'kpis', action: 'update', item }, req.user.id);
    res.json({ item });
  });

  r.delete('/plans/:planId/kpis/:id', auth.requireAuth, async (req, res) => {
    const role = await helpers.getPlanRole(req.user.id, req.params.planId);
    if (!role || role === 'viewer') return res.status(403).json({ error: 'No edit access' });

    await db.kpis.update({ _id: req.params.id }, { $set: { isDeleted: true } });
    ws.broadcastPlanUpdate(req.params.planId, 'PLAN_UPDATED',
      { section: 'kpis', action: 'delete', id: req.params.id }, req.user.id);
    res.json({ success: true });
  });

  // ===========================================================
  // INITIATIVE ROUTES  /api/plans/:planId/initiatives
  // ===========================================================

  r.get('/plans/:planId/initiatives', auth.requireAuth, async (req, res) => {
    const access = await helpers.findPlanWithAccess(req.params.planId, req.user.id);
    if (!access) return res.status(403).json({ error: 'Access denied' });

    const items = await db.initiatives.find({ planId: req.params.planId, isDeleted: { $ne: true } });

    // Compute budget totals server-side
    const totalBudget   = items.reduce((s, i) => s + (i.budget   || 0), 0);
    const totalUtilized = items.reduce((s, i) => s + (i.utilized || 0), 0);

    res.json({ items, totalBudget, totalUtilized, remaining: totalBudget - totalUtilized });
  });

  r.post('/plans/:planId/initiatives', auth.requireAuth,
    body('name').trim().notEmpty(),
    body('type').isIn(['program', 'activity', 'project']),
    validate,
    async (req, res) => {
      const role = await helpers.getPlanRole(req.user.id, req.params.planId);
      if (!role || role === 'viewer') return res.status(403).json({ error: 'No edit access' });

      const item = await db.initiatives.insert({
        planId:    req.params.planId,
        name:      req.body.name,
        type:      req.body.type,
        owner:     req.body.owner    || '',
        budget:    parseFloat(req.body.budget)   || 0,
        utilized:  parseFloat(req.body.utilized) || 0,
        progress:  parseInt(req.body.progress)   || 0,
        status:    req.body.status   || 'on-track',
        dueDate:   req.body.dueDate  || null,
        ownerId:   req.user.id,
        isDeleted: false,
      });

      await helpers.logActivity({
        userId: req.user.id, userEmail: req.user.email, userName: req.user.name,
        planId: req.params.planId, action: 'added_initiative', entityType: 'initiative',
        details: `Added ${req.body.type}: ${req.body.name}`,
      });

      ws.broadcastPlanUpdate(req.params.planId, 'PLAN_UPDATED',
        { section: 'initiatives', action: 'add', item }, req.user.id);
      res.status(201).json({ item });
    }
  );

  r.patch('/plans/:planId/initiatives/:id', auth.requireAuth, async (req, res) => {
    const role = await helpers.getPlanRole(req.user.id, req.params.planId);
    if (!role || role === 'viewer') return res.status(403).json({ error: 'No edit access' });

    const allowed = ['name', 'type', 'owner', 'budget', 'utilized', 'progress', 'status', 'dueDate'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    await db.initiatives.update({ _id: req.params.id }, { $set: update });
    const item = await db.initiatives.findOne({ _id: req.params.id });

    ws.broadcastPlanUpdate(req.params.planId, 'PLAN_UPDATED',
      { section: 'initiatives', action: 'update', item }, req.user.id);
    res.json({ item });
  });

  r.delete('/plans/:planId/initiatives/:id', auth.requireAuth, async (req, res) => {
    const role = await helpers.getPlanRole(req.user.id, req.params.planId);
    if (!role || role === 'viewer') return res.status(403).json({ error: 'No edit access' });

    await db.initiatives.update({ _id: req.params.id }, { $set: { isDeleted: true } });
    ws.broadcastPlanUpdate(req.params.planId, 'PLAN_UPDATED',
      { section: 'initiatives', action: 'delete', id: req.params.id }, req.user.id);
    res.json({ success: true });
  });

  // ===========================================================
  // COMMENT ROUTES  /api/plans/:planId/comments
  // ===========================================================

  r.get('/plans/:planId/comments', auth.requireAuth, async (req, res) => {
    const access = await helpers.findPlanWithAccess(req.params.planId, req.user.id);
    if (!access) return res.status(403).json({ error: 'Access denied' });

    const filter = { planId: req.params.planId, isDeleted: { $ne: true } };
    if (req.query.entityId) filter.entityId = req.query.entityId;
    const items = await db.comments.find(filter);
    res.json({ items });
  });

  r.post('/plans/:planId/comments', auth.requireAuth,
    body('entityId').notEmpty(),
    body('entityType').notEmpty(),
    body('text').trim().notEmpty(),
    validate,
    async (req, res) => {
      const access = await helpers.findPlanWithAccess(req.params.planId, req.user.id);
      if (!access) return res.status(403).json({ error: 'Access denied' });

      const comment = await db.comments.insert({
        planId:     req.params.planId,
        entityId:   req.body.entityId,
        entityType: req.body.entityType,
        entityName: req.body.entityName || '',
        text:       req.body.text,
        authorId:   req.user.id,
        authorName: req.user.name,
        resolved:   false,
        isDeleted:  false,
      });

      // Notify plan owner (if not the commenter)
      const plan = await db.plans.findOne({ _id: req.params.planId });
      if (plan.ownerId !== req.user.id) {
        const owner = await db.users.findOne({ _id: plan.ownerId });
        if (owner) {
          await helpers.createNotification({
            userId:  owner._id,
            type:    'comment',
            title:   'New comment on your plan',
            message: `${req.user.name} commented on ${req.body.entityType}: "${req.body.text.slice(0, 60)}..."`,
            planId:  req.params.planId,
            entityId: req.body.entityId,
          });
          ws.pushToUser(owner._id, {
            type:    'NOTIFICATION',
            payload: {
              type:    'comment',
              message: `${req.user.name} commented on ${req.body.entityType}`,
              planId:  req.params.planId,
            },
          });
          email.sendCommentNotification({
            to:           owner.email,
            commenterName: req.user.name,
            entityType:   req.body.entityType,
            entityName:   req.body.entityName,
            commentText:  req.body.text,
            planId:       req.params.planId,
          }).catch(console.error);
        }
      }

      ws.broadcastPlanUpdate(req.params.planId, 'COMMENT_ADDED', { comment }, req.user.id);
      res.status(201).json({ comment });
    }
  );

  r.patch('/plans/:planId/comments/:id/resolve', auth.requireAuth, async (req, res) => {
    const comment = await db.comments.findOne({ _id: req.params.id });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    await db.comments.update(
      { _id: req.params.id },
      { $set: { resolved: true, resolvedBy: req.user.id } }
    );

    // Notify original author
    if (comment.authorId !== req.user.id) {
      const author = await db.users.findOne({ _id: comment.authorId });
      if (author) {
        email.sendCommentResolved({
          to:           author.email,
          resolverName: req.user.name,
          entityName:   comment.entityName,
          planId:       req.params.planId,
        }).catch(console.error);
      }
    }

    res.json({ success: true });
  });

  r.delete('/plans/:planId/comments/:id', auth.requireAuth, async (req, res) => {
    const comment = await db.comments.findOne({ _id: req.params.id });
    if (!comment) return res.status(404).json({ error: 'Not found' });
    if (comment.authorId !== req.user.id && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: "Cannot delete another user's comment" });
    }
    await db.comments.update({ _id: req.params.id }, { $set: { isDeleted: true } });
    res.json({ success: true });
  });

  // ===========================================================
  // NOTIFICATION ROUTES  /api/notifications
  // ===========================================================

  /**
   * GET /api/notifications
   * ──────────────────────
   * [FIX-5] The original implementation had a broken ternary:
   *
   *   const items = await db.notifications.find({...}).sort({...}).limit ?
   *     (await db.notifications.find({...})).sort(...).slice(0, 50) :
   *     await db.notifications.find({...});
   *
   * The ternary tested `.limit` which is always a function (truthy),
   * so it always ran the double-query branch — two full collection
   * scans on every notification fetch.
   *
   * Fixed: single query, sort descending by createdAt in JS, slice to 50.
   */
  r.get('/notifications', auth.requireAuth, async (req, res) => {
    // [FIX-5] Single query — fetch all for user, sort newest-first, limit to 50
    const items = (await db.notifications.find({ userId: req.user.id }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);

    const unread = items.filter(n => !n.read).length;
    res.json({ items, unread });
  });

  r.patch('/notifications/read-all', auth.requireAuth, async (req, res) => {
    await db.notifications.update(
      { userId: req.user.id, read: false },
      { $set: { read: true } },
      { multi: true }
    );
    res.json({ success: true });
  });

  r.patch('/notifications/:id/read', auth.requireAuth, async (req, res) => {
    await db.notifications.update(
      { _id: req.params.id, userId: req.user.id },
      { $set: { read: true } }
    );
    res.json({ success: true });
  });

  // ===========================================================
  // ACTIVITY LOG  /api/plans/:planId/activity
  // ===========================================================

  r.get('/plans/:planId/activity', auth.requireAuth, async (req, res) => {
    const access = await helpers.findPlanWithAccess(req.params.planId, req.user.id);
    if (!access) return res.status(403).json({ error: 'Access denied' });

    const items = (await db.activityLog.find({ planId: req.params.planId }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 100);

    res.json({ items });
  });

  // ===========================================================
  // TEMPLATE ROUTES  /api/templates
  // ===========================================================

  r.get('/templates', auth.optionalAuth, async (req, res) => {
    const filter = { isPublic: true };
    if (req.query.industry) filter.industry = req.query.industry;

    const publicTemplates = await db.templates.find(filter);
    let myTemplates = [];
    if (req.user) {
      myTemplates = await db.templates.find({ ownerId: req.user.id, isPublic: { $ne: true } });
    }

    res.json({ public: publicTemplates, my: myTemplates });
  });

  r.post('/templates', auth.requireAuth,
    body('name').trim().notEmpty(),
    body('industry').notEmpty(),
    validate,
    async (req, res) => {
      const { name, industry, description, planId, isPublic } = req.body;

      let swotItems = {}, strategies = {}, kpis = [], initiatives = [];

      // Optionally clone from an existing plan the user has access to
      if (planId) {
        const access = await helpers.findPlanWithAccess(planId, req.user.id);
        if (access) {
          const [si, st, ki, ini] = await Promise.all([
            db.swotItems.find({ planId, isDeleted: { $ne: true } }),
            db.strategies.find({ planId, isDeleted: { $ne: true } }),
            db.kpis.find({ planId, isDeleted: { $ne: true } }),
            db.initiatives.find({ planId, isDeleted: { $ne: true } }),
          ]);
          for (const item of si) {
            if (!swotItems[item.category]) swotItems[item.category] = [];
            swotItems[item.category].push(item.text);
          }
          for (const item of st) {
            if (!strategies[item.type]) strategies[item.type] = [];
            strategies[item.type].push(item.text);
          }
          kpis       = ki.map(k  => ({ perspective: k.perspective, kpi: k.kpi, target: k.target, unit: k.unit || '' }));
          initiatives = ini.map(i => ({ name: i.name, type: i.type }));
        }
      }

      const tmpl = await db.templates.insert({
        name, industry, description: description || '',
        ownerId:   req.user.id,
        isPublic:  Boolean(isPublic),
        isBuiltIn: false,
        swotItems, strategies, kpis, initiatives,
      });

      res.status(201).json({ template: tmpl });
    }
  );

  r.delete('/templates/:id', auth.requireAuth, async (req, res) => {
    const tmpl = await db.templates.findOne({ _id: req.params.id });
    if (!tmpl) return res.status(404).json({ error: 'Not found' });
    if (tmpl.ownerId !== req.user.id && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Not your template' });
    }
    await db.templates.remove({ _id: req.params.id });
    res.json({ success: true });
  });

  // ===========================================================
  // SYNC ROUTE  /api/sync — bulk upsert for offline changes
  // ===========================================================

  r.post('/sync', auth.requireAuth, async (req, res) => {
    const { changes } = req.body;
    if (!Array.isArray(changes)) {
      return res.status(400).json({ error: 'changes must be an array' });
    }

    // Guard against oversized batches (DoS protection)
    if (changes.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 changes per sync request' });
    }

    const results = [];

    for (const change of changes) {
      try {
        const { type, operation, planId, data } = change;
        const role = await helpers.getPlanRole(req.user.id, planId);
        if (!role || role === 'viewer') {
          results.push({ id: change.clientId, status: 'rejected', reason: 'no_access' });
          continue;
        }

        const collectionMap = {
          swot:       db.swotItems,
          strategy:   db.strategies,
          kpi:        db.kpis,
          initiative: db.initiatives,
        };
        const coll = collectionMap[type];
        if (!coll) {
          results.push({ id: change.clientId, status: 'rejected', reason: 'unknown_type' });
          continue;
        }

        if (operation === 'upsert') {
          if (data._id) {
            const existing = await coll.findOne({ _id: data._id });
            if (existing) {
              // Last-write-wins using clientTimestamp vs server updatedAt
              const serverTs = new Date(existing.updatedAt).getTime();
              const clientTs = change.timestamp || 0;
              if (clientTs >= serverTs) {
                const { _id, ...rest } = data;
                await coll.update({ _id }, { $set: { ...rest, planId } });
                results.push({ id: change.clientId, status: 'applied', serverId: _id });
              } else {
                results.push({ id: change.clientId, status: 'conflict', serverData: existing });
              }
            } else {
              await coll.insert({ ...data, planId, ownerId: req.user.id });
              results.push({ id: change.clientId, status: 'applied', serverId: data._id });
            }
          } else {
            const inserted = await coll.insert({
              ...data, planId, ownerId: req.user.id, isDeleted: false,
            });
            results.push({ id: change.clientId, status: 'applied', serverId: inserted._id });
          }
        } else if (operation === 'delete') {
          await coll.update({ _id: data._id }, { $set: { isDeleted: true } });
          results.push({ id: change.clientId, status: 'applied' });
        }
      } catch (err) {
        results.push({ id: change.clientId, status: 'error', reason: err.message });
      }
    }

    res.json({ results, syncedAt: new Date().toISOString() });
  });

  // ===========================================================
  // ADMIN ROUTES  /api/admin/* — super_admin only
  // ===========================================================

  r.get('/admin/stats', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const [userCount, planCount, orgCount, activityCount, templateCount] = await Promise.all([
      db.users.count({}),
      db.plans.count({ isDeleted: { $ne: true } }),
      db.organizations.count({}),
      db.activityLog.count({}),
      db.templates.count({}),
    ]);

    const wsStats = ws.getStats();

    res.json({
      users:          userCount,
      plans:          planCount,
      organizations:  orgCount,
      activityLogs:   activityCount,
      templates:      templateCount,
      ws:             wsStats,
      serverTime:     new Date().toISOString(),
      uptime:         process.uptime(),
      memory:         process.memoryUsage(),
    });
  });

  r.get('/admin/users', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const page  = parseInt(req.query.page  || '1',  10);
    const limit = parseInt(req.query.limit || '20', 10);
    const skip  = (page - 1) * limit;

    const all   = await db.users.find({});
    const total = all.length;
    const users = all
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(skip, skip + limit)
      .map(safeUser);

    res.json({ users, total, page, limit, pages: Math.ceil(total / limit) });
  });

  r.patch('/admin/users/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const { role, isActive } = req.body;
    const update = {};
    if (role !== undefined)     update.role     = role;
    if (isActive !== undefined) update.isActive = isActive;

    await db.users.update({ _id: req.params.id }, { $set: update });
    const user = await db.users.findOne({ _id: req.params.id });
    res.json({ user: safeUser(user) });
  });

  r.delete('/admin/users/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    await db.users.update({ _id: req.params.id }, { $set: { isActive: false } });
    await auth.revokeAllUserTokens(req.params.id);
    res.json({ success: true });
  });

  r.get('/admin/audit-log', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const all    = await db.activityLog.find({});
    const sorted = all
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 200);
    res.json({ items: sorted });
  });

  r.get('/admin/plans', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const plans = await db.plans.find({ isDeleted: { $ne: true } });
    res.json({ plans });
  });

  // ===========================================================
  // HEALTH CHECK  /api/health
  // ===========================================================

  r.get('/health', (req, res) => {
    res.json({
      status:  'ok',
      service: 'Strat Planner Pro API',
      version: '1.0.0',
      time:    new Date().toISOString(),
      uptime:  process.uptime(),
    });
  });

  return r;
}

module.exports = { router };
