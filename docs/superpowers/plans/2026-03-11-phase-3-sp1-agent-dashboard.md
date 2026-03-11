# Phase 3 Sub-Project 1: Agent Dashboard — Pipeline & Seller Detail

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the agent dashboard with pipeline overview, lead queue, seller list with filters, and seller detail view with HTMX-loaded sections.

**Architecture:** New `agent` domain module following existing patterns (types → repository → service → router → tests). Agent sees only their own sellers; admin sees all. Routes use `requireAuth()`, `requireRole('agent', 'admin')`, `requireTwoFactor()`. HTMX partials for seller detail tabs.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Tailwind, Jest, Supertest

---

## Chunk 1: Types, Repository, and Service

### File Structure

```
src/domains/agent/
├── agent.types.ts
├── agent.repository.ts
├── agent.service.ts
├── agent.router.ts
├── agent.validator.ts
├── __tests__/
│   ├── agent.service.test.ts
│   └── agent.router.test.ts
```

### Task 1: Agent Types

**Files:**
- Create: `src/domains/agent/agent.types.ts`

- [ ] **Step 1: Create the types file**

```typescript
import type { SellerStatus, LeadSource } from '@prisma/client';

export interface PipelineStage {
  status: SellerStatus;
  count: number;
  totalValue: number; // sum of asking prices (converted from Decimal at repo boundary)
}

export interface ActivityItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface PipelineOverview {
  stages: PipelineStage[];
  recentActivity: ActivityItem[];
  pendingReviewCount: number;
}

export interface SellerListFilter {
  agentId?: string;
  status?: SellerStatus;
  town?: string;
  dateFrom?: string;
  dateTo?: string;
  leadSource?: LeadSource;
  search?: string;
  page?: number;
  limit?: number;
}

export interface SellerListItem {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  status: SellerStatus;
  leadSource: LeadSource | null;
  createdAt: Date;
  property: {
    id: string;
    town: string;
    flatType: string;
    askingPrice: number | null;
    status: string;
  } | null;
}

export interface SellerListResult {
  sellers: SellerListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface LeadQueueItem {
  id: string;
  name: string;
  phone: string;
  leadSource: LeadSource | null;
  createdAt: Date;
  timeSinceCreation: number; // milliseconds
  welcomeNotificationSent: boolean;
}

export interface SellerDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  status: SellerStatus;
  leadSource: LeadSource | null;
  agentId: string | null;
  onboardingStep: number;
  consentService: boolean;
  consentMarketing: boolean;
  createdAt: Date;
  updatedAt: Date;
  property: {
    id: string;
    town: string;
    street: string;
    block: string;
    flatType: string;
    storeyRange: string;
    floorAreaSqm: number;
    flatModel: string;
    leaseCommenceDate: number;
    askingPrice: number | null;
    priceHistory: unknown;
    status: string;
    listing: {
      id: string;
      status: string;
      title: string | null;
      description: string | null;
    } | null;
  } | null;
}

export interface ComplianceStatus {
  cdd: { status: 'verified' | 'pending' | 'not_started'; verifiedAt: Date | null };
  eaa: { status: 'signed' | 'sent' | 'draft' | 'not_started'; signedAt: Date | null };
  consent: { service: boolean; marketing: boolean; withdrawnAt: Date | null };
  caseFlags: { id: string; flagType: string; status: string; description: string }[];
}

export interface NotificationHistoryItem {
  id: string;
  channel: string;
  templateName: string;
  content: string;
  status: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/agent/agent.types.ts
git commit -m "feat(agent): add agent dashboard types"
```

---

### Task 2: Agent Repository

**Files:**
- Create: `src/domains/agent/agent.repository.ts`

- [ ] **Step 1: Create the repository**

