/**
 * REST API Routes
 * ~45 endpoints covering auth, orgs, plans, SWOT, KPIs, initiatives, comments, templates
 */
import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import {
    requireAuth,
    optionalAuth,
    requireAdminRole,
    requireSuperAdmin
} from './auth.js';
import {
    hashPassword,
    verifyPassword,
    generateAccessToken,
    generateRefreshToken,
    verifyToken
} from './auth.js';
import * as db from './db.js';
import * as emailService from './email.js';

const router = express.Router();

// Health Check
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Strat Planner Pro API',
        version: '1.0.0',
        time: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ========================= AUTH ROUTES =========================

// Register
router.post('/auth/register',
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
    body('firstName').notEmpty(),
    body('lastName').notEmpty(),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { email, password, firstName, lastName } = req.body;
        
        const existing = await db.users.findOne({ email: email.toLowerCase() });
        if (existing) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        
        const hashedPassword = await hashPassword(password);
        const userId = crypto.randomUUID();
        const initials = firstName[0] + lastName[0].toUpperCase();
        const colors = [
            'linear-gradient(135deg, #6366F1, #8B5CF6)',
            'linear-gradient(135deg, #10B981, #34D399)',
            'linear-gradient(135deg, #EF4444, #F87171)',
            'linear-gradient(135deg, #F59E0B, #FBBF24)',
            'linear-gradient(135deg, #EC4899, #F472B6)'
        ];
        
        await db.users.insert({
            _id: userId,
            email: email.toLowerCase(),
            password: hashedPassword,
            firstName,
            lastName,
            initials,
            role: 'user',
            color: colors[Math.floor(Math.random() * colors.length)],
            isActive: true,
            emailVerified: false,
            createdAt: new Date().toISOString()
        });
        
        const accessToken = generateAccessToken(userId, 'user');
        const refreshToken = generateRefreshToken(userId);
        await db.refresh_tokens.insert({
            token: refreshToken,
            userId,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            used: false
        });
        
        await emailService.sendWelcome(email, firstName);
        
        res.status(201).json({
            user: {
                _id: userId,
                email,
                firstName,
                lastName,
                initials,
                role: 'user',
                isActive: true
            },
            accessToken,
            refreshToken
        });
    }
);

// Login
router.post('/auth/login',
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { email, password } = req.body;
        const user = await db.users.findOne({ email: email.toLowerCase() });
        
        if (!user || !await verifyPassword(password, user.password)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        if (!user.isActive) {
            return res.status(403).json({ error: 'Account deactivated' });
        }
        
        const accessToken = generateAccessToken(user._id, user.role);
        const refreshToken = generateRefreshToken(user._id);
        
        await db.refresh_tokens.insert({
            token: refreshToken,
            userId: user._id,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            used: false
        });
        
        logActivity(user._id, user.email, user.firstName, null, 'login', 'auth', null, 'Successfully logged in');
        
        res.json({
            user: {
                _id: user._id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                initials: user.initials,
                role: user.role,
                isActive: user.isActive
            },
            accessToken,
            refreshToken
        });
    }
);

// Refresh Token
router.post('/auth/refresh',
    body('refreshToken').notEmpty(),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { refreshToken } = req.body;
        const tokenRecord = await db.refresh_tokens.findOne({ token: refreshToken, used: false });
        
        if (!tokenRecord) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }
        
        if (new Date() > new Date(tokenRecord.expiresAt)) {
            await db.refresh_tokens.remove({ token: refreshToken });
            return res.status(401).json({ error: 'Expired refresh token' });
        }
        
        // Invalidate old token
        await db.refresh_tokens.update(
            { token: refreshToken },
            { $set: { used: true } }
        );
        
        const user = await db.users.findOne({ _id: tokenRecord.userId });
        if (!user || !user.isActive) {
            return res.status(401).json({ error: 'User no longer active' });
        }
        
        const newAccessToken = generateAccessToken(user._id, user.role);
        const newRefreshToken = generateRefreshToken(user._id);
        
        await db.refresh_tokens.insert({
            token: newRefreshToken,
            userId: user._id,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            used: false
        });
        
        res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
    }
);

// Get Current User
router.get('/auth/me', requireAuth, async (req, res) => {
    const user = await db.users.findOne({ _id: req.user.userId }, { password: 0 });
    delete user.password;
    res.json(user);
});

// ========================= PLANS ROUTES =========================

