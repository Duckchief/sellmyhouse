# Phase 3 SP3: Admin — Team Management & System Settings — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin domain with team management (agent CRUD, seller reassignment), system settings panel (validated per-setting updates), and HDB data management, all protected by admin-only RBAC.

**Architecture:** Thin orchestration layer — `admin.service.ts` delegates to existing services (`hdb.sync.service`, `settings.repository`, `audit.service`, `notification.repository`) and admin-specific repository queries. Admin repository owns agent CRUD and cross-agent read queries. Credential emails sent via nodemailer using system env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). All routes under `/admin/*` with `requireRole('admin')`.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Tailwind, Jest, Supertest, bcrypt, nodemailer

**Spec:** `docs/superpowers/specs/2026-03-11-phase-3-sp3-admin-team-settings-design.md`

---

## File Map

**Create:**
- `src/domains/admin/admin.types.ts` — TeamMember, AgentCreateInput, HdbDataStatus, etc.
- `src/domains/admin/admin.repository.ts` — agent CRUD + cross-agent queries
- `src/domains/admin/admin.service.ts` — orchestration: team, settings, HDB
- `src/domains/admin/admin.router.ts` — routes under /admin/*
- `src/domains/admin/admin.validator.ts` — SETTING_VALIDATORS + form validators
- `src/domains/admin/__tests__/admin.service.test.ts` — unit tests
- `src/domains/admin/__tests__/admin.router.test.ts` — router unit tests
- `src/views/pages/admin/dashboard.njk`
- `src/views/pages/admin/team.njk`
- `src/views/pages/admin/team-pipeline.njk`
- `src/views/pages/admin/sellers.njk`
- `src/views/pages/admin/settings.njk`
- `src/views/pages/admin/hdb.njk`
- `src/views/partials/admin/team-list.njk`
- `src/views/partials/admin/team-action-result.njk`
- `src/views/partials/admin/seller-list.njk`
- `src/views/partials/admin/assign-modal.njk`
- `src/views/partials/admin/settings-form.njk`
- `src/views/partials/admin/settings-result.njk`
- `src/views/partials/admin/hdb-status.njk`
- `src/views/partials/admin/hdb-sync-history.njk`
- `src/views/partials/admin/anonymise-confirm.njk`
- `tests/integration/admin.test.ts`

**Modify:**
- `src/domains/shared/settings.types.ts` — add 4 new SETTING_KEYS
- `src/views/layouts/admin.njk` — expand sidebar nav
- `src/infra/http/app.ts` — mount adminRouter

---

## Chunk 1: Foundation — Types, Repository, Validator

### Task 1: Extend Settings Types

**Files:**
- Modify: `src/domains/shared/settings.types.ts`

- [ ] **Step 1: Add 4 new setting keys to SETTING_KEYS**

Open `src/domains/shared/settings.types.ts` and replace its contents entirely:

```typescript
export interface SettingRecord {
  id: string;
  key: string;
  value: string;
  description: string;
  updatedByAgentId: string | null;
  updatedAt: Date;
  createdAt: Date;
}

// Known setting keys for type safety
export const SETTING_KEYS = {
  COMMISSION_AMOUNT: 'commission_amount',
  GST_RATE: 'gst_rate',
  OTP_EXERCISE_DAYS: 'otp_exercise_days',
  LEAD_RETENTION_MONTHS: 'lead_retention_months',
  TRANSACTION_RETENTION_YEARS: 'transaction_retention_years',
  AI_PROVIDER: 'ai_provider',
  AI_MODEL: 'ai_model',
  AI_MAX_TOKENS: 'ai_max_tokens',
  AI_TEMPERATURE: 'ai_temperature',
  VIEWING_SLOT_DURATION: 'viewing_slot_duration',
  VIEWING_MAX_GROUP_SIZE: 'viewing_max_group_size',
  HDB_SYNC_SCHEDULE: 'hdb_sync_schedule',
  REMINDER_SCHEDULE: 'reminder_schedule',
  MARKET_CONTENT_SCHEDULE: 'market_content_schedule',
  WHATSAPP_ENABLED: 'whatsapp_enabled',
  EMAIL_ENABLED: 'email_enabled',
  MAINTENANCE_MODE: 'maintenance_mode',
  DISPLAY_PRICE: 'display_price',
  POST_COMPLETION_THANKYOU_DELAY_DAYS: 'post_completion_thankyou_delay_days',
  POST_COMPLETION_TESTIMONIAL_DELAY_DAYS: 'post_completion_testimonial_delay_days',
  POST_COMPLETION_BUYER_FOLLOWUP_DELAY_DAYS: 'post_completion_buyer_followup_delay_days',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/domains/shared/settings.types.ts
git commit -m "feat(admin): extend SETTING_KEYS with 4 new post-completion and display keys"
```

---

### Task 2: Create Admin Types

**Files:**
- Create: `src/domains/admin/admin.types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/domains/admin/admin.types.ts

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  ceaRegNo: string;
  role: 'agent' | 'admin';
  isActive: boolean;
  activeSellersCount: number;
  completedCount: number;
  createdAt: Date;
}

export interface AgentCreateInput {
  name: string;
  email: string;
  phone: string;
  ceaRegNo: string;
}

export interface HdbDataStatus {
  totalRecords: number;
  dateRange: { earliest: string; latest: string } | null;
  lastSync: HdbSyncRecord | null;
  recentSyncs: HdbSyncRecord[];
}

export interface HdbSyncRecord {
  id: string;
  syncedAt: Date;
  recordsAdded: number;
  recordsTotal: number;
  source: string;
  status: string;
  error: string | null;
  createdAt: Date;
}

export interface SettingGroup {
  label: string;
  settings: SettingWithMeta[];
}

export interface SettingWithMeta {
  key: string;
  value: string;
  description: string;
  updatedAt: Date;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/domains/admin/admin.types.ts
git commit -m "feat(admin): add admin domain types"
```

---

### Task 3: Create Admin Repository

**Files:**
- Create: `src/domains/admin/admin.repository.ts`

- [ ] **Step 1: Create admin.repository.ts**

```typescript
// src/domains/admin/admin.repository.ts
import { prisma, createId } from '@/infra/database/prisma';
import type { TeamMember, AgentCreateInput, HdbDataStatus, HdbSyncRecord } from './admin.types';

// ─── Agent Queries ───────────────────────────────────────────

export async function findAllAgents(): Promise<TeamMember[]> {
  const agents = await prisma.agent.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: {
          sellers: {
            where: { status: { notIn: ['completed', 'archived'] } },
          },
        },
      },
    },
  });

  const completedCounts = await prisma.seller.groupBy({
    by: ['agentId'],
    where: { status: 'completed' },
    _count: { id: true },
  });
  const completedMap = new Map(
    completedCounts
      .filter((r) => r.agentId !== null)
      .map((r) => [r.agentId as string, r._count.id]),
  );

  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    phone: a.phone,
    ceaRegNo: a.ceaRegNo,
    role: a.role as 'agent' | 'admin',
    isActive: a.isActive,
    activeSellersCount: a._count.sellers,
    completedCount: completedMap.get(a.id) ?? 0,
    createdAt: a.createdAt,
  }));
}

export async function findAgentById(
  id: string,
): Promise<{ id: string; name: string; email: string; isActive: boolean } | null> {
  return prisma.agent.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, isActive: true },
  });
}

export async function findAgentByEmail(email: string): Promise<{ id: string } | null> {
  return prisma.agent.findUnique({ where: { email }, select: { id: true } });
}

export async function createAgent(
  input: AgentCreateInput & { passwordHash: string },
): Promise<{ id: string; name: string; email: string }> {
  return prisma.agent.create({
    data: {
      id: createId(),
      name: input.name,
      email: input.email,
      phone: input.phone,
      ceaRegNo: input.ceaRegNo,
      passwordHash: input.passwordHash,
      role: 'agent',
      isActive: true,
    },
    select: { id: true, name: true, email: true },
  });
}

export async function updateAgentStatus(id: string, isActive: boolean): Promise<void> {
  await prisma.agent.update({ where: { id }, data: { isActive } });
}

export async function anonymiseAgent(id: string): Promise<void> {
  await prisma.agent.update({
    where: { id },
    data: {
      name: `Former Agent [${id}]`,
      email: `anonymised-${id}@deleted.local`,
      phone: null,
      isActive: false,
    },
  });
}

export async function countActiveSellers(agentId: string): Promise<number> {
  return prisma.seller.count({
    where: {
      agentId,
      status: { notIn: ['completed', 'archived'] },
    },
  });
}

// ─── Seller Queries ──────────────────────────────────────────

export async function findAllSellers(filter: {
  agentId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const limit = filter.limit ?? 25;
  const skip = ((filter.page ?? 1) - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filter.agentId) where.agentId = filter.agentId;
  if (filter.status) where.status = filter.status;
  if (filter.search) {
    where.OR = [
      { name: { contains: filter.search, mode: 'insensitive' } },
      { email: { contains: filter.search, mode: 'insensitive' } },
      { phone: { contains: filter.search } },
    ];
  }

  const [sellers, total] = await Promise.all([
    prisma.seller.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        agent: { select: { id: true, name: true } },
      },
    }),
    prisma.seller.count({ where }),
  ]);

  return { sellers, total, page: filter.page ?? 1, limit };
}

export async function findSellerById(
  id: string,
): Promise<{ id: string; agentId: string | null; name: string } | null> {
  return prisma.seller.findUnique({
    where: { id },
    select: { id: true, agentId: true, name: true },
  });
}

export async function assignSeller(sellerId: string, agentId: string): Promise<void> {
  await prisma.seller.update({ where: { id: sellerId }, data: { agentId } });
}

// ─── HDB Queries ─────────────────────────────────────────────

export async function getHdbStatus(): Promise<HdbDataStatus> {
  const [totalRecords, aggregate, recentSyncs] = await Promise.all([
    prisma.hdbTransaction.count(),
    prisma.hdbTransaction.aggregate({
      _min: { month: true },
      _max: { month: true },
    }),
    prisma.hdbDataSync.findMany({
      orderBy: { syncedAt: 'desc' },
      take: 20,
    }),
  ]);

  const earliest = aggregate._min.month;
  const latest = aggregate._max.month;

  const syncs: HdbSyncRecord[] = recentSyncs.map((s) => ({
    id: s.id,
    syncedAt: s.syncedAt,
    recordsAdded: s.recordsAdded,
    recordsTotal: s.recordsTotal,
    source: s.source,
    status: s.status,
    error: s.error,
    createdAt: s.createdAt,
  }));

  return {
    totalRecords,
    dateRange: earliest && latest ? { earliest, latest } : null,
    lastSync: syncs[0] ?? null,
    recentSyncs: syncs,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/domains/admin/admin.repository.ts
git commit -m "feat(admin): add admin repository with agent CRUD and cross-domain queries"
```

---

### Task 4: Create Admin Validator + Initial Test File

**Files:**
- Create: `src/domains/admin/admin.validator.ts`
- Create: `src/domains/admin/__tests__/admin.service.test.ts`

- [ ] **Step 1: Write the failing tests for SETTING_VALIDATORS**

Create `src/domains/admin/__tests__/admin.service.test.ts` with this exact content
(note: service mock imports are included at the top now so the file is ready to grow in Tasks 5 and 6):

```typescript
// src/domains/admin/__tests__/admin.service.test.ts
import { SETTING_VALIDATORS } from '../admin.validator';
import { SETTING_KEYS } from '@/domains/shared/settings.types';

// ─── Pre-load mocks before importing service ──────────────────
jest.mock('../admin.repository');
jest.mock('@/domains/shared/audit.service');
jest.mock('@/domains/shared/settings.repository');
jest.mock('@/domains/notification/notification.repository');
jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
  }),
}));

import * as adminRepo from '../admin.repository';
import * as auditService from '@/domains/shared/audit.service';
import * as settingsRepo from '@/domains/shared/settings.repository';
import * as adminService from '../admin.service';

const mockAdminRepo = adminRepo as jest.Mocked<typeof adminRepo>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;
const mockSettingsRepo = settingsRepo as jest.Mocked<typeof settingsRepo>;

beforeEach(() => {
  jest.clearAllMocks();
  mockAudit.log.mockResolvedValue(undefined);
});

// ─── SETTING_VALIDATORS ───────────────────────────────────────

describe('SETTING_VALIDATORS', () => {
  it('has a validator for every key in SETTING_KEYS', () => {
    const keys = Object.values(SETTING_KEYS);
    for (const key of keys) {
      expect(SETTING_VALIDATORS).toHaveProperty(key);
    }
  });

  it('accepts valid commission_amount', () => {
    expect(SETTING_VALIDATORS['commission_amount']('1499')).toBe(true);
  });

  it('rejects negative commission_amount', () => {
    expect(SETTING_VALIDATORS['commission_amount']('-500')).toBe(false);
  });

  it('rejects non-numeric commission_amount', () => {
    expect(SETTING_VALIDATORS['commission_amount']('abc')).toBe(false);
  });

  it('accepts gst_rate of 0.09', () => {
    expect(SETTING_VALIDATORS['gst_rate']('0.09')).toBe(true);
  });

  it('rejects gst_rate >= 1', () => {
    expect(SETTING_VALIDATORS['gst_rate']('1')).toBe(false);
  });

  it('rejects transaction_retention_years < 5 (AML/CFT minimum)', () => {
    expect(SETTING_VALIDATORS['transaction_retention_years']('3')).toBe(false);
  });

  it('accepts transaction_retention_years of 5', () => {
    expect(SETTING_VALIDATORS['transaction_retention_years']('5')).toBe(true);
  });

  it('accepts valid reminder_schedule JSON array', () => {
    expect(SETTING_VALIDATORS['reminder_schedule']('[14, 7, 3, 1]')).toBe(true);
  });

  it('rejects invalid reminder_schedule (not JSON)', () => {
    expect(SETTING_VALIDATORS['reminder_schedule']('14,7,3,1')).toBe(false);
  });

  it('rejects reminder_schedule with non-numbers', () => {
    expect(SETTING_VALIDATORS['reminder_schedule']('["14", "7"]')).toBe(false);
  });

  it('accepts valid ai_provider', () => {
    expect(SETTING_VALIDATORS['ai_provider']('anthropic')).toBe(true);
    expect(SETTING_VALIDATORS['ai_provider']('openai')).toBe(true);
    expect(SETTING_VALIDATORS['ai_provider']('google')).toBe(true);
  });

  it('rejects unknown ai_provider', () => {
    expect(SETTING_VALIDATORS['ai_provider']('mistral')).toBe(false);
  });

  it('accepts boolean string for whatsapp_enabled', () => {
    expect(SETTING_VALIDATORS['whatsapp_enabled']('true')).toBe(true);
    expect(SETTING_VALIDATORS['whatsapp_enabled']('false')).toBe(true);
  });

  it('rejects non-boolean string for whatsapp_enabled', () => {
    expect(SETTING_VALIDATORS['whatsapp_enabled']('yes')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="admin.service" --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `SETTING_VALIDATORS` not found.

- [ ] **Step 3: Create admin.validator.ts**

```typescript
// src/domains/admin/admin.validator.ts
import { body, param } from 'express-validator';
import type { SettingKey } from '@/domains/shared/settings.types';

// Exhaustive validator map — TypeScript enforces every SettingKey has an entry.
// Adding a new SettingKey without adding a validator here is a compile error.
export const SETTING_VALIDATORS: Record<SettingKey, (v: string) => boolean> = {
  commission_amount: (v) => !isNaN(Number(v)) && Number(v) > 0,
  gst_rate: (v) => !isNaN(Number(v)) && Number(v) >= 0 && Number(v) < 1,
  display_price: (v) => !isNaN(Number(v)) && Number(v) > 0,
  otp_exercise_days: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  reminder_schedule: (v) => {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) && a.every((n: unknown) => typeof n === 'number');
    } catch {
      return false;
    }
  },
  post_completion_thankyou_delay_days: (v) => Number.isInteger(Number(v)) && Number(v) >= 0,
  post_completion_testimonial_delay_days: (v) => Number.isInteger(Number(v)) && Number(v) >= 0,
  post_completion_buyer_followup_delay_days: (v) =>
    Number.isInteger(Number(v)) && Number(v) >= 0,
  whatsapp_enabled: (v) => v === 'true' || v === 'false',
  email_enabled: (v) => v === 'true' || v === 'false',
  maintenance_mode: (v) => v === 'true' || v === 'false',
  hdb_sync_schedule: (v) => /^[\d*,\-/\s]+$/.test(v),
  lead_retention_months: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  transaction_retention_years: (v) => Number.isInteger(Number(v)) && Number(v) >= 5,
  ai_provider: (v) => ['anthropic', 'openai', 'google'].includes(v),
  ai_model: (v) => v.length > 0,
  ai_max_tokens: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  ai_temperature: (v) => !isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 2,
  viewing_slot_duration: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  viewing_max_group_size: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  market_content_schedule: (v) => /^[\d*,\-/\s]+$/.test(v),
};

export const validateAgentCreate = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').trim().isEmail().normalizeEmail().withMessage('Valid email required'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('ceaRegNo').trim().notEmpty().withMessage('CEA registration number is required'),
];

export const validateSettingUpdate = [
  param('key').trim().notEmpty().withMessage('Setting key is required'),
  body('value').exists().withMessage('Value is required'),
];

export const validateAssign = [
  body('agentId').trim().notEmpty().withMessage('Agent ID is required'),
];
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npm test -- --testPathPattern="admin.service" --no-coverage 2>&1 | tail -15
```

Expected: all validator tests PASS (service describe blocks are not yet populated so they don't run).

- [ ] **Step 5: Commit**

```bash
git add src/domains/admin/admin.validator.ts src/domains/admin/__tests__/admin.service.test.ts
git commit -m "feat(admin): add settings validator map and form validators"
```

---

## Chunk 2: Service — Team Management

### Task 5: Create Admin Service

**Files:**
- Create: `src/domains/admin/admin.service.ts`

- [ ] **Step 1: Add failing tests for createAgent to the test file**

Append the following to the end of `src/domains/admin/__tests__/admin.service.test.ts`
(all imports are already at the top of the file from Task 4):

```typescript
// ─── createAgent ─────────────────────────────────────────────

describe('createAgent', () => {
  it('creates agent with hashed password and audits', async () => {
    mockAdminRepo.findAgentByEmail.mockResolvedValue(null);
    mockAdminRepo.createAgent.mockResolvedValue({
      id: 'agent-1',
      name: 'Jane Doe',
      email: 'jane@test.local',
    });

    const result = await adminService.createAgent(
      { name: 'Jane Doe', email: 'jane@test.local', phone: '91234567', ceaRegNo: 'R012345A' },
      'admin-1',
    );

    expect(result.id).toBe('agent-1');
    expect(mockAdminRepo.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Jane Doe',
        email: 'jane@test.local',
        passwordHash: expect.stringMatching(/^\$2[aby]\$/),
      }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.created', agentId: 'admin-1' }),
    );
  });

  it('throws ConflictError when email already taken', async () => {
    mockAdminRepo.findAgentByEmail.mockResolvedValue({ id: 'existing' });

    const { ConflictError } = await import('@/domains/shared/errors');
    await expect(
      adminService.createAgent(
        { name: 'Jane', email: 'jane@test.local', phone: '91234567', ceaRegNo: 'R012345A' },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="admin.service" --no-coverage 2>&1 | tail -15
```

Expected: FAIL — `adminService.createAgent` not found.

- [ ] **Step 3: Create admin.service.ts**

```typescript
// src/domains/admin/admin.service.ts
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import * as adminRepo from './admin.repository';
import * as auditService from '@/domains/shared/audit.service';
import * as settingsRepo from '@/domains/shared/settings.repository';
import * as notificationRepo from '@/domains/notification/notification.repository';
import { HdbSyncService } from '@/domains/hdb/sync.service';
import { ConflictError, NotFoundError, ValidationError } from '@/domains/shared/errors';
import { SETTING_VALIDATORS } from './admin.validator';
import type { AgentCreateInput, HdbDataStatus, SettingGroup, SettingWithMeta } from './admin.types';
import type { SettingKey } from '@/domains/shared/settings.types';

// ─── Team Management ─────────────────────────────────────────

export async function getTeam() {
  return adminRepo.findAllAgents();
}

export async function createAgent(
  input: AgentCreateInput,
  adminId: string,
): Promise<{ id: string; name: string; email: string }> {
  const existing = await adminRepo.findAgentByEmail(input.email);
  if (existing) {
    throw new ConflictError(`Email already in use: ${input.email}`);
  }

  const tempPassword = crypto.randomBytes(8).toString('hex'); // 16-char hex
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const agent = await adminRepo.createAgent({ ...input, passwordHash });

  await sendCredentialEmail(agent.email, agent.name, tempPassword);

  await auditService.log({
    agentId: adminId,
    action: 'agent.created',
    entityType: 'agent',
    entityId: agent.id,
    details: {
      name: agent.name,
      email: agent.email,
      ceaRegNo: input.ceaRegNo,
      createdBy: adminId,
    },
  });

  return agent;
}

async function sendCredentialEmail(
  email: string,
  name: string,
  tempPassword: string,
): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? 'noreply@sellmyhouse.sg';

  if (!host || !user || !pass) {
    // SMTP not configured (dev/test) — skip silently
    return;
  }

  const transporter = nodemailer.createTransport({ host, port, auth: { user, pass } });

  await transporter.sendMail({
    from,
    to: email,
    subject: 'Your SellMyHouse Agent Account',
    text: [
      `Hi ${name},`,
      '',
      'Your agent account has been created on SellMyHouse.',
      '',
      `Email: ${email}`,
      `Temporary password: ${tempPassword}`,
      '',
      'Please log in and change your password immediately.',
      '',
      'SellMyHouse Team',
    ].join('\n'),
  });
}

export async function deactivateAgent(agentId: string, adminId: string): Promise<void> {
  const agent = await adminRepo.findAgentById(agentId);
  if (!agent) throw new NotFoundError('Agent', agentId);

  const activeSellers = await adminRepo.countActiveSellers(agentId);
  if (activeSellers > 0) {
    throw new ValidationError(
      `Cannot deactivate agent with ${activeSellers} active seller(s). Reassign them first.`,
      { activeSellersCount: String(activeSellers) },
    );
  }

  await adminRepo.updateAgentStatus(agentId, false);

  await auditService.log({
    agentId: adminId,
    action: 'agent.deactivated',
    entityType: 'agent',
    entityId: agentId,
    details: { agentId, deactivatedBy: adminId, activeSellersCount: 0 },
  });
}

export async function reactivateAgent(agentId: string, adminId: string): Promise<void> {
  const agent = await adminRepo.findAgentById(agentId);
  if (!agent) throw new NotFoundError('Agent', agentId);

  await adminRepo.updateAgentStatus(agentId, true);

  await auditService.log({
    agentId: adminId,
    action: 'agent.reactivated',
    entityType: 'agent',
    entityId: agentId,
    details: { agentId, reactivatedBy: adminId },
  });
}

export async function anonymiseAgent(agentId: string, adminId: string): Promise<void> {
  const agent = await adminRepo.findAgentById(agentId);
  if (!agent) throw new NotFoundError('Agent', agentId);

  const activeSellers = await adminRepo.countActiveSellers(agentId);
  if (activeSellers > 0) {
    throw new ValidationError(
      `Cannot anonymise agent with ${activeSellers} active seller(s). Reassign them first.`,
      { activeSellersCount: String(activeSellers) },
    );
  }

  await adminRepo.anonymiseAgent(agentId);

  await auditService.log({
    agentId: adminId,
    action: 'agent.anonymised',
    entityType: 'agent',
    entityId: agentId,
    details: { agentId, anonymisedBy: adminId },
  });
}

export async function getAllSellers(filter: {
  agentId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  return adminRepo.findAllSellers(filter);
}

export async function assignSeller(
  sellerId: string,
  newAgentId: string,
  adminId: string,
): Promise<void> {
  const seller = await adminRepo.findSellerById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const agent = await adminRepo.findAgentById(newAgentId);
  if (!agent || !agent.isActive) {
    throw new ValidationError('Target agent not found or inactive');
  }

  await adminRepo.assignSeller(sellerId, newAgentId);

  // Notify the new agent (in-app — fire and forget)
  void notificationRepo.create({
    recipientType: 'agent',
    recipientId: newAgentId,
    channel: 'in_app',
    templateName: 'seller_assigned',
    content: `Seller ${seller.name} has been assigned to you.`,
  });

  await auditService.log({
    agentId: adminId,
    action: 'lead.assigned',
    entityType: 'seller',
    entityId: sellerId,
    details: { agentId: newAgentId, assignmentMethod: 'manual' },
  });
}

export async function reassignSeller(
  sellerId: string,
  newAgentId: string,
  adminId: string,
): Promise<void> {
  const seller = await adminRepo.findSellerById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const agent = await adminRepo.findAgentById(newAgentId);
  if (!agent || !agent.isActive) {
    throw new ValidationError('Target agent not found or inactive');
  }

  const fromAgentId = seller.agentId;
  await adminRepo.assignSeller(sellerId, newAgentId);

  // Notify both agents (in-app — fire and forget)
  void notificationRepo.create({
    recipientType: 'agent',
    recipientId: newAgentId,
    channel: 'in_app',
    templateName: 'seller_reassigned',
    content: `Seller ${seller.name} has been reassigned to you.`,
  });
  if (fromAgentId) {
    void notificationRepo.create({
      recipientType: 'agent',
      recipientId: fromAgentId,
      channel: 'in_app',
      templateName: 'seller_reassigned',
      content: `Seller ${seller.name} has been reassigned to another agent.`,
    });
  }

  await auditService.log({
    agentId: adminId,
    action: 'lead.reassigned',
    entityType: 'seller',
    entityId: sellerId,
    details: { fromAgentId, toAgentId: newAgentId, reason: 'admin_reassignment' },
  });
}

// ─── Settings ────────────────────────────────────────────────

export async function updateSetting(
  key: string,
  value: string,
  adminId: string,
): Promise<void> {
  const validator = SETTING_VALIDATORS[key as SettingKey];
  if (!validator) {
    throw new ValidationError(`Unknown setting key: ${key}`);
  }
  if (!validator(value)) {
    throw new ValidationError(`Invalid value for setting: ${key}`);
  }

  const existing = await settingsRepo.findByKey(key);
  const oldValue = existing?.value ?? null;

  await settingsRepo.upsert(key, value, `Setting: ${key}`, adminId);

  await auditService.log({
    agentId: adminId,
    action: 'setting.changed',
    entityType: 'setting',
    entityId: key,
    details: { key, oldValue, newValue: value, changedBy: adminId },
  });
}

export async function getSettingsGrouped(): Promise<SettingGroup[]> {
  const all = await settingsRepo.findAll();
  const map = new Map(all.map((s) => [s.key, s]));

  const group = (label: string, keys: string[]): SettingGroup => ({
    label,
    settings: keys
      .map((k) => {
        const s = map.get(k);
        return s
          ? ({ key: k, value: s.value, description: s.description, updatedAt: s.updatedAt } satisfies SettingWithMeta)
          : null;
      })
      .filter((s): s is SettingWithMeta => s !== null),
  });

  return [
    group('Pricing', ['commission_amount', 'gst_rate', 'display_price']),
    group('OTP & Transaction', ['otp_exercise_days', 'reminder_schedule']),
    group('Notifications', [
      'whatsapp_enabled',
      'email_enabled',
      'post_completion_thankyou_delay_days',
      'post_completion_testimonial_delay_days',
      'post_completion_buyer_followup_delay_days',
    ]),
    group('Data & Sync', ['hdb_sync_schedule', 'lead_retention_months', 'transaction_retention_years']),
    group('AI', ['ai_provider', 'ai_model', 'ai_max_tokens', 'ai_temperature']),
    group('Platform', [
      'viewing_slot_duration',
      'viewing_max_group_size',
      'maintenance_mode',
      'market_content_schedule',
    ]),
  ];
}

// ─── HDB Management ──────────────────────────────────────────

export async function getHdbStatus(): Promise<HdbDataStatus> {
  return adminRepo.getHdbStatus();
}

export async function triggerHdbSync(adminId: string): Promise<void> {
  await auditService.log({
    agentId: adminId,
    action: 'hdb_sync.triggered_manually',
    entityType: 'hdbSync',
    entityId: 'manual',
    details: { triggeredBy: adminId },
  });

  // Fire-and-forget: sync runs async, HdbSyncService logs its own result
  const syncService = new HdbSyncService();
  syncService.sync().catch(() => {
    // HdbSyncService logs its own errors — nothing to do here
  });
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npm test -- --testPathPattern="admin.service" --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/admin/admin.service.ts src/domains/admin/__tests__/admin.service.test.ts
git commit -m "feat(admin): add admin service with team management, settings, and HDB orchestration"
```

---

### Task 6: Remaining Service Unit Tests

**Files:**
- Modify: `src/domains/admin/__tests__/admin.service.test.ts`

- [ ] **Step 1: Append remaining describe blocks**

Append the following to the end of `src/domains/admin/__tests__/admin.service.test.ts`:

```typescript
// ─── deactivateAgent ─────────────────────────────────────────

describe('deactivateAgent', () => {
  it('throws ValidationError when agent has active sellers', async () => {
    mockAdminRepo.findAgentById.mockResolvedValue({ id: 'a1', name: 'A', email: 'a@t.com', isActive: true });
    mockAdminRepo.countActiveSellers.mockResolvedValue(3);

    const { ValidationError } = await import('@/domains/shared/errors');
    await expect(adminService.deactivateAgent('a1', 'admin-1')).rejects.toBeInstanceOf(ValidationError);
    expect(mockAdminRepo.updateAgentStatus).not.toHaveBeenCalled();
  });

  it('deactivates and audits when no active sellers', async () => {
    mockAdminRepo.findAgentById.mockResolvedValue({ id: 'a1', name: 'A', email: 'a@t.com', isActive: true });
    mockAdminRepo.countActiveSellers.mockResolvedValue(0);
    mockAdminRepo.updateAgentStatus.mockResolvedValue(undefined);

    await adminService.deactivateAgent('a1', 'admin-1');

    expect(mockAdminRepo.updateAgentStatus).toHaveBeenCalledWith('a1', false);
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.deactivated' }),
    );
  });
});

// ─── reactivateAgent ─────────────────────────────────────────

describe('reactivateAgent', () => {
  it('reactivates and audits', async () => {
    mockAdminRepo.findAgentById.mockResolvedValue({ id: 'a1', name: 'A', email: 'a@t.com', isActive: false });
    mockAdminRepo.updateAgentStatus.mockResolvedValue(undefined);

    await adminService.reactivateAgent('a1', 'admin-1');

    expect(mockAdminRepo.updateAgentStatus).toHaveBeenCalledWith('a1', true);
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.reactivated' }),
    );
  });
});

// ─── anonymiseAgent ──────────────────────────────────────────

describe('anonymiseAgent', () => {
  it('throws ValidationError when agent has active sellers', async () => {
    mockAdminRepo.findAgentById.mockResolvedValue({ id: 'a1', name: 'A', email: 'a@t.com', isActive: true });
    mockAdminRepo.countActiveSellers.mockResolvedValue(1);

    const { ValidationError } = await import('@/domains/shared/errors');
    await expect(adminService.anonymiseAgent('a1', 'admin-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('anonymises fields and audits', async () => {
    mockAdminRepo.findAgentById.mockResolvedValue({ id: 'a1', name: 'Agent A', email: 'a@t.com', isActive: true });
    mockAdminRepo.countActiveSellers.mockResolvedValue(0);
    mockAdminRepo.anonymiseAgent.mockResolvedValue(undefined);

    await adminService.anonymiseAgent('a1', 'admin-1');

    expect(mockAdminRepo.anonymiseAgent).toHaveBeenCalledWith('a1');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.anonymised' }),
    );
  });
});

// ─── reassignSeller ──────────────────────────────────────────

describe('reassignSeller', () => {
  it('validates new agent is active before reassigning', async () => {
    mockAdminRepo.findSellerById.mockResolvedValue({ id: 's1', agentId: 'a1', name: 'Seller' });
    mockAdminRepo.findAgentById.mockResolvedValue({ id: 'a2', name: 'B', email: 'b@t.com', isActive: false });

    const { ValidationError } = await import('@/domains/shared/errors');
    await expect(adminService.reassignSeller('s1', 'a2', 'admin-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('reassigns and audits with fromAgentId and toAgentId', async () => {
    mockAdminRepo.findSellerById.mockResolvedValue({ id: 's1', agentId: 'a1', name: 'Seller' });
    mockAdminRepo.findAgentById.mockResolvedValue({ id: 'a2', name: 'B', email: 'b@t.com', isActive: true });
    mockAdminRepo.assignSeller.mockResolvedValue(undefined);

    await adminService.reassignSeller('s1', 'a2', 'admin-1');

    expect(mockAdminRepo.assignSeller).toHaveBeenCalledWith('s1', 'a2');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead.reassigned',
        details: expect.objectContaining({ fromAgentId: 'a1', toAgentId: 'a2' }),
      }),
    );
  });
});

// ─── updateSetting ───────────────────────────────────────────

describe('updateSetting', () => {
  it('rejects negative commission_amount', async () => {
    const { ValidationError } = await import('@/domains/shared/errors');
    await expect(adminService.updateSetting('commission_amount', '-500', 'admin-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects transaction_retention_years < 5 (AML/CFT minimum)', async () => {
    const { ValidationError } = await import('@/domains/shared/errors');
    await expect(adminService.updateSetting('transaction_retention_years', '3', 'admin-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects unknown setting key', async () => {
    const { ValidationError } = await import('@/domains/shared/errors');
    await expect(adminService.updateSetting('unknown_key', 'value', 'admin-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('saves valid value and audits with old and new values', async () => {
    mockSettingsRepo.findByKey.mockResolvedValue({
      id: 'id-1',
      key: 'commission_amount',
      value: '1499',
      description: 'Commission amount',
      updatedByAgentId: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    mockSettingsRepo.upsert.mockResolvedValue({
      id: 'id-1',
      key: 'commission_amount',
      value: '1600',
      description: 'Commission amount',
      updatedByAgentId: 'admin-1',
      updatedAt: new Date(),
      createdAt: new Date(),
    });

    await adminService.updateSetting('commission_amount', '1600', 'admin-1');

    expect(mockSettingsRepo.upsert).toHaveBeenCalledWith('commission_amount', '1600', expect.any(String), 'admin-1');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'setting.changed',
        details: expect.objectContaining({ key: 'commission_amount', oldValue: '1499', newValue: '1600' }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- --testPathPattern="admin.service" --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/domains/admin/__tests__/admin.service.test.ts
git commit -m "test(admin): add unit tests for deactivate, reactivate, anonymise, reassign, settings"
```

---

## Chunk 3: Router, App Wiring

### Task 7: Create Admin Router

**Files:**
- Create: `src/domains/admin/admin.router.ts`
- Create: `src/domains/admin/__tests__/admin.router.test.ts`

- [ ] **Step 1: Write failing router test**

```typescript
// src/domains/admin/__tests__/admin.router.test.ts
describe('Admin router (unit)', () => {
  it('module exports adminRouter', () => {
    const { adminRouter } = require('../admin.router');
    expect(adminRouter).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="admin.router" --no-coverage 2>&1 | tail -10
```

Expected: FAIL — adminRouter not found.

- [ ] **Step 3: Create admin.router.ts**

```typescript
// src/domains/admin/admin.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as adminService from './admin.service';
import {
  validateAgentCreate,
  validateSettingUpdate,
  validateAssign,
} from './admin.validator';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { NotFoundError } from '@/domains/shared/errors';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

export const adminRouter = Router();

const adminAuth = [requireAuth(), requireRole('admin'), requireTwoFactor()];

// ─── Dashboard ───────────────────────────────────────────────

adminRouter.get(
  '/admin/dashboard',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const team = await adminService.getTeam();
      res.render('pages/admin/dashboard', { team });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Team Management ─────────────────────────────────────────

adminRouter.get(
  '/admin/team',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const team = await adminService.getTeam();
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-list', { team });
      }
      res.render('pages/admin/team', { team });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/team',
  ...adminAuth,
  ...validateAgentCreate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const user = req.user as AuthenticatedUser;
      const agent = await adminService.createAgent(
        {
          name: req.body.name as string,
          email: req.body.email as string,
          phone: req.body.phone as string,
          ceaRegNo: req.body.ceaRegNo as string,
        },
        user.id,
      );
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: `Agent ${agent.name} created. Credentials sent to ${agent.email}.`,
          type: 'success',
        });
      }
      res.redirect('/admin/team');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/team/:id/deactivate',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await adminService.deactivateAgent(req.params['id'] as string, user.id);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: 'Agent deactivated.',
          type: 'success',
        });
      }
      res.redirect('/admin/team');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/team/:id/reactivate',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await adminService.reactivateAgent(req.params['id'] as string, user.id);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: 'Agent reactivated.',
          type: 'success',
        });
      }
      res.redirect('/admin/team');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/team/:id/anonymise',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await adminService.anonymiseAgent(req.params['id'] as string, user.id);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: 'Agent anonymised. This action is irreversible.',
          type: 'success',
        });
      }
      res.redirect('/admin/team');
    } catch (err) {
      next(err);
    }
  },
);

// GET route for loading the anonymise confirmation modal
adminRouter.get(
  '/admin/team/:id/anonymise-confirm',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.render('partials/admin/anonymise-confirm', { agentId: req.params['id'] });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get(
  '/admin/team/:id/pipeline',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const team = await adminService.getTeam();
      const agent = team.find((a) => a.id === req.params['id']);
      if (!agent) throw new NotFoundError('Agent', req.params['id']);
      res.render('pages/admin/team-pipeline', { agent });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Sellers ─────────────────────────────────────────────────

adminRouter.get(
  '/admin/sellers',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter = {
        agentId: req.query['agentId'] as string | undefined,
        status: req.query['status'] as string | undefined,
        search: req.query['search'] as string | undefined,
        page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
        limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
      };
      const [result, team] = await Promise.all([
        adminService.getAllSellers(filter),
        adminService.getTeam(),
      ]);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/seller-list', { result, team });
      }
      res.render('pages/admin/sellers', { result, team });
    } catch (err) {
      next(err);
    }
  },
);

// GET route for loading the assign/reassign modal
adminRouter.get(
  '/admin/sellers/:id/assign-modal',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const team = await adminService.getTeam();
      // Determine if this is a reassign or assign based on whether seller has an agent
      const sellers = await adminService.getAllSellers({});
      const seller = sellers.sellers.find((s) => s.id === req.params['id']);
      const isReassign = seller?.agent != null;
      res.render('partials/admin/assign-modal', {
        sellerId: req.params['id'],
        team,
        isReassign,
      });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/sellers/:id/assign',
  ...adminAuth,
  ...validateAssign,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const user = req.user as AuthenticatedUser;
      await adminService.assignSeller(
        req.params['id'] as string,
        req.body.agentId as string,
        user.id,
      );
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: 'Lead assigned.',
          type: 'success',
        });
      }
      res.redirect('/admin/sellers');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/sellers/:id/reassign',
  ...adminAuth,
  ...validateAssign,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const user = req.user as AuthenticatedUser;
      await adminService.reassignSeller(
        req.params['id'] as string,
        req.body.agentId as string,
        user.id,
      );
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: 'Seller reassigned.',
          type: 'success',
        });
      }
      res.redirect('/admin/sellers');
    } catch (err) {
      next(err);
    }
  },
);

// ─── Settings ────────────────────────────────────────────────

adminRouter.get(
  '/admin/settings',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const groups = await adminService.getSettingsGrouped();
      if (req.headers['hx-request']) {
        return res.render('partials/admin/settings-form', { groups });
      }
      res.render('pages/admin/settings', { groups });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/settings/:key',
  ...adminAuth,
  ...validateSettingUpdate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.headers['hx-request']) {
          return res.render('partials/admin/settings-result', {
            message: errors.array()[0]?.msg,
            type: 'error',
          });
        }
        return res.status(400).json({ errors: errors.array() });
      }
      const user = req.user as AuthenticatedUser;
      await adminService.updateSetting(
        req.params['key'] as string,
        req.body.value as string,
        user.id,
      );
      if (req.headers['hx-request']) {
        return res.render('partials/admin/settings-result', {
          message: 'Setting saved.',
          type: 'success',
        });
      }
      res.redirect('/admin/settings');
    } catch (err) {
      next(err);
    }
  },
);

// ─── HDB Management ──────────────────────────────────────────

adminRouter.get(
  '/admin/hdb',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await adminService.getHdbStatus();
      if (req.headers['hx-request']) {
        return res.render('partials/admin/hdb-status', { status });
      }
      res.render('pages/admin/hdb', { status });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/hdb/sync',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await adminService.triggerHdbSync(user.id);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: 'HDB sync triggered. Data will update shortly.',
          type: 'success',
        });
      }
      res.redirect('/admin/hdb');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/hdb/upload',
  ...adminAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      // CSV upload stubbed for SP3 — full implementation in a future sprint
      res.redirect('/admin/hdb');
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 4: Run router tests**

```bash
npm test -- --testPathPattern="admin.router" --no-coverage 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts
git commit -m "feat(admin): add admin router with all team, seller, settings, and HDB routes"
```

---

### Task 8: Mount Admin Router in App

**Files:**
- Modify: `src/infra/http/app.ts`

- [ ] **Step 1: Add adminRouter import and mount**

In `src/infra/http/app.ts`, add after the `reviewRouter` import line:

```typescript
import { adminRouter } from '../../domains/admin/admin.router';
```

In the Routes section, add after `app.use(reviewRouter);`:

```typescript
app.use(adminRouter);
```

- [ ] **Step 2: Verify compile and existing tests still pass**

```bash
npm run build 2>&1 | head -20
npm test -- --no-coverage 2>&1 | tail -10
```

Expected: build clean, all existing tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/infra/http/app.ts
git commit -m "feat(admin): mount admin router in Express app"
```

---

## Chunk 4: Views

### Task 9: Expand Admin Layout

**Files:**
- Modify: `src/views/layouts/admin.njk`

- [ ] **Step 1: Replace the contents of admin.njk**

```nunjucks
{% extends "layouts/base.njk" %}

{% block body %}
<div class="flex min-h-screen">
  <aside class="w-64 bg-indigo-900 text-white p-4 flex-shrink-0">
    <div class="text-lg font-bold mb-6">{{ "Admin Portal" | t }}</div>
    <nav class="space-y-1">
      <a href="/admin/dashboard" class="block px-3 py-2 rounded hover:bg-indigo-800 text-sm">{{ "Dashboard" | t }}</a>
      <a href="/admin/team" class="block px-3 py-2 rounded hover:bg-indigo-800 text-sm">{{ "Team" | t }}</a>
      <a href="/admin/sellers" class="block px-3 py-2 rounded hover:bg-indigo-800 text-sm">{{ "Sellers" | t }}</a>
      <a href="/admin/settings" class="block px-3 py-2 rounded hover:bg-indigo-800 text-sm">{{ "Settings" | t }}</a>
      <a href="/admin/hdb" class="block px-3 py-2 rounded hover:bg-indigo-800 text-sm">{{ "HDB Data" | t }}</a>
    </nav>
  </aside>
  <main class="flex-1 p-8 overflow-auto">
    {% block content %}{% endblock %}
  </main>
</div>
{% endblock %}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/layouts/admin.njk
git commit -m "feat(admin): expand admin layout sidebar with Team, Sellers, Settings, HDB Data nav"
```

---

### Task 10: Admin Pages

**Files:**
- Create: `src/views/pages/admin/dashboard.njk`
- Create: `src/views/pages/admin/team.njk`
- Create: `src/views/pages/admin/team-pipeline.njk`
- Create: `src/views/pages/admin/sellers.njk`
- Create: `src/views/pages/admin/settings.njk`
- Create: `src/views/pages/admin/hdb.njk`

- [ ] **Step 1: Create dashboard.njk**

```nunjucks
{% extends "layouts/admin.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Admin Dashboard" | t }}</h1>
<p class="text-gray-500 mb-6">{{ "Showing all agents and pipeline." | t }}</p>
{% include "partials/admin/team-list.njk" %}
{% endblock %}
```

- [ ] **Step 2: Create team.njk**

```nunjucks
{% extends "layouts/admin.njk" %}

{% block content %}
<div class="flex items-center justify-between mb-6">
  <h1 class="text-2xl font-bold">{{ "Team Management" | t }}</h1>
  <form hx-post="/admin/team" hx-target="#action-result" class="inline">
    <input type="text" name="name" placeholder="{{ 'Name' | t }}" required class="border rounded px-2 py-1 text-sm" />
    <input type="email" name="email" placeholder="{{ 'Email' | t }}" required class="border rounded px-2 py-1 text-sm" />
    <input type="text" name="phone" placeholder="{{ 'Phone' | t }}" required class="border rounded px-2 py-1 text-sm" />
    <input type="text" name="ceaRegNo" placeholder="{{ 'CEA Reg No' | t }}" required class="border rounded px-2 py-1 text-sm" />
    <button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded text-sm">{{ "Add Agent" | t }}</button>
  </form>
</div>
<div id="action-result" class="mb-4"></div>
<div id="modal-container"></div>
{% include "partials/admin/team-list.njk" %}
{% endblock %}
```

- [ ] **Step 3: Create team-pipeline.njk**

```nunjucks
{% extends "layouts/admin.njk" %}

{% block content %}
<div class="mb-4">
  <a href="/admin/team" class="text-indigo-600 hover:underline text-sm">{{ "← Back to Team" | t }}</a>
</div>
<h1 class="text-2xl font-bold mb-6">{{ "Pipeline: " | t }}{{ agent.name }}</h1>
<p class="text-gray-500">{{ "Active sellers: " | t }}{{ agent.activeSellersCount }}</p>
<p class="text-gray-500">{{ "Completed: " | t }}{{ agent.completedCount }}</p>
{% endblock %}
```

- [ ] **Step 4: Create sellers.njk**

```nunjucks
{% extends "layouts/admin.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "All Sellers" | t }}</h1>
<form class="flex gap-3 mb-6" hx-get="/admin/sellers" hx-target="#seller-list" hx-trigger="submit">
  <input type="text" name="search" placeholder="{{ 'Search by name, email, phone' | t }}" class="border rounded px-3 py-2 text-sm flex-1" />
  <select name="status" class="border rounded px-3 py-2 text-sm">
    <option value="">{{ "All statuses" | t }}</option>
    <option value="lead">Lead</option>
    <option value="engaged">Engaged</option>
    <option value="active">Active</option>
    <option value="completed">Completed</option>
    <option value="archived">Archived</option>
  </select>
  <button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded text-sm">{{ "Filter" | t }}</button>
</form>
<div id="action-result" class="mb-4"></div>
<div id="modal-container"></div>
<div id="seller-list">{% include "partials/admin/seller-list.njk" %}</div>
{% endblock %}
```

- [ ] **Step 5: Create settings.njk**

```nunjucks
{% extends "layouts/admin.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "System Settings" | t }}</h1>
{% for group in groups %}
<div class="mb-8">
  <h2 class="text-lg font-semibold text-gray-700 mb-3 border-b pb-2">{{ group.label | t }}</h2>
  {% for setting in group.settings %}
  <div class="flex items-start gap-4 mb-4 py-3 border-b last:border-0">
    <div class="flex-1">
      <div class="text-sm font-medium text-gray-800">{{ setting.key }}</div>
      <div class="text-xs text-gray-500">{{ setting.description }}</div>
    </div>
    <form class="flex items-center gap-2" hx-post="/admin/settings/{{ setting.key }}" hx-target="#result-{{ setting.key }}">
      <input type="text" name="value" value="{{ setting.value }}" class="border rounded px-2 py-1 text-sm w-48" />
      <button type="submit" class="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700">{{ "Save" | t }}</button>
    </form>
    <div id="result-{{ setting.key }}" class="w-32 text-sm"></div>
  </div>
  {% endfor %}
</div>
{% endfor %}
{% endblock %}
```

- [ ] **Step 6: Create hdb.njk**

```nunjucks
{% extends "layouts/admin.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "HDB Data Management" | t }}</h1>
{% include "partials/admin/hdb-status.njk" %}
<div class="mt-6">
  <button
    class="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 text-sm"
    hx-post="/admin/hdb/sync"
    hx-target="#sync-result"
    hx-confirm="{{ 'Trigger a manual HDB data sync? This may take several minutes.' | t }}"
  >{{ "Trigger Manual Sync" | t }}</button>
  <div id="sync-result" class="mt-3"></div>
</div>
<div class="mt-8">
  <h2 class="text-lg font-semibold mb-3">{{ "Sync History" | t }}</h2>
  {% include "partials/admin/hdb-sync-history.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 7: Commit**

```bash
git add src/views/pages/admin/
git commit -m "feat(admin): add admin page views — dashboard, team, sellers, settings, HDB"
```

---

### Task 11: Admin Partials

**Files:**
- Create: `src/views/partials/admin/team-list.njk`
- Create: `src/views/partials/admin/team-action-result.njk`
- Create: `src/views/partials/admin/seller-list.njk`
- Create: `src/views/partials/admin/assign-modal.njk`
- Create: `src/views/partials/admin/settings-form.njk`
- Create: `src/views/partials/admin/settings-result.njk`
- Create: `src/views/partials/admin/hdb-status.njk`
- Create: `src/views/partials/admin/hdb-sync-history.njk`
- Create: `src/views/partials/admin/anonymise-confirm.njk`

- [ ] **Step 1: Create team-list.njk**

```nunjucks
<div class="overflow-x-auto">
  <table class="w-full text-sm">
    <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
      <tr>
        <th class="px-4 py-3 text-left">{{ "Name" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Email" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "CEA Reg" | t }}</th>
        <th class="px-4 py-3 text-center">{{ "Active Sellers" | t }}</th>
        <th class="px-4 py-3 text-center">{{ "Completed" | t }}</th>
        <th class="px-4 py-3 text-center">{{ "Status" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Actions" | t }}</th>
      </tr>
    </thead>
    <tbody class="divide-y">
      {% for member in team %}
      <tr class="hover:bg-gray-50" id="agent-row-{{ member.id }}">
        <td class="px-4 py-3 font-medium">
          <a href="/admin/team/{{ member.id }}/pipeline" class="text-indigo-600 hover:underline">{{ member.name }}</a>
        </td>
        <td class="px-4 py-3 text-gray-600">{{ member.email }}</td>
        <td class="px-4 py-3 text-gray-600">{{ member.ceaRegNo }}</td>
        <td class="px-4 py-3 text-center">{{ member.activeSellersCount }}</td>
        <td class="px-4 py-3 text-center">{{ member.completedCount }}</td>
        <td class="px-4 py-3 text-center">
          {% if member.isActive %}
            <span class="bg-green-100 text-green-700 px-2 py-1 rounded-full text-xs">{{ "Active" | t }}</span>
          {% else %}
            <span class="bg-gray-100 text-gray-600 px-2 py-1 rounded-full text-xs">{{ "Inactive" | t }}</span>
          {% endif %}
        </td>
        <td class="px-4 py-3">
          <div class="flex gap-2">
            {% if member.isActive %}
              <button
                class="text-xs text-amber-600 hover:underline"
                hx-post="/admin/team/{{ member.id }}/deactivate"
                hx-target="#action-result"
                hx-confirm="{{ 'Deactivate this agent?' | t }}"
              >{{ "Deactivate" | t }}</button>
            {% else %}
              <button
                class="text-xs text-green-600 hover:underline"
                hx-post="/admin/team/{{ member.id }}/reactivate"
                hx-target="#action-result"
              >{{ "Reactivate" | t }}</button>
            {% endif %}
            <button
              class="text-xs text-red-600 hover:underline"
              hx-get="/admin/team/{{ member.id }}/anonymise-confirm"
              hx-target="#modal-container"
            >{{ "Anonymise" | t }}</button>
          </div>
        </td>
      </tr>
      {% else %}
      <tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">{{ "No agents found." | t }}</td></tr>
      {% endfor %}
    </tbody>
  </table>
</div>
```

- [ ] **Step 2: Create team-action-result.njk**

```nunjucks
<div class="px-4 py-3 rounded text-sm {% if type == 'success' %}bg-green-50 text-green-700 border border-green-200{% else %}bg-red-50 text-red-700 border border-red-200{% endif %}">
  {{ message | t }}
</div>
```

- [ ] **Step 3: Create seller-list.njk**

```nunjucks
{% if result and result.sellers.length > 0 %}
<div class="overflow-x-auto">
  <table class="w-full text-sm">
    <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
      <tr>
        <th class="px-4 py-3 text-left">{{ "Seller" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Agent" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Status" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Actions" | t }}</th>
      </tr>
    </thead>
    <tbody class="divide-y">
      {% for seller in result.sellers %}
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3">
          <div class="font-medium">{{ seller.name }}</div>
          <div class="text-xs text-gray-500">{{ seller.email }}</div>
        </td>
        <td class="px-4 py-3 text-gray-600">
          {% if seller.agent %}{{ seller.agent.name }}{% else %}<span class="text-amber-600">{{ "Unassigned" | t }}</span>{% endif %}
        </td>
        <td class="px-4 py-3">
          <span class="bg-blue-100 text-blue-700 px-2 py-1 rounded-full text-xs">{{ seller.status }}</span>
        </td>
        <td class="px-4 py-3">
          <button
            class="text-xs text-indigo-600 hover:underline"
            hx-get="/admin/sellers/{{ seller.id }}/assign-modal"
            hx-target="#modal-container"
          >{% if seller.agent %}{{ "Reassign" | t }}{% else %}{{ "Assign" | t }}{% endif %}</button>
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
  <div class="mt-3 text-xs text-gray-500 px-4">
    {{ "Showing" | t }} {{ result.sellers.length }} {{ "of" | t }} {{ result.total }}
  </div>
</div>
{% else %}
<p class="text-gray-400 text-sm">{{ "No sellers found." | t }}</p>
{% endif %}
```

- [ ] **Step 4: Create assign-modal.njk**

The modal posts to different endpoints based on whether it's an assign (no current agent) or reassign (agent exists).

```nunjucks
<div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" id="assign-modal">
  <div class="bg-white rounded-lg shadow-xl p-6 w-96">
    <h3 class="text-lg font-semibold mb-4">
      {% if isReassign %}{{ "Reassign Seller" | t }}{% else %}{{ "Assign Seller" | t }}{% endif %}
    </h3>
    <form
      {% if isReassign %}
        hx-post="/admin/sellers/{{ sellerId }}/reassign"
      {% else %}
        hx-post="/admin/sellers/{{ sellerId }}/assign"
      {% endif %}
      hx-target="#action-result"
      hx-on::after-request="document.getElementById('assign-modal').remove()"
    >
      <div class="mb-4">
        <label class="block text-sm font-medium mb-1">{{ "Select Agent" | t }}</label>
        <select name="agentId" class="w-full border rounded px-3 py-2 text-sm">
          {% for agent in team %}
            {% if agent.isActive %}
              <option value="{{ agent.id }}">{{ agent.name }}</option>
            {% endif %}
          {% endfor %}
        </select>
      </div>
      <div class="flex gap-3 justify-end">
        <button type="button" onclick="document.getElementById('assign-modal').remove()" class="px-4 py-2 text-sm border rounded hover:bg-gray-50">{{ "Cancel" | t }}</button>
        <button type="submit" class="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">{{ "Confirm" | t }}</button>
      </div>
    </form>
  </div>
</div>
```

- [ ] **Step 5: Create settings-form.njk**

```nunjucks
{% for group in groups %}
<div class="mb-6">
  <h3 class="font-medium text-gray-700 mb-2">{{ group.label | t }}</h3>
  {% for setting in group.settings %}
  <div class="flex items-center gap-3 mb-3">
    <label class="text-sm text-gray-600 w-48 shrink-0">{{ setting.key }}</label>
    <form hx-post="/admin/settings/{{ setting.key }}" hx-target="#result-{{ setting.key }}" class="flex gap-2">
      <input type="text" name="value" value="{{ setting.value }}" class="border rounded px-2 py-1 text-sm w-48" />
      <button type="submit" class="bg-indigo-600 text-white px-3 py-1 rounded text-sm">{{ "Save" | t }}</button>
    </form>
    <div id="result-{{ setting.key }}" class="text-sm"></div>
  </div>
  {% endfor %}
</div>
{% endfor %}
```

- [ ] **Step 6: Create settings-result.njk**

```nunjucks
<span class="{% if type == 'success' %}text-green-600{% else %}text-red-600{% endif %} text-xs">
  {{ message | t }}
</span>
```

- [ ] **Step 7: Create hdb-status.njk**

```nunjucks
<div class="grid grid-cols-3 gap-4 mb-6">
  <div class="bg-white border rounded-lg p-4">
    <div class="text-2xl font-bold text-indigo-700">{{ status.totalRecords | formatPrice }}</div>
    <div class="text-sm text-gray-500 mt-1">{{ "Total HDB Transactions" | t }}</div>
  </div>
  <div class="bg-white border rounded-lg p-4">
    <div class="text-sm font-medium">{{ "Date Range" | t }}</div>
    {% if status.dateRange %}
      <div class="text-gray-700 mt-1">{{ status.dateRange.earliest }} — {{ status.dateRange.latest }}</div>
    {% else %}
      <div class="text-gray-400 mt-1">{{ "No data" | t }}</div>
    {% endif %}
  </div>
  <div class="bg-white border rounded-lg p-4">
    <div class="text-sm font-medium">{{ "Last Sync" | t }}</div>
    {% if status.lastSync %}
      <div class="text-gray-700 mt-1">{{ status.lastSync.syncedAt }}</div>
      <div class="text-xs {% if status.lastSync.status == 'success' %}text-green-600{% else %}text-red-600{% endif %}">
        {{ status.lastSync.status | t }}
      </div>
    {% else %}
      <div class="text-gray-400 mt-1">{{ "Never" | t }}</div>
    {% endif %}
  </div>
</div>
```

- [ ] **Step 8: Create hdb-sync-history.njk**

```nunjucks
{% if status.recentSyncs.length > 0 %}
<table class="w-full text-sm">
  <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
    <tr>
      <th class="px-4 py-2 text-left">{{ "Date" | t }}</th>
      <th class="px-4 py-2 text-right">{{ "Records Added" | t }}</th>
      <th class="px-4 py-2 text-right">{{ "Total" | t }}</th>
      <th class="px-4 py-2 text-center">{{ "Status" | t }}</th>
    </tr>
  </thead>
  <tbody class="divide-y">
    {% for sync in status.recentSyncs %}
    <tr>
      <td class="px-4 py-2 text-gray-600">{{ sync.syncedAt }}</td>
      <td class="px-4 py-2 text-right">{{ sync.recordsAdded }}</td>
      <td class="px-4 py-2 text-right">{{ sync.recordsTotal }}</td>
      <td class="px-4 py-2 text-center">
        <span class="{% if sync.status == 'success' %}text-green-600{% else %}text-red-600{% endif %} text-xs font-medium">
          {{ sync.status | t }}
        </span>
      </td>
    </tr>
    {% endfor %}
  </tbody>
</table>
{% else %}
<p class="text-gray-400 text-sm">{{ "No sync history." | t }}</p>
{% endif %}
```

- [ ] **Step 9: Create anonymise-confirm.njk**

```nunjucks
<div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" id="anonymise-modal">
  <div class="bg-white rounded-lg shadow-xl p-6 w-96">
    <h3 class="text-lg font-semibold mb-2 text-red-700">{{ "Anonymise Agent — Irreversible" | t }}</h3>
    <p class="text-sm text-gray-600 mb-4">
      {{ "This will permanently replace the agent's name, email, and phone with anonymised values. This action cannot be undone." | t }}
    </p>
    <div class="flex gap-3 justify-end">
      <button type="button" onclick="document.getElementById('anonymise-modal').remove()" class="px-4 py-2 text-sm border rounded hover:bg-gray-50">{{ "Cancel" | t }}</button>
      <button
        class="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
        hx-post="/admin/team/{{ agentId }}/anonymise"
        hx-target="#action-result"
        hx-on::after-request="document.getElementById('anonymise-modal').remove()"
      >{{ "Anonymise" | t }}</button>
    </div>
  </div>
</div>
```

- [ ] **Step 10: Commit**

```bash
git add src/views/partials/admin/
git commit -m "feat(admin): add all admin partial views — team, sellers, settings, HDB, modals"
```

---

## Chunk 5: Integration Tests

### Task 12: Admin Integration Tests

**Files:**
- Create: `tests/integration/admin.test.ts`

- [ ] **Step 1: Write the integration tests**

```typescript
// tests/integration/admin.test.ts
import request from 'supertest';
import bcrypt from 'bcrypt';
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';
import { createApp } from '../../src/infra/http/app';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
  await testPrisma.$disconnect();
});

/** Create and log in as an admin agent */
async function loginAsAdmin() {
  const password = 'AdminPassword1!';
  const adminRecord = await factory.agent({
    email: `admin-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'admin',
  });

  const agent = request.agent(app);
  await agent.post('/auth/login/agent').type('form').send({
    email: adminRecord.email,
    password,
  });

  return { adminRecord, agent };
}

/** Create and log in as a regular agent */
async function loginAsAgent() {
  const password = 'AgentPassword1!';
  const agentRecord = await factory.agent({
    email: `agent-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'agent',
  });

  const sessionAgent = request.agent(app);
  await sessionAgent.post('/auth/login/agent').type('form').send({
    email: agentRecord.email,
    password,
  });

  return { agentRecord, agent: sessionAgent };
}