```typescript
import { prisma } from '@/infra/database/prisma';
import type { Prisma, SellerStatus, LeadSource } from '@prisma/client';
import type { SellerListFilter } from './agent.types';

export async function getPipelineStages(agentId?: string) {
  const where = agentId ? { agentId } : {};
  const results = await prisma.seller.groupBy({
    by: ['status'],
    where,
    _count: { id: true },
  });

  // Get total values per status (sum of asking prices from properties)
  const stages = await Promise.all(
    results.map(async (r) => {
      const agg = await prisma.property.aggregate({
        where: { seller: { status: r.status, ...(agentId ? { agentId } : {}) } },
        _sum: { askingPrice: true },
      });
      return {
        status: r.status,
        count: r._count.id,
        totalValue: agg._sum.askingPrice ? Number(agg._sum.askingPrice) : 0,
      };
    }),
  );

  return stages;
}

export async function getRecentActivity(agentId?: string, limit = 10) {
  // Get seller IDs and their related entity IDs for this agent
  const sellers = await prisma.seller.findMany({
    where: agentId ? { agentId } : {},
    select: {
      id: true,
      properties: { select: { id: true, listings: { select: { id: true } } } },
    },
  });

  if (sellers.length === 0) return [];

  // Build a set of all entity IDs related to these sellers
  const entityIds: string[] = [];
  for (const s of sellers) {
    entityIds.push(s.id);
    for (const p of s.properties) {
      entityIds.push(p.id);
      for (const l of p.listings) {
        entityIds.push(l.id);
      }
    }
  }

  return prisma.auditLog.findMany({
    where: {
      entityId: { in: entityIds },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getPendingReviewCount(agentId?: string) {
  const sellerWhere = agentId ? { agentId } : {};

  // FinancialReport has no explicit status field. A report is "pending review" when:
  // - It has an aiNarrative (AI has generated it)
  // - It has NOT been approved (approvedAt is null)
  // - It has NOT been sent to the seller (sentToSellerAt is null)
  // This covers both fresh AI-generated reports and re-generated reports after rejection.
  const [financialReports, listings] = await Promise.all([
    prisma.financialReport.count({
      where: {
        seller: sellerWhere,
        aiNarrative: { not: null },
        approvedAt: null,
      },
    }),
    prisma.listing.count({
      where: {
        property: { seller: sellerWhere },
        status: 'pending_review',
      },
    }),
  ]);

  return financialReports + listings;
}

export async function getLeadQueue(agentId?: string) {
  return prisma.seller.findMany({
    where: {
      status: 'lead',
      ...(agentId ? { agentId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    include: {
      _count: {
        select: {
          // We don't have a direct welcome notification check in a relation,
          // so we'll handle this in the service layer
        },
      },
    },
  });
}

export async function getWelcomeNotificationStatus(sellerIds: string[]) {
  if (sellerIds.length === 0) return new Map<string, boolean>();

  // Check if any notification has been sent to each seller (any template)
  const notifications = await prisma.notification.findMany({
    where: {
      recipientType: 'seller',
      recipientId: { in: sellerIds },
      status: { in: ['sent', 'delivered', 'read'] },
    },
    select: { recipientId: true },
    distinct: ['recipientId'],
  });

  const sentSet = new Set(notifications.map((n) => n.recipientId));
  const sentMap = new Map<string, boolean>();
  for (const id of sellerIds) {
    sentMap.set(id, sentSet.has(id));
  }
  return sentMap;
}

export async function getSellerList(filter: SellerListFilter) {
  const page = filter.page ?? 1;
  const limit = filter.limit ?? 25;
  const skip = (page - 1) * limit;

  const where: Prisma.SellerWhereInput = {};
  if (filter.agentId) where.agentId = filter.agentId;
  if (filter.status) where.status = filter.status as SellerStatus;
  if (filter.leadSource) where.leadSource = filter.leadSource as LeadSource;
  if (filter.dateFrom || filter.dateTo) {
    where.createdAt = {
      ...(filter.dateFrom ? { gte: new Date(filter.dateFrom) } : {}),
      ...(filter.dateTo ? { lte: new Date(filter.dateTo) } : {}),
    };
  }
  if (filter.search) {
    where.OR = [
      { name: { contains: filter.search, mode: 'insensitive' } },
      { email: { contains: filter.search, mode: 'insensitive' } },
      { phone: { contains: filter.search } },
    ];
  }
  if (filter.town) {
    where.properties = { some: { town: { equals: filter.town, mode: 'insensitive' } } };
  }

  const [sellers, total] = await Promise.all([
    prisma.seller.findMany({
      where,
      include: {
        properties: {
          take: 1,
          select: {
            id: true,
            town: true,
            flatType: true,
            askingPrice: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.seller.count({ where }),
  ]);

  return {
    sellers: sellers.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      phone: s.phone,
      status: s.status,
      leadSource: s.leadSource,
      createdAt: s.createdAt,
      property: s.properties[0]
        ? {
            id: s.properties[0].id,
            town: s.properties[0].town,
            flatType: s.properties[0].flatType,
            askingPrice: s.properties[0].askingPrice
              ? Number(s.properties[0].askingPrice)
              : null,
            status: s.properties[0].status,
          }
        : null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getSellerDetail(sellerId: string, agentId?: string) {
  const where: Record<string, unknown> = { id: sellerId };
  if (agentId) where['agentId'] = agentId;

  return prisma.seller.findFirst({
    where,
    include: {
      properties: {
        take: 1,
        include: {
          listings: { take: 1, orderBy: { createdAt: 'desc' } },
        },
      },
    },
  });
}

export async function getComplianceStatus(sellerId: string, agentId?: string) {
  // RBAC: verify seller belongs to agent before returning compliance data
  const sellerWhere: Record<string, unknown> = { id: sellerId };
  if (agentId) sellerWhere['agentId'] = agentId;

  const [cddRecords, eaaRecords, seller, caseFlags] = await Promise.all([
    prisma.cddRecord.findMany({
      where: { subjectType: 'seller', subjectId: sellerId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    }),
    prisma.estateAgencyAgreement.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    }),
    prisma.seller.findFirst({
      where: sellerWhere,
      select: {
        consentService: true,
        consentMarketing: true,
        consentWithdrawnAt: true,
      },
    }),
    prisma.caseFlag.findMany({
      where: { sellerId, status: { not: 'resolved' } },
    }),
  ]);

  const cdd = cddRecords[0];
  const eaa = eaaRecords[0];

  return {
    cdd: {
      status: cdd
        ? cdd.identityVerified
          ? ('verified' as const)
          : ('pending' as const)
        : ('not_started' as const),
      verifiedAt: cdd?.verifiedAt ?? null,
    },
    eaa: {
      status: eaa
        ? eaa.status === 'signed' || eaa.status === 'active'
          ? ('signed' as const)
          : eaa.status === 'sent_to_seller'
            ? ('sent' as const)
            : ('draft' as const)
        : ('not_started' as const),
      signedAt: eaa?.signedAt ?? null,
    },
    consent: {
      service: seller?.consentService ?? false,
      marketing: seller?.consentMarketing ?? false,
      withdrawnAt: seller?.consentWithdrawnAt ?? null,
    },
    caseFlags: caseFlags.map((f) => ({
      id: f.id,
      flagType: f.flagType,
      status: f.status,
      description: f.description,
    })),
  };
}

export async function getNotificationHistory(sellerId: string, agentId?: string) {
  // RBAC: verify seller belongs to agent before returning notifications
  if (agentId) {
    const seller = await prisma.seller.findFirst({
      where: { id: sellerId, agentId },
      select: { id: true },
    });
    if (!seller) return [];
  }

  return prisma.notification.findMany({
    where: {
      recipientType: 'seller',
      recipientId: sellerId,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/agent/agent.repository.ts
git commit -m "feat(agent): add agent dashboard repository"
```

---

### Task 3: Agent Service — Unit Tests

**Files:**
- Create: `src/domains/agent/__tests__/agent.service.test.ts`

- [ ] **Step 1: Write failing tests for getPipelineOverview**