// List Plans
router.get('/plans', requireAuth, async (req, res) => {
    const ownedPlans = await db.plans.find({ ownerId: req.user.userId, isDeleted: false });
    const sharedPlans = await db.plan_members.find({ userId: req.user.userId });
    
    const sharedPlanIds = sharedPlans.filter(m => m.userId === req.user.userId).map(m => m.planId);
    const sharedPlanDetails = await db.plans.find({ _id: { $in: sharedPlanIds }, isDeleted: false });
    
    res.json({
        owned: ownedPlans.map(p => ({ ...p, role: 'owner' })),
        shared: sharedPlanDetails.map(p => ({ ...p, role: sharedPlans.find(m => m.planId === p._id)?.role }))
    });
});

// Create Plan
router.post('/plans',
    requireAuth,
    body('name').notEmpty(),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { name, period, orgId, description, templateId } = req.body;
        const planId = crypto.randomUUID();
        
        const plan = {
            _id: planId,
            name,
            period,
            orgId,
            description,
            ownerId: req.user.userId,
            isDeleted: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        await db.plans.insert(plan);
        
        // Add creator as admin member
        await db.plan_members.insert({
            planId,
            userId: req.user.userId,
            role: 'admin',
            sharedBy: req.user.userId
        });
        
        // Clone template if provided
        if (templateId) {
            const template = await db.templates.findOne({ _id: templateId });
            if (template) {
                await cloneTemplateToPlan(templateId, planId);
            }
        }
        
        // Broadcast update via WebSocket
        broadcastUpdate(planId, 'create', 'plan');
        
        res.status(201).json(plan);
    }
);

// Get Plan
router.get('/plans/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    
    const plan = await db.plans.findOne({ _id: id, isDeleted: false });
    if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
    }
    
    // Verify membership
    const membership = await db.plan_members.findOne({ planId: id, userId: req.user.userId });
    if (!membership && plan.ownerId !== req.user.userId) {
        return res.status(403).json({ error: 'Not authorized to view this plan' });
    }
    
    const swotItems = await db.swot_items.find({ planId: id, isDeleted: false });
    const strategies = await db.strategies.find({ planId: id, isDeleted: false });
    const kpis = await db.kpis.find({ planId: id, isDeleted: false });
    const initiatives = await db.initiatives.find({ planId: id, isDeleted: false });
    const comments = await db.comments.find({ planId: id, isDeleted: false });
    const members = await db.plan_members.find({ planId: id })
        .then(async (mems) => {
            const usersList = await Promise.all(mems.map(m => db.users.findOne({ _id: m.userId }), { password: 0 }));
            return mems.map((m, i) => ({ ...m, ...usersList[i] }));
        });
    
    res.json({
        plan,
        role: membership?.role || 'owner',
        swotItems,
        strategies,
        kpis,
        initiatives,
        comments,
        members
    });
});

// Update Plan
router.patch('/plans/:id', requireAuth,
    body('name').optional().notEmpty(),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { id } = req.params;
        const { name, period, description, orgId } = req.body;
        const updates = {};
        
        if (name !== undefined) updates.name = name;
        if (period !== undefined) updates.period = period;
        if (description !== undefined) updates.description = description;
        if (orgId !== undefined) updates.orgId = orgId;
        updates.updatedAt = new Date().toISOString();
        
        const membership = await db.plan_members.findOne({ planId: id, userId: req.user.userId });
        if (!membership && id !== req.user.userId) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        
        await db.plans.update({ _id: id }, { $set: updates });
        broadcastUpdate(id, 'update', 'plan');
        
        res.json({ success: true, updatedFields: Object.keys(updates) });
    }
);

// ========================= SWOT ROUTES =========================

// List SWOT Items
router.get('/plans/:planId/swot', requireAuth, async (req, res) => {
    const { planId } = req.params;
    const items = await db.swot_items.find({ planId, isDeleted: false });
    res.json(items);
});

// Create SWOT Item
router.post('/plans/:planId/swot',
    requireAuth,
    body('category').isIn(['strengths', 'weaknesses', 'opportunities', 'threats']),
    body('text').notEmpty().trim().escape(),
    body('impact').optional().isIn(['high', 'medium', 'low']),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { planId } = req.params;
        const { category, text, evidence, impact = 'medium' } = req.body;
        
        const item = {
            _id: crypto.randomUUID(),
            planId,
            category,
            text: sanitize(text),
            evidence: evidence ? sanitize(evidence) : '',
            impact,
            ownerId: req.user.userId,
            isDeleted: false,
            createdAt: new Date().toISOString()
        };
        
        await db.swot_items.insert(item);
        logActivity(req.user.userId, null, null, planId, 'add_swot_item', 'swot', item._id, `Added ${category} SWOT item`);
        broadcastUpdate(planId, 'create', 'swot', item);
        
        res.status(201).json(item);
    }
);