// ─── RBAC ────────────────────────────────────────────────────

describe('RBAC — non-admin cannot access admin routes', () => {
  it('GET /admin/team returns 403 for regular agent', async () => {
    const { agent } = await loginAsAgent();
    const res = await agent.get('/admin/team');
    expect(res.status).toBe(403);
  });

  it('POST /admin/settings/commission_amount returns 403 for regular agent', async () => {
    const { agent } = await loginAsAgent();
    const res = await agent.post('/admin/settings/commission_amount').send({ value: '1499' });
    expect(res.status).toBe(403);
  });

  it('GET /admin/sellers returns 403 for regular agent', async () => {
    const { agent } = await loginAsAgent();
    const res = await agent.get('/admin/sellers');
    expect(res.status).toBe(403);
  });

  it('GET /admin/hdb returns 403 for regular agent', async () => {
    const { agent } = await loginAsAgent();
    const res = await agent.get('/admin/hdb');
    expect(res.status).toBe(403);
  });

  it('GET /admin/team returns 200 for admin', async () => {
    const { agent } = await loginAsAdmin();
    // Use HX-Request so the router returns the partial (avoids needing full page view)
    const res = await agent.get('/admin/team').set('HX-Request', 'true');
    expect(res.status).toBe(200);
  });
});

// ─── Team Management ─────────────────────────────────────────

