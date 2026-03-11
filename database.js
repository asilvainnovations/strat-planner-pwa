/**
 * ============================================================
 * STRAT PLANNER PRO — DATABASE LAYER
 * ============================================================
 * Engine  : NeDB (embedded, file-backed, MongoDB-like API)
 * Location: ./data/*.db  (one file per collection)
 *
 * Collections
 * ───────────
 *  users            — accounts & auth
 *  organizations    — org/team entities
 *  org_members      — user↔org membership + roles
 *  plans            — strategic plans (header)
 *  plan_members     — user↔plan sharing + permissions
 *  swot_items       — SWOT entries per plan
 *  strategies       — SO/ST/WO/WT per plan
 *  kpis             — Balanced Scorecard KPIs
 *  initiatives      — Programs / Activities / Projects
 *  comments         — threaded comments on any entity
 *  notifications    — in-app + email notification queue
 *  activity_log     — full audit trail
 *  templates        — reusable plan templates
 *  invitations      — pending email invites
 *  refresh_tokens   — JWT refresh token store
 * ============================================================
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const Datastore = require('nedb-promises');

// ── Ensure data directory exists ──────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH, { recursive: true });

function store(name, options = {}) {
  return Datastore.create({
    filename: path.join(DB_PATH, `${name}.db`),
    autoload: true,
    timestampData: true,       // auto-adds createdAt / updatedAt
    ...options,
  });
}

// ── Collections ───────────────────────────────────────────
const db = {
  users:          store('users'),
  organizations:  store('organizations'),
  orgMembers:     store('org_members'),
  plans:          store('plans'),
  planMembers:    store('plan_members'),
  swotItems:      store('swot_items'),
  strategies:     store('strategies'),
  kpis:           store('kpis'),
  initiatives:    store('initiatives'),
  comments:       store('comments'),
  notifications:  store('notifications'),
  activityLog:    store('activity_log'),
  templates:      store('templates'),
  invitations:    store('invitations'),
  refreshTokens:  store('refresh_tokens'),
};

// ── Indexes ───────────────────────────────────────────────
async function ensureIndexes() {
  // users
  await db.users.ensureIndex({ fieldName: 'email', unique: true });

  // org members
  await db.orgMembers.ensureIndex({ fieldName: 'orgId' });
  await db.orgMembers.ensureIndex({ fieldName: 'userId' });

  // plans
  await db.plans.ensureIndex({ fieldName: 'orgId' });
  await db.plans.ensureIndex({ fieldName: 'ownerId' });

  // plan members
  await db.planMembers.ensureIndex({ fieldName: 'planId' });
  await db.planMembers.ensureIndex({ fieldName: 'userId' });

  // swot items
  await db.swotItems.ensureIndex({ fieldName: 'planId' });

  // strategies
  await db.strategies.ensureIndex({ fieldName: 'planId' });

  // kpis
  await db.kpis.ensureIndex({ fieldName: 'planId' });

  // initiatives
  await db.initiatives.ensureIndex({ fieldName: 'planId' });

  // comments
  await db.comments.ensureIndex({ fieldName: 'entityId' });
  await db.comments.ensureIndex({ fieldName: 'planId' });

  // notifications
  await db.notifications.ensureIndex({ fieldName: 'userId' });
  await db.notifications.ensureIndex({ fieldName: 'read' });

  // activity log
  await db.activityLog.ensureIndex({ fieldName: 'planId' });
  await db.activityLog.ensureIndex({ fieldName: 'userId' });

  // templates
  await db.templates.ensureIndex({ fieldName: 'industry' });
  await db.templates.ensureIndex({ fieldName: 'isPublic' });

  // invitations
  await db.invitations.ensureIndex({ fieldName: 'token', unique: true });
  await db.invitations.ensureIndex({ fieldName: 'email' });

  // refresh tokens
  await db.refreshTokens.ensureIndex({ fieldName: 'token', unique: true });
  await db.refreshTokens.ensureIndex({ fieldName: 'userId' });

  console.log('[DB] Indexes ensured');
}

// ── Seed admin user + built-in templates ──────────────────
async function seed() {
  const { hashPassword } = require('./auth');
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@asilvainnovations.com';
  const adminPass  = process.env.ADMIN_PASSWORD || 'StratAdmin@2025!';

  const existing = await db.users.findOne({ email: adminEmail });
  if (!existing) {
    const hash = await hashPassword(adminPass);
    await db.users.insert({
      email:     adminEmail,
      password:  hash,
      firstName: 'Admin',
      lastName:  'User',
      role:      'super_admin',
      initials:  'AD',
      color:     'linear-gradient(135deg,#FFD700,#FFA500)',
      isActive:  true,
      emailVerified: true,
    });
    console.log(`[DB] Admin seeded: ${adminEmail}`);
  }

  // Seed built-in templates
  const templateCount = await db.templates.count({ isBuiltIn: true });
  if (templateCount === 0) {
    await db.templates.insert(BUILT_IN_TEMPLATES);
    console.log(`[DB] ${BUILT_IN_TEMPLATES.length} built-in templates seeded`);
  }
}

// ── Built-in Template Data ─────────────────────────────────
const BUILT_IN_TEMPLATES = [
  {
    name: 'Local Government Unit (LGU) Strategic Plan',
    industry: 'government',
    emoji: '🏛',
    description: '5-year development plan aligned with Philippine Comprehensive Land Use Plan guidelines.',
    isBuiltIn: true,
    isPublic: true,
    swotItems: {
      strengths: [
        'Strong executive leadership with clear governance mandate',
        'Established community partnerships and stakeholder networks',
        'Access to national government funding mechanisms and grants',
      ],
      weaknesses: [
        'Limited digital infrastructure and e-government capabilities',
        'Understaffed technical departments hindering project execution',
        'Dependence on IRA limiting financial flexibility',
      ],
      opportunities: [
        'Digital Governance programs under DICT and DILG mandates',
        'Public-private partnership frameworks enabling infrastructure co-investment',
        'Tourism and economic zone development potential',
      ],
      threats: [
        'Natural disaster risk requiring resilience investment',
        'Rapid urbanization creating service demand beyond capacity',
        'Political transition risks affecting multi-year program continuity',
      ],
    },
    strategies: {
      so: ['Leverage executive mandate to fast-track PPP for smart city initiatives'],
      st: ['Build disaster resilience through NDRRMC-aligned community programs'],
      wo: ['Apply for DILG digitalization grants to upgrade e-governance systems'],
      wt: ['Institutionalize transition protocols to survive political changes'],
    },
    kpis: [
      { perspective: 'financial', kpi: 'Own-Source Revenue Growth', target: '15%', unit: '%' },
      { perspective: 'customer', kpi: 'Citizen Satisfaction Rating', target: '80%', unit: '%' },
      { perspective: 'internal', kpi: 'Service Permit Processing Time', target: '3 days', unit: 'days' },
      { perspective: 'learning', kpi: 'Staff Training Hours / Year', target: '40', unit: 'hours' },
    ],
    initiatives: [
      { name: 'e-Gov Portal Launch', type: 'project' },
      { name: 'Revenue Enhancement Program', type: 'program' },
      { name: 'Disaster Risk Reduction Plan', type: 'activity' },
    ],
  },
  {
    name: 'Hospital / Health System Strategy',
    industry: 'healthcare',
    emoji: '🏥',
    description: 'Quality improvement and patient safety focused plan for regional and tertiary hospitals.',
    isBuiltIn: true,
    isPublic: true,
    swotItems: {
      strengths: [
        'Accredited clinical programs with highly trained medical specialists',
        'Strong referral network with community health centers',
        'Government PhilHealth accreditation securing consistent revenue',
      ],
      weaknesses: [
        'Aging medical equipment limiting diagnostic accuracy and throughput',
        'High nurse-to-patient ratio creating burnout and quality risk',
        'Paper-based records slowing clinical decision-making',
      ],
      opportunities: [
        'Telemedicine adoption expanding geographic service reach',
        'Universal Health Care law increasing PhilHealth funding',
        'Medical tourism growth in ASEAN post-pandemic',
      ],
      threats: [
        'Health worker brain drain to international hospitals',
        'Rising pharmaceutical and supply costs compressing margins',
        'Emerging infectious disease threats requiring surge capacity',
      ],
    },
    strategies: {
      so: ['Scale telemedicine using clinical expertise to reach underserved communities'],
      st: ['Develop retention packages to counter international recruitment competition'],
      wo: ['Leverage UHC funding to modernize diagnostic equipment'],
      wt: ['Build surge capacity protocols to manage pandemic-level demand'],
    },
    kpis: [
      { perspective: 'financial', kpi: 'Revenue per Bed per Day', target: '₱8,500', unit: '₱' },
      { perspective: 'customer', kpi: 'Patient Satisfaction Score', target: '90%', unit: '%' },
      { perspective: 'internal', kpi: 'Average Length of Stay', target: '4.2 days', unit: 'days' },
      { perspective: 'learning', kpi: 'CME Hours per Physician', target: '50', unit: 'hours' },
    ],
    initiatives: [
      { name: 'Electronic Medical Records Rollout', type: 'project' },
      { name: 'Telemedicine Platform', type: 'program' },
      { name: 'Nurse Retention Program', type: 'activity' },
    ],
  },
  {
    name: 'Tech Startup Growth Strategy',
    industry: 'technology',
    emoji: '💻',
    description: 'Lean strategy framework for early-stage tech companies targeting Series A/B funding.',
    isBuiltIn: true,
    isPublic: true,
    swotItems: {
      strengths: [
        'Agile engineering team with rapid iteration capability',
        'Unique IP and proprietary algorithm providing competitive moat',
        'Early adopter base providing validated product-market fit signals',
      ],
      weaknesses: [
        'Limited runway (< 18 months) creating funding urgency',
        'Single-threaded revenue model increasing concentration risk',
        'Founder-dependent operations lacking process maturity',
      ],
      opportunities: [
        'AI/ML tooling maturation reducing development costs by 40%',
        'Enterprise digital transformation budgets expanding TAM',
        'Regional fintech/govtech regulatory sandbox programs',
      ],
      threats: [
        'Well-funded incumbents with distribution advantages',
        'Talent war for senior engineers driving up burn rate',
        'Data privacy regulation changes requiring product rearchitecture',
      ],
    },
    strategies: {
      so: ['Double down on AI features to widen moat before incumbents catch up'],
      st: ['Build enterprise-grade compliance features to neutralize regulatory risk'],
      wo: ['Pursue Series A to extend runway and hire process-oriented operators'],
      wt: ['Diversify revenue streams to reduce single-customer concentration'],
    },
    kpis: [
      { perspective: 'financial', kpi: 'Monthly Recurring Revenue', target: '₱2.5M', unit: '₱' },
      { perspective: 'customer', kpi: 'Net Revenue Retention', target: '110%', unit: '%' },
      { perspective: 'internal', kpi: 'Product Velocity (story pts/sprint)', target: '85', unit: 'pts' },
      { perspective: 'learning', kpi: 'Employee Net Promoter Score', target: '55', unit: 'score' },
    ],
    initiatives: [
      { name: 'Series A Fundraising', type: 'program' },
      { name: 'Enterprise Product Track', type: 'activity' },
      { name: 'Platform AI Layer', type: 'project' },
    ],
  },
  {
    name: 'Higher Education Institution Plan',
    industry: 'education',
    emoji: '🎓',
    description: 'Institutional strategic plan aligned with CHED requirements and CMO standards.',
    isBuiltIn: true,
    isPublic: true,
    swotItems: {
      strengths: [
        'CHED Center of Excellence recognition in core programs',
        'Strong alumni network with industry placement reach',
        'Research-active faculty with international publications',
      ],
      weaknesses: [
        'Aging campus infrastructure limiting student experience quality',
        'Limited industry linkage programs reducing graduate employability',
        'Low faculty-to-student ratio in high-demand programs',
      ],
      opportunities: [
        'Online and hybrid learning expanding enrollment beyond geography',
        'Industry-academe partnership programs funded by CHED',
        'International student recruitment from ASEAN markets',
      ],
      threats: [
        'Declining K-12 pipeline due to demographic shifts',
        'Competition from online universities and micro-credential providers',
        'CHED regulatory changes requiring costly program revisions',
      ],
    },
    strategies: {
      so: ['Leverage CoE status to attract international students and partnerships'],
      st: ['Develop micro-credential programs to compete with online providers'],
      wo: ['Apply for CHED grants to upgrade labs and learning facilities'],
      wt: ['Build flexible learning infrastructure to buffer demographic risk'],
    },
    kpis: [
      { perspective: 'financial', kpi: 'Revenue per Student', target: '₱85,000', unit: '₱' },
      { perspective: 'customer', kpi: 'Graduate Employment Rate (6 months)', target: '92%', unit: '%' },
      { perspective: 'internal', kpi: 'Research Output (publications/year)', target: '45', unit: 'pubs' },
      { perspective: 'learning', kpi: 'Faculty with Doctoral Degree', target: '65%', unit: '%' },
    ],
    initiatives: [
      { name: 'Online Learning Platform', type: 'project' },
      { name: 'Industry Linkage Program', type: 'program' },
      { name: 'Research Excellence Initiative', type: 'activity' },
    ],
  },
  {
    name: 'Digital Transformation Roadmap',
    industry: 'technology',
    emoji: '🔄',
    description: 'Enterprise IT modernization and digitalization strategy with phased implementation.',
    isBuiltIn: true,
    isPublic: true,
    swotItems: {
      strengths: [
        'Executive commitment and digital transformation budget approved',
        'Existing ERP foundation enabling integration pathways',
        'Skilled change management team with prior transformation experience',
      ],
      weaknesses: [
        'Legacy monolithic systems with high technical debt',
        'Low digital literacy among frontline staff requiring upskilling',
        'Data silos across business units preventing analytics',
      ],
      opportunities: [
        'Cloud-native platforms reducing infrastructure cost by 35%',
        'AI-powered automation eliminating 30% of manual processes',
        'Open banking / open data ecosystems enabling new business models',
      ],
      threats: [
        'Cybersecurity risks increasing with expanded digital attack surface',
        'Vendor lock-in to legacy systems creating transition costs',
        'Regulatory data sovereignty requirements adding compliance complexity',
      ],
    },
    strategies: {
      so: ['Accelerate cloud migration using approved budget and leadership mandate'],
      st: ['Build zero-trust security architecture from day one of transformation'],
      wo: ['Launch digital upskilling academy before systems go live'],
      wt: ['Adopt open-standards architecture to avoid vendor lock-in'],
    },
    kpis: [
      { perspective: 'financial', kpi: 'IT Cost Reduction', target: '25%', unit: '%' },
      { perspective: 'customer', kpi: 'Digital Channel Adoption', target: '75%', unit: '%' },
      { perspective: 'internal', kpi: 'Process Automation Rate', target: '50%', unit: '%' },
      { perspective: 'learning', kpi: 'Digital Literacy Score', target: '80/100', unit: 'score' },
    ],
    initiatives: [
      { name: 'Cloud Migration Program', type: 'program' },
      { name: 'Data Platform Build', type: 'project' },
      { name: 'Digital Upskilling Academy', type: 'activity' },
    ],
  },
];

// ── Helper query functions ────────────────────────────────
const helpers = {
  async findUserByEmail(email) {
    return db.users.findOne({ email: email.toLowerCase().trim() });
  },

  async findPlanWithAccess(planId, userId) {
    const plan = await db.plans.findOne({ _id: planId });
    if (!plan) return null;
    if (plan.ownerId === userId) return { plan, role: 'admin' };
    const member = await db.planMembers.findOne({ planId, userId });
    if (!member) return null;
    return { plan, role: member.role };
  },

  async getUserPlans(userId) {
    // Plans owned by user
    const owned = await db.plans.find({ ownerId: userId, isDeleted: { $ne: true } });
    // Plans shared with user
    const memberships = await db.planMembers.find({ userId });
    const sharedIds = memberships.map(m => m.planId);
    const shared = sharedIds.length
      ? await db.plans.find({ _id: { $in: sharedIds }, isDeleted: { $ne: true } })
      : [];
    return { owned, shared };
  },

  async logActivity(data) {
    return db.activityLog.insert({
      userId:      data.userId,
      userEmail:   data.userEmail,
      userName:    data.userName,
      planId:      data.planId || null,
      action:      data.action,
      entityType:  data.entityType || null,
      entityId:    data.entityId || null,
      details:     data.details || null,
      ipAddress:   data.ipAddress || null,
    });
  },

  async createNotification(data) {
    return db.notifications.insert({
      userId:    data.userId,
      type:      data.type,        // 'invite' | 'comment' | 'share' | 'mention' | 'kpi_alert'
      title:     data.title,
      message:   data.message,
      planId:    data.planId || null,
      entityId:  data.entityId || null,
      actionUrl: data.actionUrl || null,
      read:      false,
    });
  },

  async getOrgRole(userId, orgId) {
    const member = await db.orgMembers.findOne({ userId, orgId });
    return member ? member.role : null;
  },

  async getPlanRole(userId, planId) {
    const plan = await db.plans.findOne({ _id: planId });
    if (plan && plan.ownerId === userId) return 'admin';
    const member = await db.planMembers.findOne({ userId, planId });
    return member ? member.role : null;
  },
};

module.exports = { db, ensureIndexes, seed, helpers };