```typescript
import * as agentService from '../agent.service';
import * as agentRepo from '../agent.repository';
import { NotFoundError } from '@/domains/shared/errors';

jest.mock('../agent.repository');

const mockRepo = agentRepo as jest.Mocked<typeof agentRepo>;

describe('agent.service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getPipelineOverview', () => {
    it('returns pipeline stages, activity, and review count for an agent', async () => {
      mockRepo.getPipelineStages.mockResolvedValue([
        { status: 'lead', count: 3, totalValue: 0 },
        { status: 'active', count: 2, totalValue: 1000000 },
      ]);
      mockRepo.getRecentActivity.mockResolvedValue([]);
      mockRepo.getPendingReviewCount.mockResolvedValue(5);

      const result = await agentService.getPipelineOverview('agent-1');

      expect(result.stages).toHaveLength(2);
      expect(result.stages[0]).toEqual({ status: 'lead', count: 3, totalValue: 0 });
      expect(result.pendingReviewCount).toBe(5);
      expect(mockRepo.getPipelineStages).toHaveBeenCalledWith('agent-1');
    });

    it('passes no agentId for admin (sees all)', async () => {
      mockRepo.getPipelineStages.mockResolvedValue([]);
      mockRepo.getRecentActivity.mockResolvedValue([]);
      mockRepo.getPendingReviewCount.mockResolvedValue(0);

      await agentService.getPipelineOverview(undefined);

      expect(mockRepo.getPipelineStages).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getLeadQueue', () => {
    it('returns leads with time since creation and notification status', async () => {
      const now = new Date();
      const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);

      mockRepo.getLeadQueue.mockResolvedValue([
        {
          id: 'seller-1',
          name: 'John Tan',
          phone: '91234567',
          leadSource: 'website',
          createdAt: fiveHoursAgo,
          status: 'lead',
        } as any,
      ]);
      mockRepo.getWelcomeNotificationStatus.mockResolvedValue(
        new Map([['seller-1', true]]),
      );

      const result = await agentService.getLeadQueue('agent-1');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('John Tan');
      expect(result[0].welcomeNotificationSent).toBe(true);
      expect(result[0].timeSinceCreation).toBeGreaterThan(0);
    });
  });

  describe('getSellerList', () => {
    it('enforces agentId filter for non-admin agents', async () => {
      mockRepo.getSellerList.mockResolvedValue({
        sellers: [],
        total: 0,
        page: 1,
        limit: 25,
        totalPages: 0,
      });

      await agentService.getSellerList({ status: 'active' as any }, 'agent-1');

      expect(mockRepo.getSellerList).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1' }),
      );
    });

    it('passes filter without agentId for admin', async () => {
      mockRepo.getSellerList.mockResolvedValue({
        sellers: [],
        total: 0,
        page: 1,
        limit: 25,
        totalPages: 0,
      });

      await agentService.getSellerList({ status: 'active' as any }, undefined);

      expect(mockRepo.getSellerList).toHaveBeenCalledWith(
        expect.not.objectContaining({ agentId: expect.anything() }),
      );
    });
  });

  describe('getSellerDetail', () => {
    it('returns seller detail when seller belongs to agent', async () => {
      mockRepo.getSellerDetail.mockResolvedValue({
        id: 'seller-1',
        name: 'John Tan',
        status: 'active',
        properties: [],
      } as any);

      const result = await agentService.getSellerDetail('seller-1', 'agent-1');

      expect(result.id).toBe('seller-1');
      expect(mockRepo.getSellerDetail).toHaveBeenCalledWith('seller-1', 'agent-1');
    });

    it('throws NotFoundError when seller not found', async () => {
      mockRepo.getSellerDetail.mockResolvedValue(null);

      await expect(
        agentService.getSellerDetail('nonexistent', 'agent-1'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getComplianceStatus', () => {
    it('returns compliance status for a seller', async () => {
      mockRepo.getComplianceStatus.mockResolvedValue({
        cdd: { status: 'verified', verifiedAt: new Date() },
        eaa: { status: 'not_started', signedAt: null },
        consent: { service: true, marketing: false, withdrawnAt: null },
        caseFlags: [],
      });

      const result = await agentService.getComplianceStatus('seller-1');

      expect(result.cdd.status).toBe('verified');
      expect(result.eaa.status).toBe('not_started');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/domains/agent/__tests__/agent.service.test.ts --no-coverage`
Expected: FAIL — module `../agent.service` not found

- [ ] **Step 3: Commit failing tests**

```bash
git add src/domains/agent/__tests__/agent.service.test.ts
git commit -m "test(agent): add failing agent service unit tests"
```

---

### Task 4: Agent Service — Implementation

**Files:**
- Create: `src/domains/agent/agent.service.ts`

- [ ] **Step 1: Implement the service**

```typescript
import * as agentRepo from './agent.repository';
import { NotFoundError } from '@/domains/shared/errors';
import type {
  PipelineOverview,
  LeadQueueItem,
  SellerListFilter,
  SellerListResult,
  SellerDetail,
  ComplianceStatus,
  NotificationHistoryItem,
} from './agent.types';
import type { TimelineMilestone } from '@/domains/seller/seller.types';
import { getTimelineMilestones } from '@/domains/seller/seller.service';

export async function getPipelineOverview(agentId?: string): Promise<PipelineOverview> {
  const [stages, recentActivity, pendingReviewCount] = await Promise.all([
    agentRepo.getPipelineStages(agentId),
    agentRepo.getRecentActivity(agentId),
    agentRepo.getPendingReviewCount(agentId),
  ]);

  return {
    stages,
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      details: a.details as Record<string, unknown>,
      createdAt: a.createdAt,
    })),
    pendingReviewCount,
  };
}

export async function getLeadQueue(agentId?: string): Promise<LeadQueueItem[]> {
  const leads = await agentRepo.getLeadQueue(agentId);
  const sellerIds = leads.map((l) => l.id);
  const notificationMap = await agentRepo.getWelcomeNotificationStatus(sellerIds);

  const now = Date.now();
  return leads.map((lead) => ({
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    leadSource: lead.leadSource,
    createdAt: lead.createdAt,
    timeSinceCreation: now - lead.createdAt.getTime(),
    welcomeNotificationSent: notificationMap.get(lead.id) ?? false,
  }));
}

export async function getSellerList(
  filter: SellerListFilter,
  agentId?: string,
): Promise<SellerListResult> {
  const effectiveFilter = { ...filter };
  if (agentId) {
    effectiveFilter.agentId = agentId;
  }
  return agentRepo.getSellerList(effectiveFilter);
}

export async function getSellerDetail(
  sellerId: string,
  agentId?: string,
): Promise<SellerDetail> {
  const seller = await agentRepo.getSellerDetail(sellerId, agentId);
  if (!seller) {
    throw new NotFoundError('Seller', sellerId);
  }

  const property = seller.properties[0] ?? null;

  return {
    id: seller.id,
    name: seller.name,
    email: seller.email,
    phone: seller.phone,
    status: seller.status,
    leadSource: seller.leadSource,
    agentId: seller.agentId,
    onboardingStep: seller.onboardingStep,
    consentService: seller.consentService,
    consentMarketing: seller.consentMarketing,
    createdAt: seller.createdAt,
    updatedAt: seller.updatedAt,
    property: property
      ? {
          id: property.id,
          town: property.town,
          street: property.street,
          block: property.block,
          flatType: property.flatType,
          storeyRange: property.storeyRange,
          floorAreaSqm: property.floorAreaSqm,
          flatModel: property.flatModel,
          leaseCommenceDate: property.leaseCommenceDate,
          askingPrice: property.askingPrice ? Number(property.askingPrice) : null,
          priceHistory: property.priceHistory,
          status: property.status,
          listing: property.listings[0]
            ? {
                id: property.listings[0].id,
                status: property.listings[0].status,
                title: property.listings[0].title,
                description: property.listings[0].description,
              }
            : null,
        }
      : null,
  };
}

export async function getComplianceStatus(
  sellerId: string,
  agentId?: string,
): Promise<ComplianceStatus> {
  return agentRepo.getComplianceStatus(sellerId, agentId);
}

export async function getNotificationHistory(
  sellerId: string,
  agentId?: string,
): Promise<NotificationHistoryItem[]> {
  const notifications = await agentRepo.getNotificationHistory(sellerId, agentId);
  return notifications.map((n) => ({
    id: n.id,
    channel: n.channel,
    templateName: n.templateName,
    content: n.content,
    status: n.status,
    sentAt: n.sentAt,
    deliveredAt: n.deliveredAt,
    createdAt: n.createdAt,
  }));
}

export function getTimeline(
  propertyStatus: string | null,
  transactionStatus: string | null,
): TimelineMilestone[] {
  return getTimelineMilestones(propertyStatus, transactionStatus);
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx jest src/domains/agent/__tests__/agent.service.test.ts --no-coverage`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/domains/agent/agent.service.ts
git commit -m "feat(agent): implement agent dashboard service"
```

---

## Chunk 2: Router, Views, and Integration Tests

### Task 5: Agent Validator

**Files:**
- Create: `src/domains/agent/agent.validator.ts`

- [ ] **Step 1: Create the validator**

```typescript
import { query } from 'express-validator';