describe('POST /admin/team — create agent', () => {
  it('creates agent and returns success', async () => {
    const { agent } = await loginAsAdmin();
    const ceaRegNo = `R0${Date.now().toString().slice(-5)}A`;

    const res = await agent.post('/admin/team').type('form').send({
      name: 'New Agent',
      email: `newagent-${Date.now()}@test.local`,
      phone: '91234567',
      ceaRegNo,
    });

    expect([200, 302]).toContain(res.status);

    const created = await testPrisma.agent.findFirst({ where: { ceaRegNo } });
    expect(created).not.toBeNull();
    expect(created?.role).toBe('agent');
    expect(created?.isActive).toBe(true);
  });

  it('logs agent.created audit entry', async () => {
    const { agent } = await loginAsAdmin();
    const ceaRegNo = `R1${Date.now().toString().slice(-5)}B`;

    await agent.post('/admin/team').type('form').send({
      name: 'Audit Agent',
      email: `audit-${Date.now()}@test.local`,
      phone: '91234568',
      ceaRegNo,
    });

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'agent.created' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.entityType).toBe('agent');
  });

  it('returns 409 when email already taken', async () => {
    const { agent, adminRecord } = await loginAsAdmin();

    const res = await agent.post('/admin/team').type('form').send({
      name: 'Duplicate',
      email: adminRecord.email,
      phone: '91234567',
      ceaRegNo: 'R000001A',
    });

    expect(res.status).toBe(409);
  });
});