// Delete SWOT Item
router.delete('/plans/:planId/swot/:itemId', requireAuth, async (req, res) => {
    const { planId, itemId } = req.params;
    
    const item = await db.swot_items.findOne({ _id: itemId, planId });
    if (!item) {
        return res.status(404).json({ error: 'Item not found' });
    }
    
    await db.swot_items.update({ _id: itemId }, { $set: { isDeleted: true, deletedAt: new Date().toISOString() } });
    logActivity(req.user.userId, null, null, planId, 'delete_swot_item', 'swot', itemId, 'Deleted SWOT item');
    broadcastUpdate(planId, 'delete', 'swot', itemId);
    
    res.json({ success: true });
});

// ========================= KPI ROUTES =========================

// List KPIs
router.get('/plans/:planId/kpis', requireAuth, async (req, res) => {
    const { planId } = req.params;
    const kpis = await db.kpis.find({ planId, isDeleted: false });
    res.json(kpis);
});

// Create KPI
router.post('/plans/:planId/kpis',
    requireAuth,
    body('perspective').isIn(['financial', 'customer', 'internal', 'learning']),
    body('kpi').notEmpty(),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { planId } = req.params;
        const { perspective, kpi, target, actual, unit, weight = 1, status = 'on-track' } = req.body;
        
        const kpiItem = {
            _id: crypto.randomUUID(),
            planId,
            perspective,
            kpi: sanitize(kpi),
            target,
            actual,
            unit,
            status,
            weight,
            ownerId: req.user.userId,
            isDeleted: false,
            createdAt: new Date().toISOString()
        };
        
        await db.kpis.insert(kpiItem);
        logActivity(req.user.userId, null, null, planId, 'add_kpi', 'kpi', kpiItem._id, `Added KPI ${kpi}`);
        broadcastUpdate(planId, 'create', 'kpi', kpiItem);
        
        res.status(201).json(kpiItem);
    }
);

// Update KPI Status (triggers alert)
router.patch('/plans/:planId/kpis/:id', requireAuth,
    body('status').optional().isIn(['on-track', 'at-risk', 'behind', 'complete']),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { planId, id } = req.params;
        const { status } = req.body;
        
        const kpi = await db.kpis.findOne({ _id: id, planId });
        if (!kpi) {
            return res.status(404).json({ error: 'KPI not found' });
        }
        
        if (kpi.status !== status) {
            await db.kpis.update({ _id: id }, { $set: { status, updatedAt: new Date().toISOString() } });
            
            // Send KPI alert if at-risk or behind
            if (['at-risk', 'behind'].includes(status)) {
                const owner = await db.users.findOne({ _id: kpi.ownerId });
                if (owner && owner.email !== req.user.email) {
                    await emailService.sendKpiAlert(owner.email, kpi.kpi, status);
                }
            }
            
            broadcastUpdate(planId, 'update', 'kpi', { id, status });
        }
        
        res.json({ success: true });
    }
);

// ========================= INITIATIVES ROUTES =========================

// List Initiatives
router.get('/plans/:planId/initiatives', requireAuth, async (req, res) => {
    const { planId } = req.params;
    const items = await db.initiatives.find({ planId, isDeleted: false });
    
    // Calculate totals
    const totalBudget = items.reduce((sum, i) => sum + (Number(i.budget) || 0), 0);
    const totalUtilized = items.reduce((sum, i) => sum + (Number(i.utilized) || 0), 0);
    
    res.json({
        items,
        summary: {
            totalBudget,
            totalUtilized,
            remaining: totalBudget - totalUtilized
        }
    });
});

// ========================= COMMENTS ROUTES =========================