export const validateSellerListQuery = [
  query('status')
    .optional()
    .isIn(['lead', 'engaged', 'active', 'completed', 'archived'])
    .withMessage('Invalid status'),
  query('town').optional().isString().trim(),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('leadSource')
    .optional()
    .isIn(['website', 'tiktok', 'instagram', 'referral', 'walkin', 'other'])
    .withMessage('Invalid lead source'),
  query('search').optional().isString().trim().isLength({ max: 100 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/agent/agent.validator.ts
git commit -m "feat(agent): add agent dashboard validators"
```

---

### Task 6: Agent Router — Unit Tests

**Files:**
- Create: `src/domains/agent/__tests__/agent.router.test.ts`

- [ ] **Step 1: Write failing router tests**

```typescript
import request from 'supertest';
import express from 'express';
import { agentRouter } from '../agent.router';
import * as agentService from '../agent.service';

jest.mock('../agent.service');

const mockService = agentService as jest.Mocked<typeof agentService>;

// Minimal test app with mock auth
function createTestApp(user?: { id: string; role: string }) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mock auth middleware
  app.use((req, _res, next) => {
    if (user) {
      req.isAuthenticated = () => true;
      req.user = {
        id: user.id,
        role: user.role,
        email: 'test@test.local',
        name: 'Test User',
        twoFactorEnabled: true,
        twoFactorVerified: true,
      };
    } else {
      req.isAuthenticated = () => false;
    }
    next();
  });

  // Mock nunjucks render
  app.set('view engine', 'njk');
  app.engine('njk', (_path: string, _options: object, callback: Function) => {
    callback(null, '<html></html>');
  });

  app.use(agentRouter);

  // Error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });

  return app;
}

describe('agent.router', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /agent/dashboard', () => {
    it('returns 401 for unauthenticated users', async () => {
      const app = createTestApp();
      const res = await request(app).get('/agent/dashboard');
      expect(res.status).toBe(401);
    });

    it('returns 403 for sellers', async () => {
      const app = createTestApp({ id: 'seller-1', role: 'seller' });
      const res = await request(app).get('/agent/dashboard');
      expect(res.status).toBe(403);
    });

    it('returns 200 for agents', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getPipelineOverview.mockResolvedValue({
        stages: [],
        recentActivity: [],
        pendingReviewCount: 0,
      });

      const res = await request(app).get('/agent/dashboard');
      expect(res.status).toBe(200);
      expect(mockService.getPipelineOverview).toHaveBeenCalledWith('agent-1');
    });

    it('returns 200 for admins (no agentId filter)', async () => {
      const app = createTestApp({ id: 'admin-1', role: 'admin' });
      mockService.getPipelineOverview.mockResolvedValue({
        stages: [],
        recentActivity: [],
        pendingReviewCount: 0,
      });

      const res = await request(app).get('/agent/dashboard');
      expect(res.status).toBe(200);
      expect(mockService.getPipelineOverview).toHaveBeenCalledWith(undefined);
    });
  });

  describe('GET /agent/sellers', () => {
    it('passes filter query params to service', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getSellerList.mockResolvedValue({
        sellers: [],
        total: 0,
        page: 1,
        limit: 25,
        totalPages: 0,
      });

      await request(app).get('/agent/sellers?status=active&town=TAMPINES');

      expect(mockService.getSellerList).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active', town: 'TAMPINES' }),
        'agent-1',
      );
    });
  });

  describe('GET /agent/sellers/:id', () => {
    it('returns seller detail for agent\'s own seller', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getSellerDetail.mockResolvedValue({
        id: 'seller-1',
        name: 'John',
        status: 'active',
      } as any);

      const res = await request(app).get('/agent/sellers/seller-1');
      expect(res.status).toBe(200);
      expect(mockService.getSellerDetail).toHaveBeenCalledWith('seller-1', 'agent-1');
    });

    it('returns 404 when seller not found', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      const { NotFoundError } = require('@/domains/shared/errors');
      mockService.getSellerDetail.mockRejectedValue(
        new NotFoundError('Seller', 'nonexistent'),
      );

      const res = await request(app).get('/agent/sellers/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /agent/leads', () => {
    it('returns lead queue for agent', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getLeadQueue.mockResolvedValue([]);

      const res = await request(app).get('/agent/leads');
      expect(res.status).toBe(200);
      expect(mockService.getLeadQueue).toHaveBeenCalledWith('agent-1');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/domains/agent/__tests__/agent.router.test.ts --no-coverage`
Expected: FAIL — module `../agent.router` not found

- [ ] **Step 3: Commit failing tests**

```bash
git add src/domains/agent/__tests__/agent.router.test.ts
git commit -m "test(agent): add failing agent router unit tests"
```

---

### Task 7: Agent Router — Implementation

**Files:**
- Create: `src/domains/agent/agent.router.ts`
- Modify: `src/infra/http/app.ts` (add import and mount)

- [ ] **Step 1: Create the router**

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as agentService from './agent.service';
import { validateSellerListQuery } from './agent.validator';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

export const agentRouter = Router();

const agentAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];

/** Helper: returns agentId for RBAC filtering, or undefined for admin (sees all) */
function getAgentFilter(user: AuthenticatedUser): string | undefined {
  return user.role === 'admin' ? undefined : user.id;
}

// GET /agent/dashboard — Pipeline overview
agentRouter.get(
  '/agent/dashboard',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const overview = await agentService.getPipelineOverview(getAgentFilter(user));

      if (req.headers['hx-request']) {
        return res.render('partials/agent/pipeline', { overview });
      }
      res.render('pages/agent/dashboard', { overview });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/leads — Lead queue
agentRouter.get(
  '/agent/leads',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const leads = await agentService.getLeadQueue(getAgentFilter(user));

      if (req.headers['hx-request']) {
        return res.render('partials/agent/lead-queue', { leads });
      }
      res.render('pages/agent/leads', { leads });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/sellers — Seller list with filters
agentRouter.get(
  '/agent/sellers',
  ...agentAuth,
  ...validateSellerListQuery,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const user = req.user as AuthenticatedUser;
      const filter = {
        status: req.query['status'] as string | undefined,
        town: req.query['town'] as string | undefined,
        dateFrom: req.query['dateFrom'] as string | undefined,
        dateTo: req.query['dateTo'] as string | undefined,
        leadSource: req.query['leadSource'] as string | undefined,
        search: req.query['search'] as string | undefined,
        page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
        limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
      };

      const result = await agentService.getSellerList(filter, getAgentFilter(user));

      if (req.headers['hx-request']) {
        return res.render('partials/agent/seller-list', { result });
      }
      res.render('pages/agent/sellers', { result });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/sellers/:id — Seller detail
agentRouter.get(
  '/agent/sellers/:id',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const seller = await agentService.getSellerDetail(
        req.params['id'] as string,
        getAgentFilter(user),
      );

      if (req.headers['hx-request']) {
        return res.render('partials/agent/seller-overview', { seller });
      }
      res.render('pages/agent/seller-detail', { seller });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/sellers/:id/timeline — HTMX partial
agentRouter.get(
  '/agent/sellers/:id/timeline',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const seller = await agentService.getSellerDetail(
        req.params['id'] as string,
        getAgentFilter(user),
      );
      const milestones = agentService.getTimeline(
        seller.property?.status ?? null,
        null,
      );

      res.render('partials/agent/seller-timeline', { milestones });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/sellers/:id/compliance — HTMX partial
agentRouter.get(
  '/agent/sellers/:id/compliance',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const compliance = await agentService.getComplianceStatus(
        req.params['id'] as string,
        getAgentFilter(user),
      );

      res.render('partials/agent/seller-compliance', { compliance });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/sellers/:id/notifications — HTMX partial
agentRouter.get(
  '/agent/sellers/:id/notifications',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const notifications = await agentService.getNotificationHistory(
        req.params['id'] as string,
        getAgentFilter(user),
      );

      res.render('partials/agent/seller-notifications', { notifications });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 2: Mount router in app.ts**

In `src/infra/http/app.ts`, add import and mount:

```typescript
// Add import at top (after viewingRouter import):
import { agentRouter } from '../../domains/agent/agent.router';

// Add route mount (after viewingRouter):
app.use(agentRouter);
```

- [ ] **Step 3: Run router tests to verify they pass**

Run: `npx jest src/domains/agent/__tests__/agent.router.test.ts --no-coverage`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/domains/agent/agent.router.ts src/infra/http/app.ts
git commit -m "feat(agent): implement agent dashboard router and mount in app"
```

---

### Task 8: Nunjucks Views — Agent Layout and Pages

**Files:**
- Modify: `src/views/layouts/agent.njk`
- Create: `src/views/pages/agent/dashboard.njk`
- Create: `src/views/pages/agent/leads.njk`
- Create: `src/views/pages/agent/sellers.njk`
- Create: `src/views/pages/agent/seller-detail.njk`
- Create: `src/views/partials/agent/pipeline.njk`
- Create: `src/views/partials/agent/lead-queue.njk`
- Create: `src/views/partials/agent/seller-list.njk`
- Create: `src/views/partials/agent/seller-overview.njk`
- Create: `src/views/partials/agent/seller-timeline.njk`
- Create: `src/views/partials/agent/seller-compliance.njk`
- Create: `src/views/partials/agent/seller-notifications.njk`

- [ ] **Step 1: Update agent layout with full sidebar nav**

Update `src/views/layouts/agent.njk`:

```nunjucks
{% extends "layouts/base.njk" %}

{% block body %}
<div class="flex min-h-screen">
  <aside class="w-64 bg-gray-900 text-white p-4 flex-shrink-0">
    <div class="text-lg font-bold mb-6">{{ "Agent Portal" | t }}</div>
    <nav class="space-y-1">
      <a href="/agent/dashboard" class="block px-3 py-2 rounded hover:bg-gray-800 {% if currentPath == '/agent/dashboard' %}bg-gray-800{% endif %}">
        {{ "Dashboard" | t }}
      </a>
      <a href="/agent/leads" class="block px-3 py-2 rounded hover:bg-gray-800 {% if currentPath == '/agent/leads' %}bg-gray-800{% endif %}">
        {{ "Leads" | t }}
      </a>
      <a href="/agent/sellers" class="block px-3 py-2 rounded hover:bg-gray-800 {% if currentPath == '/agent/sellers' %}bg-gray-800{% endif %}">
        {{ "Sellers" | t }}
      </a>
      <a href="/agent/reviews" class="block px-3 py-2 rounded hover:bg-gray-800 {% if currentPath == '/agent/reviews' %}bg-gray-800{% endif %}">
        {{ "Reviews" | t }}
        {% if pendingReviewCount %}
        <span class="ml-2 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{{ pendingReviewCount }}</span>
        {% endif %}
      </a>
      <a href="/agent/settings" class="block px-3 py-2 rounded hover:bg-gray-800 {% if currentPath == '/agent/settings' %}bg-gray-800{% endif %}">
        {{ "Settings" | t }}
      </a>
    </nav>
  </aside>
  <main class="flex-1 p-8 bg-gray-50">
    {% block content %}{% endblock %}
  </main>
</div>
{% endblock %}
```

- [ ] **Step 2: Create dashboard page**

Create `src/views/pages/agent/dashboard.njk`:

```nunjucks
{% extends "layouts/agent.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Pipeline Overview" | t }}</h1>

<div id="pipeline-content" hx-get="/agent/dashboard" hx-trigger="load" hx-swap="innerHTML" hx-headers='{"HX-Request": "true"}'>
  <div class="text-gray-500">{{ "Loading..." | t }}</div>
</div>
{% endblock %}
```

- [ ] **Step 3: Create pipeline partial**

Create `src/views/partials/agent/pipeline.njk`:

```nunjucks
<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
  {% for stage in overview.stages %}
  <div class="bg-white rounded-lg shadow p-4">
    <div class="text-sm text-gray-500 uppercase">{{ stage.status | t }}</div>
    <div class="text-2xl font-bold">{{ stage.count }}</div>
    {% if stage.totalValue > 0 %}
    <div class="text-sm text-gray-400">${{ stage.totalValue | formatPrice }}</div>
    {% endif %}
  </div>
  {% endfor %}
</div>

{% if overview.pendingReviewCount > 0 %}
<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
  <a href="/agent/reviews" class="text-yellow-800 font-medium">
    {{ overview.pendingReviewCount }} {{ "items pending review" | t }} →
  </a>
</div>
{% endif %}

{% if overview.recentActivity.length > 0 %}
<h2 class="text-lg font-semibold mb-3">{{ "Recent Activity" | t }}</h2>
<div class="bg-white rounded-lg shadow divide-y">
  {% for item in overview.recentActivity %}
  <div class="px-4 py-3 flex justify-between items-center">
    <span class="text-sm">{{ item.action }}</span>
    <span class="text-xs text-gray-400">{{ item.createdAt }}</span>
  </div>
  {% endfor %}
</div>
{% endif %}
```

- [ ] **Step 4: Create leads page and partial**

Create `src/views/pages/agent/leads.njk`:

```nunjucks
{% extends "layouts/agent.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Lead Queue" | t }}</h1>

<div id="lead-queue" hx-get="/agent/leads" hx-trigger="load" hx-swap="innerHTML" hx-headers='{"HX-Request": "true"}'>
  <div class="text-gray-500">{{ "Loading..." | t }}</div>
</div>
{% endblock %}
```

Create `src/views/partials/agent/lead-queue.njk`:

```nunjucks
{% if leads.length == 0 %}
<div class="text-gray-500 py-8 text-center">{{ "No new leads" | t }}</div>
{% else %}
<div class="bg-white rounded-lg shadow overflow-hidden">
  <table class="min-w-full divide-y divide-gray-200">
    <thead class="bg-gray-50">
      <tr>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Name" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Phone" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Source" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Time" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Notified" | t }}</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-gray-200">
      {% for lead in leads %}
      <tr class="hover:bg-gray-50 cursor-pointer" onclick="window.location='/agent/sellers/{{ lead.id }}'">
        <td class="px-4 py-3 text-sm font-medium">{{ lead.name }}</td>
        <td class="px-4 py-3 text-sm text-gray-500">{{ lead.phone }}</td>
        <td class="px-4 py-3 text-sm text-gray-500">{{ lead.leadSource or "—" }}</td>
        <td class="px-4 py-3 text-sm text-gray-500">{{ lead.createdAt }}</td>
        <td class="px-4 py-3 text-sm">
          {% if lead.welcomeNotificationSent %}
          <span class="text-green-600">✓</span>
          {% else %}
          <span class="text-gray-300">—</span>
          {% endif %}
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
</div>
{% endif %}
```

- [ ] **Step 5: Create sellers list page and partial**

Create `src/views/pages/agent/sellers.njk`:

```nunjucks
{% extends "layouts/agent.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Sellers" | t }}</h1>

<form hx-get="/agent/sellers" hx-target="#seller-list" hx-trigger="change, keyup changed delay:300ms from:find input[name=search]" class="flex gap-3 mb-6 flex-wrap">
  <select name="status" class="border rounded px-3 py-2 text-sm">
    <option value="">{{ "All Statuses" | t }}</option>
    <option value="lead">{{ "Lead" | t }}</option>
    <option value="engaged">{{ "Engaged" | t }}</option>
    <option value="active">{{ "Active" | t }}</option>
    <option value="completed">{{ "Completed" | t }}</option>
    <option value="archived">{{ "Archived" | t }}</option>
  </select>
  <input type="text" name="search" placeholder="{{ 'Search name, email, phone...' | t }}" class="border rounded px-3 py-2 text-sm w-64" />
  <input type="text" name="town" placeholder="{{ 'Town' | t }}" class="border rounded px-3 py-2 text-sm w-40" />
</form>

<div id="seller-list" hx-get="/agent/sellers" hx-trigger="load" hx-swap="innerHTML" hx-headers='{"HX-Request": "true"}'>
  <div class="text-gray-500">{{ "Loading..." | t }}</div>
</div>
{% endblock %}
```

Create `src/views/partials/agent/seller-list.njk`:

```nunjucks
{% if result.sellers.length == 0 %}
<div class="text-gray-500 py-8 text-center">{{ "No sellers found" | t }}</div>
{% else %}
<div class="bg-white rounded-lg shadow overflow-hidden">
  <table class="min-w-full divide-y divide-gray-200">
    <thead class="bg-gray-50">
      <tr>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Name" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Status" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Property" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Asking Price" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Source" | t }}</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-gray-200">
      {% for seller in result.sellers %}
      <tr class="hover:bg-gray-50 cursor-pointer" onclick="window.location='/agent/sellers/{{ seller.id }}'">
        <td class="px-4 py-3 text-sm font-medium">{{ seller.name }}</td>
        <td class="px-4 py-3 text-sm">
          <span class="px-2 py-1 text-xs rounded-full
            {% if seller.status == 'lead' %}bg-blue-100 text-blue-800
            {% elif seller.status == 'engaged' %}bg-yellow-100 text-yellow-800
            {% elif seller.status == 'active' %}bg-green-100 text-green-800
            {% elif seller.status == 'completed' %}bg-gray-100 text-gray-800
            {% elif seller.status == 'archived' %}bg-red-100 text-red-800
            {% endif %}">{{ seller.status | t }}</span>
        </td>
        <td class="px-4 py-3 text-sm text-gray-500">
          {% if seller.property %}{{ seller.property.town }} — {{ seller.property.flatType }}{% else %}—{% endif %}
        </td>
        <td class="px-4 py-3 text-sm text-gray-500">
          {% if seller.property and seller.property.askingPrice %}${{ seller.property.askingPrice | formatPrice }}{% else %}—{% endif %}
        </td>
        <td class="px-4 py-3 text-sm text-gray-500">{{ seller.leadSource or "—" }}</td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
</div>

{% if result.totalPages > 1 %}
<div class="mt-4 flex justify-center gap-2">
  {% for p in range(1, result.totalPages + 1) %}
  <a href="?page={{ p }}" hx-get="/agent/sellers?page={{ p }}" hx-target="#seller-list"
     class="px-3 py-1 rounded text-sm {% if p == result.page %}bg-blue-600 text-white{% else %}bg-gray-200 hover:bg-gray-300{% endif %}">
    {{ p }}
  </a>
  {% endfor %}
</div>
{% endif %}
{% endif %}
```

- [ ] **Step 6: Create seller detail page and partials**

Create `src/views/pages/agent/seller-detail.njk`:

```nunjucks
{% extends "layouts/agent.njk" %}

{% block content %}
<div class="mb-4">
  <a href="/agent/sellers" class="text-sm text-blue-600 hover:underline">← {{ "Back to Sellers" | t }}</a>
</div>

<div class="flex items-center justify-between mb-6">
  <div>
    <h1 class="text-2xl font-bold">{{ seller.name }}</h1>
    <p class="text-gray-500">{{ seller.phone }} · {{ seller.email or "No email" }}</p>
  </div>
  <span class="px-3 py-1 text-sm rounded-full
    {% if seller.status == 'lead' %}bg-blue-100 text-blue-800
    {% elif seller.status == 'engaged' %}bg-yellow-100 text-yellow-800
    {% elif seller.status == 'active' %}bg-green-100 text-green-800
    {% elif seller.status == 'completed' %}bg-gray-100 text-gray-800
    {% elif seller.status == 'archived' %}bg-red-100 text-red-800
    {% endif %}">{{ seller.status | t }}</span>
</div>

<!-- Tabs -->
<div class="border-b mb-6">
  <nav class="flex gap-6 -mb-px" id="seller-tabs">
    <button class="tab-btn pb-3 border-b-2 border-blue-600 text-blue-600 text-sm font-medium" data-tab="overview">{{ "Overview" | t }}</button>
    <button class="tab-btn pb-3 border-b-2 border-transparent text-gray-500 hover:text-gray-700 text-sm font-medium" data-tab="timeline" hx-get="/agent/sellers/{{ seller.id }}/timeline" hx-target="#tab-content" hx-swap="innerHTML">{{ "Timeline" | t }}</button>
    <button class="tab-btn pb-3 border-b-2 border-transparent text-gray-500 hover:text-gray-700 text-sm font-medium" data-tab="compliance" hx-get="/agent/sellers/{{ seller.id }}/compliance" hx-target="#tab-content" hx-swap="innerHTML">{{ "Compliance" | t }}</button>
    <button class="tab-btn pb-3 border-b-2 border-transparent text-gray-500 hover:text-gray-700 text-sm font-medium" data-tab="notifications" hx-get="/agent/sellers/{{ seller.id }}/notifications" hx-target="#tab-content" hx-swap="innerHTML">{{ "Notifications" | t }}</button>
  </nav>
</div>

<div id="tab-content">
  {% include "partials/agent/seller-overview.njk" %}
</div>
{% endblock %}
```

Create `src/views/partials/agent/seller-overview.njk`:

```nunjucks
<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
  <div class="bg-white rounded-lg shadow p-6">
    <h3 class="text-lg font-semibold mb-4">{{ "Seller Info" | t }}</h3>
    <dl class="space-y-2 text-sm">
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Status" | t }}</dt><dd>{{ seller.status }}</dd></div>
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Lead Source" | t }}</dt><dd>{{ seller.leadSource or "—" }}</dd></div>
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Onboarding" | t }}</dt><dd>{{ "Step" | t }} {{ seller.onboardingStep }} / 5</dd></div>
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Created" | t }}</dt><dd>{{ seller.createdAt }}</dd></div>
    </dl>
  </div>

  {% if seller.property %}
  <div class="bg-white rounded-lg shadow p-6">
    <h3 class="text-lg font-semibold mb-4">{{ "Property" | t }}</h3>
    <dl class="space-y-2 text-sm">
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Address" | t }}</dt><dd>{{ seller.property.block }} {{ seller.property.street }}</dd></div>
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Town" | t }}</dt><dd>{{ seller.property.town }}</dd></div>
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Type" | t }}</dt><dd>{{ seller.property.flatType }}</dd></div>
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Floor Area" | t }}</dt><dd>{{ seller.property.floorAreaSqm }} sqm</dd></div>
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Asking Price" | t }}</dt><dd>{% if seller.property.askingPrice %}${{ seller.property.askingPrice | formatPrice }}{% else %}{{ "Not set" | t }}{% endif %}</dd></div>
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Status" | t }}</dt><dd>{{ seller.property.status }}</dd></div>
    </dl>
  </div>
  {% else %}
  <div class="bg-white rounded-lg shadow p-6">
    <h3 class="text-lg font-semibold mb-4">{{ "Property" | t }}</h3>
    <p class="text-gray-500 text-sm">{{ "No property added yet" | t }}</p>
  </div>
  {% endif %}
</div>
```

Create `src/views/partials/agent/seller-timeline.njk`:

```nunjucks
<div class="bg-white rounded-lg shadow p-6">
  <h3 class="text-lg font-semibold mb-4">{{ "Transaction Timeline" | t }}</h3>
  <div class="space-y-4">
    {% for milestone in milestones %}
    <div class="flex items-start gap-3">
      <div class="mt-1 w-3 h-3 rounded-full flex-shrink-0
        {% if milestone.status == 'completed' %}bg-green-500
        {% elif milestone.status == 'current' %}bg-blue-500
        {% else %}bg-gray-300{% endif %}"></div>
      <div>
        <div class="text-sm font-medium {% if milestone.status == 'upcoming' %}text-gray-400{% endif %}">{{ milestone.label | t }}</div>
        <div class="text-xs text-gray-500">{{ milestone.description | t }}</div>
      </div>
    </div>
    {% endfor %}
  </div>
</div>
```

Create `src/views/partials/agent/seller-compliance.njk`:

```nunjucks
<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
  <div class="bg-white rounded-lg shadow p-6">
    <h3 class="text-lg font-semibold mb-4">{{ "CDD Status" | t }}</h3>
    <span class="px-2 py-1 text-xs rounded-full
      {% if compliance.cdd.status == 'verified' %}bg-green-100 text-green-800
      {% elif compliance.cdd.status == 'pending' %}bg-yellow-100 text-yellow-800
      {% else %}bg-gray-100 text-gray-800{% endif %}">{{ compliance.cdd.status | t }}</span>
  </div>

  <div class="bg-white rounded-lg shadow p-6">
    <h3 class="text-lg font-semibold mb-4">{{ "Estate Agency Agreement" | t }}</h3>
    <span class="px-2 py-1 text-xs rounded-full
      {% if compliance.eaa.status == 'signed' %}bg-green-100 text-green-800
      {% elif compliance.eaa.status == 'sent' %}bg-yellow-100 text-yellow-800
      {% elif compliance.eaa.status == 'draft' %}bg-blue-100 text-blue-800
      {% else %}bg-gray-100 text-gray-800{% endif %}">{{ compliance.eaa.status | t }}</span>
  </div>

  <div class="bg-white rounded-lg shadow p-6">
    <h3 class="text-lg font-semibold mb-4">{{ "Consent" | t }}</h3>
    <dl class="space-y-2 text-sm">
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Service" | t }}</dt><dd>{% if compliance.consent.service %}✓{% else %}✗{% endif %}</dd></div>
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Marketing" | t }}</dt><dd>{% if compliance.consent.marketing %}✓{% else %}✗{% endif %}</dd></div>
      {% if compliance.consent.withdrawnAt %}
      <div class="text-xs text-red-500">{{ "Withdrawn:" | t }} {{ compliance.consent.withdrawnAt }}</div>
      {% endif %}
    </dl>
  </div>

  <div class="bg-white rounded-lg shadow p-6">
    <h3 class="text-lg font-semibold mb-4">{{ "Case Flags" | t }}</h3>
    {% if compliance.caseFlags.length == 0 %}
    <p class="text-sm text-gray-500">{{ "No active flags" | t }}</p>
    {% else %}
    <div class="space-y-2">
      {% for flag in compliance.caseFlags %}
      <div class="text-sm border-l-2 border-yellow-500 pl-3">
        <div class="font-medium">{{ flag.flagType }}</div>
        <div class="text-gray-500">{{ flag.description }}</div>
      </div>
      {% endfor %}
    </div>
    {% endif %}
  </div>
</div>
```

Create `src/views/partials/agent/seller-notifications.njk`:

```nunjucks
<div class="bg-white rounded-lg shadow overflow-hidden">
  {% if notifications.length == 0 %}
  <div class="p-6 text-center text-gray-500 text-sm">{{ "No notifications sent" | t }}</div>
  {% else %}
  <table class="min-w-full divide-y divide-gray-200">
    <thead class="bg-gray-50">
      <tr>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Channel" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Template" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Status" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Sent" | t }}</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-gray-200">
      {% for n in notifications %}
      <tr>
        <td class="px-4 py-3 text-sm">{{ n.channel }}</td>
        <td class="px-4 py-3 text-sm">{{ n.templateName }}</td>
        <td class="px-4 py-3 text-sm">
          <span class="px-2 py-1 text-xs rounded-full
            {% if n.status == 'delivered' %}bg-green-100 text-green-800
            {% elif n.status == 'sent' %}bg-blue-100 text-blue-800
            {% elif n.status == 'failed' %}bg-red-100 text-red-800
            {% else %}bg-gray-100 text-gray-800{% endif %}">{{ n.status }}</span>
        </td>
        <td class="px-4 py-3 text-sm text-gray-500">{{ n.sentAt or n.createdAt }}</td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
  {% endif %}
</div>
```

- [ ] **Step 7: Commit all views**

```bash
git add src/views/layouts/agent.njk src/views/pages/agent/ src/views/partials/agent/
git commit -m "feat(agent): add agent dashboard views and partials"
```

---

### Task 9: Integration Tests

**Files:**
- Create: `tests/integration/agent-dashboard.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
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

async function loginAsAgent(overrides?: { role?: 'agent' | 'admin' }) {
  const password = 'AgentPassword1!';
  const agentRecord = await factory.agent({
    email: `agent-${Date.now()}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
    role: overrides?.role ?? 'agent',
  });

  const agent = request.agent(app);
  await agent.post('/auth/login/agent').type('form').send({
    email: agentRecord.email,
    password,
  });

  return { agentRecord, agent };
}

async function loginAsSeller() {
  const password = 'TestPassword1!';
  const seller = await factory.seller({
    email: `seller-${Date.now()}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
  });

  const agent = request.agent(app);
  await agent.post('/auth/login/seller').type('form').send({
    email: seller.email,
    password,
  });

  return { seller, agent };
}

describe('Agent Dashboard Integration', () => {
  describe('Authentication & RBAC', () => {
    it('returns 401 for unauthenticated access to /agent/dashboard', async () => {
      const res = await request(app).get('/agent/dashboard');
      expect(res.status).toBe(401);
    });

    it('returns 403 for sellers accessing /agent/dashboard', async () => {
      const { agent } = await loginAsSeller();
      const res = await agent.get('/agent/dashboard');
      expect(res.status).toBe(403);
    });

    it('returns 200 for agents accessing /agent/dashboard', async () => {
      const { agent } = await loginAsAgent();
      const res = await agent.get('/agent/dashboard');
      expect(res.status).toBe(200);
    });

    it('returns 200 for admins accessing /agent/dashboard', async () => {
      const { agent } = await loginAsAgent({ role: 'admin' });
      const res = await agent.get('/agent/dashboard');
      expect(res.status).toBe(200);
    });
  });

  describe('RBAC - agent sees only own sellers', () => {
    it('agent sees only their assigned sellers in seller list', async () => {
      const { agentRecord, agent } = await loginAsAgent();
      const otherAgent = await factory.agent({ email: 'other@test.local' });

      // Create sellers for both agents
      await factory.seller({ agentId: agentRecord.id, name: 'My Seller' });
      await factory.seller({ agentId: otherAgent.id, name: 'Other Seller' });

      const res = await agent.get('/agent/sellers').set('HX-Request', 'true');
      expect(res.status).toBe(200);
      expect(res.text).toContain('My Seller');
      expect(res.text).not.toContain('Other Seller');
    });

    it('admin sees all sellers in seller list', async () => {
      const { agent } = await loginAsAgent({ role: 'admin' });
      const otherAgent = await factory.agent({ email: 'other@test.local' });

      await factory.seller({ agentId: otherAgent.id, name: 'Any Seller' });

      const res = await agent.get('/agent/sellers').set('HX-Request', 'true');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Any Seller');
    });
  });

  describe('Seller Detail', () => {
    it('agent can view their own seller detail', async () => {
      const { agentRecord, agent } = await loginAsAgent();
      const seller = await factory.seller({
        agentId: agentRecord.id,
        name: 'Detail Seller',
      });

      const res = await agent.get(`/agent/sellers/${seller.id}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('Detail Seller');
    });

    it('agent cannot view another agent\'s seller', async () => {
      const { agent } = await loginAsAgent();
      const otherAgent = await factory.agent({ email: 'other@test.local' });
      const seller = await factory.seller({ agentId: otherAgent.id });

      const res = await agent.get(`/agent/sellers/${seller.id}`);
      expect(res.status).toBe(404);
    });
  });

  describe('HTMX Partials', () => {
    it('returns partial for timeline tab', async () => {
      const { agentRecord, agent } = await loginAsAgent();
      const seller = await factory.seller({ agentId: agentRecord.id });

      const res = await agent
        .get(`/agent/sellers/${seller.id}/timeline`)
        .set('HX-Request', 'true');
      expect(res.status).toBe(200);
    });

    it('returns partial for compliance tab', async () => {
      const { agentRecord, agent } = await loginAsAgent();
      const seller = await factory.seller({ agentId: agentRecord.id });

      const res = await agent
        .get(`/agent/sellers/${seller.id}/compliance`)
        .set('HX-Request', 'true');
      expect(res.status).toBe(200);
    });

    it('returns partial for notifications tab', async () => {
      const { agentRecord, agent } = await loginAsAgent();
      const seller = await factory.seller({ agentId: agentRecord.id });

      const res = await agent
        .get(`/agent/sellers/${seller.id}/notifications`)
        .set('HX-Request', 'true');
      expect(res.status).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npm run test:integration -- --testPathPattern=agent-dashboard`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/agent-dashboard.test.ts
git commit -m "test(agent): add agent dashboard integration tests"
```

---

### Task 10: Run Full Test Suite

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: All tests PASS, no regressions

- [ ] **Step 2: Run all integration tests**

Run: `npm run test:integration`
Expected: All tests PASS, no regressions

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(agent): resolve test regressions from agent dashboard integration"
```