describe('POST /admin/team/:id/deactivate', () => {
  it('returns 400 when agent has active sellers', async () => {
    const { agent } = await loginAsAdmin();

    const targetAgent = await factory.agent({
      email: `target-${Date.now()}@test.local`,
    });
    await factory.seller({ agentId: targetAgent.id, status: 'active' });

    const res = await agent.post(`/admin/team/${targetAgent.id}/deactivate`).type('form').send({});

    expect(res.status).toBe(400);

    const stillActive = await testPrisma.agent.findUnique({ where: { id: targetAgent.id } });
    expect(stillActive?.isActive).toBe(true);
  });

  it('deactivates agent and logs audit when no active sellers', async () => {
    const { agent } = await loginAsAdmin();

    const targetAgent = await factory.agent({
      email: `target2-${Date.now()}@test.local`,
    });
    await factory.seller({ agentId: targetAgent.id, status: 'completed' });

    const res = await agent.post(`/admin/team/${targetAgent.id}/deactivate`).type('form').send({});

    expect([200, 302]).toContain(res.status);

    const deactivated = await testPrisma.agent.findUnique({ where: { id: targetAgent.id } });
    expect(deactivated?.isActive).toBe(false);

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'agent.deactivated', entityId: targetAgent.id },
    });
    expect(auditEntry).not.toBeNull();
  });
});