// Create Comment
router.post('/plans/:planId/comments',
    requireAuth,
    body('entityId').notEmpty(),
    body('entityType').isIn(['swot', 'kpi', 'initiative', 'strategy']),
    body('text').notEmpty(),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { planId } = req.params;
        const { entityId, entityType, entityName, text } = req.body;
        
        const comment = {
            _id: crypto.randomUUID(),
            planId,
            entityId,
            entityType,
            entityName: sanitize(entityName || 'Unknown'),
            text: sanitize(text),
            authorId: req.user.userId,
            authorName: `${req.user.firstName} ${req.user.lastName}`,
            resolved: false,
            isDeleted: false,
            createdAt: new Date().toISOString()
        };
        
        await db.comments.insert(comment);
        notifyCommentCreator(planId, comment.authorId, comment._id);
        broadcastUpdate(planId, 'create', 'comment', comment);
        
        res.status(201).json(comment);
    }
);

// Resolve Comment
router.patch('/plans/:planId/comments/:id/resolve', requireAuth, async (req, res) => {
    const { planId, id } = req.params;
    
    const comment = await db.comments.findOne({ _id: id, planId });
    if (!comment) {
        return res.status(404).json({ error: 'Comment not found' });
    }
    
    const author = await db.users.findOne({ _id: comment.authorId });
    if (author && author.email !== req.user.email) {
        await emailService.sendCommentResolved(author.email, comment.entityName);
    }
    
    await db.comments.update({ _id: id }, { $set: { resolved: true, resolvedBy: req.user.userId, resolvedAt: new Date().toISOString() } });
    broadcastUpdate(planId, 'update', 'comment', { id, resolved: true });
    
    res.json({ success: true });
});

// ========================= NOTIFICATIONS ROUTES =========================

// List Notifications
router.get('/notifications', requireAuth, async (req, res) => {
    const notifications = await db.notifications.find({ userId: req.user.userId }, { read: 1, count: 1 });
    const unreadCount = await db.notifications.count({ userId: req.user.userId, read: false });
    
    res.json({
        notifications,
        unreadCount
    });
});

// Mark All as Read
router.patch('/notifications/read-all', requireAuth, async (req, res) => {
    await db.notifications.update({ userId: req.user.userId, read: false }, { $set: { read: true, readAt: new Date().toISOString() } }, { multi: true });
    res.json({ success: true });
});

// ========================= TEMPLATES ROUTES =========================

// Get Public Templates
router.get('/templates', optionalAuth, async (req, res) => {
    const industry = req.query.industry;
    let filters = { isPublic: true };
    if (industry) filters.industry = industry;
    
    const publicTemplates = await db.templates.find(filters);
    
    res.json({
        public: publicTemplates
    });
});

// ========================= SYNC ROUTES (Offline Support) =========================

// Sync Offline Changes
router.post('/sync', requireAuth, async (req, res) => {
    const { changes } = req.body;
    
    if (!Array.isArray(changes) || changes.length > 100) {
        return res.status(400).json({ error: 'Invalid batch size' });
    }
    
    const results = [];
    
    for (const change of changes) {
        try {
            let result;
            
            switch (change.type) {
                case 'swot':
                case 'strategies':
                case 'kpis':
                case 'initiatives':
                    if (change.operation === 'upsert') {
                        result = await handleUpsert(change, req.user.userId);
                    } else if (change.operation === 'delete') {
                        result = await handleDelete(change, req.user.userId);
                    }
                    break;
                default:
                    result = { status: 'rejected', reason: 'Unknown operation' };
            }
            
            results.push({
                clientId: change.clientId,
                status: result?.status || 'error',
                ...(result || {})
            });
        } catch (err) {
            results.push({
                clientId: change.clientId,
                status: 'error',
                message: err.message
            });
        }
    }
    
    res.json({
        results,
        syncedAt: new Date().toISOString()
    });
});

// Helper Functions
function sanitize(str) {
    return String(str).replace(/[<>]/g, '').trim();
}

function logActivity(userId, userEmail, userName, planId, action, entityType, entityId, details) {
    db.activity_log.insert({
        userId,
        userEmail: userEmail || 'unknown',
        userName: userName || 'unknown',
        planId,
        action,
        entityType,
        entityId,
        details,
        ipAddress: 'local',
        timestamp: new Date().toISOString()
    });
}

function broadcastUpdate(planId, action, section, itemOrId) {
    // Emit to WebSocket room
    const socketMessage = JSON.stringify({
        type: 'PLAN_UPDATED',
        payload: { section, action, itemOrId }
    });
    sendToRoom(planId, socketMessage);
}

function sendToRoom(roomId, message) {
    // Access WebSocket room Map
    // import { rooms } from '../ws.js';
    const room = rooms.get(roomId);
    if (room) {
        room.forEach(ws => ws.send(message));
    }
}

// Export routes
export default router;