describe('POST /admin/team/:id/reactivate', () => {
  it('reactivates agent and logs audit', async () => {
    const { agent } = await loginAsAdmin();

    const targetAgent = await factory.agent({
      email: `inactive-${Date.now()}@test.local`,
      isActive: false,
    });

    const res = await agent.post(`/admin/team/${targetAgent.id}/reactivate`).type('form').send({});

    expect([200, 302]).toContain(res.status);

    const reactivated = await testPrisma.agent.findUnique({ where: { id: targetAgent.id } });
    expect(reactivated?.isActive).toBe(true);

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'agent.reactivated', entityId: targetAgent.id },
    });
    expect(auditEntry).not.toBeNull();
  });
});

describe('POST /admin/team/:id/anonymise', () => {
  it('anonymises agent fields and logs audit', async () => {
    const { agent } = await loginAsAdmin();

    const targetAgent = await factory.agent({
      email: `toanonymise-${Date.now()}@test.local`,
      name: 'Real Name',
    });
    await factory.seller({ agentId: targetAgent.id, status: 'completed' });

    const res = await agent.post(`/admin/team/${targetAgent.id}/anonymise`).type('form').send({});

    expect([200, 302]).toContain(res.status);

    const anonymised = await testPrisma.agent.findUnique({ where: { id: targetAgent.id } });
    expect(anonymised?.name).toBe(`Former Agent [${targetAgent.id}]`);
    expect(anonymised?.email).toBe(`anonymised-${targetAgent.id}@deleted.local`);
    expect(anonymised?.phone).toBeNull();
    expect(anonymised?.isActive).toBe(false);

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'agent.anonymised', entityId: targetAgent.id },
    });
    expect(auditEntry).not.toBeNull();
  });
});

// ─── Seller Reassignment ─────────────────────────────────────

describe('POST /admin/sellers/:id/reassign', () => {
  it('updates agentId and logs lead.reassigned audit with from/to', async () => {
    const { agent } = await loginAsAdmin();

    const agentA = await factory.agent({ email: `agenta-${Date.now()}@test.local` });
    const agentB = await factory.agent({ email: `agentb-${Date.now()}@test.local` });
    const seller = await factory.seller({ agentId: agentA.id, status: 'active' });

    const res = await agent
      .post(`/admin/sellers/${seller.id}/reassign`)
      .type('form')
      .send({ agentId: agentB.id });

    expect([200, 302]).toContain(res.status);

    const updated = await testPrisma.seller.findUnique({ where: { id: seller.id } });
    expect(updated?.agentId).toBe(agentB.id);

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'lead.reassigned', entityId: seller.id },
    });
    expect(auditEntry).not.toBeNull();
    const details = auditEntry?.details as Record<string, unknown>;
    expect(details.fromAgentId).toBe(agentA.id);
    expect(details.toAgentId).toBe(agentB.id);
    expect(details.reason).toBe('admin_reassignment');
  });
});

// ─── System Settings ─────────────────────────────────────────

describe('POST /admin/settings/:key', () => {
  it('saves valid commission_amount and logs setting.changed with old+new values', async () => {
    const { agent } = await loginAsAdmin();
    await factory.systemSetting({ key: 'commission_amount', value: '1499' });

    const res = await agent
      .post('/admin/settings/commission_amount')
      .type('form')
      .send({ value: '1600' });

    expect([200, 302]).toContain(res.status);

    const updated = await testPrisma.systemSetting.findUnique({
      where: { key: 'commission_amount' },
    });
    expect(updated?.value).toBe('1600');

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'setting.changed', entityId: 'commission_amount' },
    });
    expect(auditEntry).not.toBeNull();
    const details = auditEntry?.details as Record<string, unknown>;
    expect(details.oldValue).toBe('1499');
    expect(details.newValue).toBe('1600');
  });

  it('returns 400 for invalid commission_amount (negative)', async () => {
    const { agent } = await loginAsAdmin();

    const res = await agent
      .post('/admin/settings/commission_amount')
      .type('form')
      .send({ value: '-500' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for transaction_retention_years < 5 (AML/CFT minimum)', async () => {
    const { agent } = await loginAsAdmin();

    const res = await agent
      .post('/admin/settings/transaction_retention_years')
      .type('form')
      .send({ value: '3' });

    expect(res.status).toBe(400);
  });
});

// ─── HDB Management ──────────────────────────────────────────

describe('POST /admin/hdb/sync', () => {
  it('logs hdb_sync.triggered_manually audit entry', async () => {
    const { agent } = await loginAsAdmin();

    const res = await agent.post('/admin/hdb/sync').type('form').send({});

    expect([200, 302]).toContain(res.status);

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'hdb_sync.triggered_manually' },
    });
    expect(auditEntry).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
npm run test:integration -- --testPathPattern="admin" 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 3: Run full test suite to check for regressions**

```bash
npm test -- --no-coverage 2>&1 | tail -15
npm run test:integration 2>&1 | tail -15
```

Expected: all tests PASS with no regressions.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/admin.test.ts
git commit -m "test(admin): add integration tests for RBAC, team CRUD, settings, HDB sync"
```

---

## Final Verification

- [ ] **Step 1: Full build check**

```bash
npm run build 2>&1 | head -30
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 2: Lint**

```bash
npm run lint 2>&1 | tail -10
```

Expected: no errors (warnings OK).

- [ ] **Step 3: Full test run**

```bash
npm test -- --no-coverage 2>&1 | tail -15
npm run test:integration 2>&1 | tail -15
```

Expected: all unit and integration tests PASS.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(admin): complete Phase 3 SP3 — admin team management, settings panel, HDB data"
```
