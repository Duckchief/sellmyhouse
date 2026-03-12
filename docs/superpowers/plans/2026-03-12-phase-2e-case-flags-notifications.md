# Phase 2E: Case Flags, Notification Preferences, Co-Broke & Fallen-Through Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build case flag management, seller notification preference settings, co-broke auto-detection, and fallen-through reason tracking to complete Phase 2.

**Architecture:** Four independent subsystems extending existing domain modules. Case flags are a new service/repository pair in the seller domain. Notification preferences extend the existing seller service with two new settings routes. Co-broke detection is a one-line derivation in the offer service. Fallen-through improvements add a `fallenThroughReason` field and seller notification to the existing transaction cascade.

**Tech Stack:** TypeScript, Express, Prisma (PostgreSQL), HTMX, Nunjucks, Jest, Supertest

**Spec:** `docs/superpowers/specs/2026-03-10-phase-2-seller-dashboard-design.md` (Sub-project 2E section)

**Run tests after each section:** `npm test && npm run test:integration`

> **Note on CaseFlagType enum values:** The spec uses `eip_spr_quota` and `pr_seller`, but the Prisma schema was created with `eip_restriction` and `pr_quota`. The schema is the ground truth for generated TypeScript types. This plan uses the schema values (`eip_restriction`, `pr_quota`) throughout.

---

## Chunk 1: Case Flags

### Task 1: Types + Factory Update

**Files:**
- Create: `src/domains/seller/case-flag.types.ts`
- Create: `src/domains/seller/__tests__/case-flag.types.test.ts`
- Modify: `tests/fixtures/factory.ts`

- [ ] **Step 1: Write the failing type test**

Create `src/domains/seller/__tests__/case-flag.types.test.ts`:

```typescript
import { CASE_FLAG_CHECKLISTS, type CreateCaseFlagInput, type UpdateCaseFlagInput } from '../case-flag.types';

describe('CASE_FLAG_CHECKLISTS', () => {
  it('has an entry for every CaseFlagType', () => {
    const expectedTypes = [
      'deceased_estate', 'divorce', 'mop_not_met', 'eip_restriction',
      'pr_quota', 'bank_loan', 'court_order', 'other',
    ];
    for (const type of expectedTypes) {
      expect(CASE_FLAG_CHECKLISTS[type as keyof typeof CASE_FLAG_CHECKLISTS]).toBeDefined();
      expect(CASE_FLAG_CHECKLISTS[type as keyof typeof CASE_FLAG_CHECKLISTS].length).toBeGreaterThan(0);
    }
  });

  it('mop_not_met checklist mentions MOP date', () => {
    expect(CASE_FLAG_CHECKLISTS.mop_not_met.some(item => item.includes('MOP'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --testPathPattern="case-flag.types"
```

Expected: FAIL with "Cannot find module '../case-flag.types'"

- [ ] **Step 3: Create `src/domains/seller/case-flag.types.ts`**

```typescript
// src/domains/seller/case-flag.types.ts
import type { CaseFlagType, CaseFlagStatus } from '@prisma/client';

export type { CaseFlagType, CaseFlagStatus };

// Note: enum values match the Prisma schema (eip_restriction, pr_quota).
// The spec uses different names (eip_spr_quota, pr_seller) — schema takes precedence.
export const CASE_FLAG_CHECKLISTS: Record<CaseFlagType, string[]> = {
  deceased_estate: [
    'Obtain Grant of Probate or Letters of Administration',
    'Confirm executor/administrator has authority to sell',
    'Check if all beneficiaries consent to the sale',
    'Engage solicitor for estate conveyancing',
    'HDB approval required for estate sale',
  ],
  divorce: [
    'Obtain court order or decree absolute',
    'Confirm asset division agreement covers the HDB flat',
    'Check if co-owner (ex-spouse) signature is required',
    'Verify MOP status for both parties',
    'Engage solicitor if court order involves property transfer',
  ],
  mop_not_met: [
    'Verify MOP date from HDB My Flat Info portal',
    'Listing can only proceed after MOP date has passed',
    'Any disposal before MOP requires explicit HDB approval',
    'Contact HDB if hardship exemption is being considered',
  ],
  eip_restriction: [
    'Check ethnic integration policy limits for this block on HDB resale portal',
    'Verify buyer eligibility against current EIP/SPR quota before accepting offer',
    'Inform all prospective buyers of quota restrictions upfront',
  ],
  pr_quota: [
    'PRs may only own one HDB flat at a time — confirm no concurrent purchase',
    'Different resale levy rules apply — verify applicable amount with HDB',
    'Confirm PR seller eligibility via HDB My Flat Info portal',
  ],
  bank_loan: [
    'Obtain redemption statement from bank with exact outstanding amount',
    'Factor loan redemption amount into financial calculation',
    'Legal fees for loan redemption apply at completion',
    'Coordinate loan redemption timing with solicitor and completion date',
  ],
  court_order: [
    'Obtain certified true copy of court order',
    'Confirm court order explicitly covers authority to sell the HDB flat',
    'Check if any caveat is registered against the property',
    'Engage solicitor experienced in court-ordered property sales',
  ],
  other: [
    'Document the specific circumstance clearly in the description field',
    'Seek appropriate professional or legal advice',
    'Confirm all parties have legal authority to proceed',
  ],
};

export interface CreateCaseFlagInput {
  sellerId: string;
  flagType: CaseFlagType;
  description: string;
  agentId: string;
}

export interface UpdateCaseFlagInput {
  flagId: string;
  status: CaseFlagStatus;
  guidanceProvided?: string;
  agentId: string;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- --testPathPattern="case-flag.types"
```

Expected: PASS

- [ ] **Step 5: Add `caseFlag` factory to `tests/fixtures/factory.ts`**

Find the block where other factories are defined (e.g., after the `transaction` factory). Add:

```typescript
export async function caseFlag(
  overrides: Partial<{
    id: string;
    sellerId: string;
    flagType: import('@prisma/client').CaseFlagType;
    description: string;
    status: import('@prisma/client').CaseFlagStatus;
    guidanceProvided: string | null;
    resolvedAt: Date | null;
  }> = {},
) {
  const sellerRecord = overrides.sellerId
    ? await testPrisma.seller.findUniqueOrThrow({ where: { id: overrides.sellerId } })
    : await seller();

  return testPrisma.caseFlag.create({
    data: {
      id: overrides.id ?? createId(),
      sellerId: sellerRecord.id,
      flagType: overrides.flagType ?? 'other',
      description: overrides.description ?? 'Test case flag',
      status: overrides.status ?? 'identified',
      guidanceProvided: overrides.guidanceProvided ?? null,
      resolvedAt: overrides.resolvedAt ?? null,
    },
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/domains/seller/case-flag.types.ts \
        src/domains/seller/__tests__/case-flag.types.test.ts \
        tests/fixtures/factory.ts
git commit -m "feat(case-flags): add types, checklist templates, and test factory"
```

---

### Task 2: Case Flag Repository

**Files:**
- Create: `src/domains/seller/case-flag.repository.ts`
- Create: `src/domains/seller/__tests__/case-flag.repository.test.ts`

- [ ] **Step 1: Write the failing repository tests**

Create `src/domains/seller/__tests__/case-flag.repository.test.ts`:

```typescript
import { jest } from '@jest/globals';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    caseFlag: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

import { prisma } from '@/infra/database/prisma';
import * as repo from '../case-flag.repository';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('case-flag.repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('creates a case flag record', async () => {
      const data = { id: 'flag-1', sellerId: 's-1', flagType: 'other' as const, description: 'test' };
      (mockPrisma.caseFlag.create as jest.Mock).mockResolvedValue({ ...data, status: 'identified' });
      const result = await repo.create(data);
      expect(mockPrisma.caseFlag.create).toHaveBeenCalledWith({ data });
      expect(result).toMatchObject({ id: 'flag-1', status: 'identified' });
    });
  });

  describe('updateStatus', () => {
    it('sets resolvedAt when status is resolved', async () => {
      (mockPrisma.caseFlag.update as jest.Mock).mockResolvedValue({ id: 'flag-1', status: 'resolved' });
      await repo.updateStatus('flag-1', 'resolved');
      const call = (mockPrisma.caseFlag.update as jest.Mock).mock.calls[0][0] as { data: { resolvedAt?: Date } };
      expect(call.data.resolvedAt).toBeInstanceOf(Date);
    });

    it('does not set resolvedAt for in_progress status', async () => {
      (mockPrisma.caseFlag.update as jest.Mock).mockResolvedValue({ id: 'flag-1', status: 'in_progress' });
      await repo.updateStatus('flag-1', 'in_progress');
      const call = (mockPrisma.caseFlag.update as jest.Mock).mock.calls[0][0] as { data: { resolvedAt?: unknown } };
      expect(call.data.resolvedAt).toBeUndefined();
    });
  });

  describe('findActiveMopFlag', () => {
    it('queries for active mop_not_met flags only', async () => {
      (mockPrisma.caseFlag.findFirst as jest.Mock).mockResolvedValue(null);
      await repo.findActiveMopFlag('seller-1');
      expect(mockPrisma.caseFlag.findFirst).toHaveBeenCalledWith({
        where: {
          sellerId: 'seller-1',
          flagType: 'mop_not_met',
          status: { in: ['identified', 'in_progress'] },
        },
      });
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --testPathPattern="case-flag.repository"
```

Expected: FAIL with "Cannot find module '../case-flag.repository'"

- [ ] **Step 3: Create `src/domains/seller/case-flag.repository.ts`**

```typescript
// src/domains/seller/case-flag.repository.ts
import { prisma } from '@/infra/database/prisma';
import type { CaseFlagType, CaseFlagStatus } from '@prisma/client';

export async function create(data: {
  id: string;
  sellerId: string;
  flagType: CaseFlagType;
  description: string;
}) {
  return prisma.caseFlag.create({ data });
}

export async function updateStatus(
  id: string,
  status: CaseFlagStatus,
  guidanceProvided?: string,
) {
  const isTerminal = status === 'resolved' || status === 'out_of_scope';
  return prisma.caseFlag.update({
    where: { id },
    data: {
      status,
      guidanceProvided: guidanceProvided ?? undefined,
      resolvedAt: isTerminal ? new Date() : undefined,
    },
  });
}

export async function findById(id: string) {
  return prisma.caseFlag.findUnique({ where: { id } });
}

export async function findBySellerId(sellerId: string) {
  return prisma.caseFlag.findMany({
    where: { sellerId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findActiveMopFlag(sellerId: string) {
  return prisma.caseFlag.findFirst({
    where: {
      sellerId,
      flagType: 'mop_not_met',
      status: { in: ['identified', 'in_progress'] },
    },
  });
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- --testPathPattern="case-flag.repository"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/seller/case-flag.repository.ts \
        src/domains/seller/__tests__/case-flag.repository.test.ts
git commit -m "feat(case-flags): add repository layer"
```

---

### Task 3: Case Flag Service

**Files:**
- Create: `src/domains/seller/case-flag.service.ts`
- Create: `src/domains/seller/__tests__/case-flag.service.test.ts`

- [ ] **Step 1: Write the failing service tests**

Create `src/domains/seller/__tests__/case-flag.service.test.ts`:

```typescript
import { jest } from '@jest/globals';

const mockCaseFlagRepo = {
  create: jest.fn(),
  updateStatus: jest.fn(),
  findById: jest.fn(),
  findBySellerId: jest.fn(),
  findActiveMopFlag: jest.fn(),
};
const mockSellerRepo = { findById: jest.fn() };
const mockAuditService = { log: jest.fn() };

jest.mock('../case-flag.repository', () => mockCaseFlagRepo);
jest.mock('../seller.repository', () => mockSellerRepo);
jest.mock('@/domains/shared/audit.service', () => mockAuditService);
jest.mock('@paralleldrive/cuid2', () => ({ createId: () => 'test-id' }));

import * as service from '../case-flag.service';
import { NotFoundError } from '@/domains/shared/errors';

describe('case-flag.service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createCaseFlag', () => {
    it('creates a flag and writes audit log', async () => {
      mockSellerRepo.findById.mockResolvedValue({ id: 'seller-1' });
      mockCaseFlagRepo.create.mockResolvedValue({ id: 'test-id', flagType: 'other' });

      const result = await service.createCaseFlag({
        sellerId: 'seller-1',
        flagType: 'other',
        description: 'Test',
        agentId: 'agent-1',
      });

      expect(mockCaseFlagRepo.create).toHaveBeenCalledWith({
        id: 'test-id',
        sellerId: 'seller-1',
        flagType: 'other',
        description: 'Test',
      });
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'case_flag.created', entityId: 'test-id' }),
      );
      expect(result).toMatchObject({ id: 'test-id' });
    });

    it('throws NotFoundError if seller does not exist', async () => {
      mockSellerRepo.findById.mockResolvedValue(null);
      await expect(
        service.createCaseFlag({ sellerId: 'bad-id', flagType: 'other', description: 'x', agentId: 'a-1' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateCaseFlag', () => {
    it('updates status and writes audit log', async () => {
      mockCaseFlagRepo.findById.mockResolvedValue({ id: 'flag-1' });
      mockCaseFlagRepo.updateStatus.mockResolvedValue({ id: 'flag-1', status: 'resolved' });

      await service.updateCaseFlag({ flagId: 'flag-1', status: 'resolved', agentId: 'agent-1' });

      expect(mockCaseFlagRepo.updateStatus).toHaveBeenCalledWith('flag-1', 'resolved', undefined);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'case_flag.updated', entityId: 'flag-1' }),
      );
    });

    it('throws NotFoundError if flag does not exist', async () => {
      mockCaseFlagRepo.findById.mockResolvedValue(null);
      await expect(
        service.updateCaseFlag({ flagId: 'bad-id', status: 'resolved', agentId: 'a-1' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getChecklistForType', () => {
    it('returns checklist items for mop_not_met', () => {
      const items = service.getChecklistForType('mop_not_met');
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((i) => i.includes('MOP'))).toBe(true);
    });
  });

  describe('hasActiveMopFlag', () => {
    it('returns true when an active mop_not_met flag exists', async () => {
      mockCaseFlagRepo.findActiveMopFlag.mockResolvedValue({ id: 'flag-1' });
      expect(await service.hasActiveMopFlag('seller-1')).toBe(true);
    });

    it('returns false when no active mop_not_met flag exists', async () => {
      mockCaseFlagRepo.findActiveMopFlag.mockResolvedValue(null);
      expect(await service.hasActiveMopFlag('seller-1')).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --testPathPattern="case-flag.service"
```

Expected: FAIL with "Cannot find module '../case-flag.service'"

- [ ] **Step 3: Create `src/domains/seller/case-flag.service.ts`**

```typescript
// src/domains/seller/case-flag.service.ts
import { createId } from '@paralleldrive/cuid2';
import * as caseFlagRepo from './case-flag.repository';
import * as sellerRepo from './seller.repository';
import * as auditService from '@/domains/shared/audit.service';
import { NotFoundError } from '@/domains/shared/errors';
import { CASE_FLAG_CHECKLISTS } from './case-flag.types';
import type { CreateCaseFlagInput, UpdateCaseFlagInput, CaseFlagType } from './case-flag.types';

export async function createCaseFlag(input: CreateCaseFlagInput) {
  const seller = await sellerRepo.findById(input.sellerId);
  if (!seller) throw new NotFoundError('Seller', input.sellerId);

  const flag = await caseFlagRepo.create({
    id: createId(),
    sellerId: input.sellerId,
    flagType: input.flagType,
    description: input.description,
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'case_flag.created',
    entityType: 'case_flag',
    entityId: flag.id,
    details: { sellerId: input.sellerId, flagType: input.flagType },
  });

  return flag;
}

export async function updateCaseFlag(input: UpdateCaseFlagInput) {
  const flag = await caseFlagRepo.findById(input.flagId);
  if (!flag) throw new NotFoundError('CaseFlag', input.flagId);

  const updated = await caseFlagRepo.updateStatus(
    input.flagId,
    input.status,
    input.guidanceProvided,
  );

  await auditService.log({
    agentId: input.agentId,
    action: 'case_flag.updated',
    entityType: 'case_flag',
    entityId: input.flagId,
    details: { newStatus: input.status },
  });

  return updated;
}

export async function getCaseFlagsForSeller(sellerId: string) {
  return caseFlagRepo.findBySellerId(sellerId);
}

export function getChecklistForType(flagType: CaseFlagType): string[] {
  return CASE_FLAG_CHECKLISTS[flagType];
}

export async function hasActiveMopFlag(sellerId: string): Promise<boolean> {
  const flag = await caseFlagRepo.findActiveMopFlag(sellerId);
  return flag !== null;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- --testPathPattern="case-flag.service"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/seller/case-flag.service.ts \
        src/domains/seller/__tests__/case-flag.service.test.ts
git commit -m "feat(case-flags): add service layer"
```

---

### Task 4: MOP Enforcement in Property Service

**Files:**
- Modify: `src/domains/property/property.types.ts`
- Modify: `src/domains/property/property.service.ts`
- Modify: `src/domains/property/__tests__/property.service.test.ts`

- [ ] **Step 1: Add `mopOverrideReason` to `CreatePropertyInput` in `property.types.ts`**

In `src/domains/property/property.types.ts`, in the `CreatePropertyInput` interface, add after `askingPrice`:

```typescript
  mopOverrideReason?: string;
```

- [ ] **Step 2: Write the failing MOP enforcement tests**

Open `src/domains/property/__tests__/property.service.test.ts`. At the top, add a mock for `case-flag.service` alongside the other mocks:

```typescript
jest.mock('@/domains/seller/case-flag.service', () => ({
  hasActiveMopFlag: jest.fn().mockResolvedValue(false),
}));
```

Then in the `describe('createProperty')` block, add these new test cases:

```typescript
it('throws ComplianceError when active mop_not_met flag exists and no override reason', async () => {
  const { hasActiveMopFlag } = jest.requireMock('@/domains/seller/case-flag.service') as {
    hasActiveMopFlag: jest.Mock;
  };
  hasActiveMopFlag.mockResolvedValueOnce(true);

  await expect(
    service.createProperty({
      sellerId: 'seller-1',
      town: 'ANG MO KIO',
      street: 'ANG MO KIO AVE 1',
      block: '123',
      flatType: '4 ROOM',
      storeyRange: '07 TO 09',
      floorAreaSqm: 92,
      flatModel: 'Improved',
      leaseCommenceDate: 1990,
    }),
  ).rejects.toThrow('MOP not yet met');
});

it('proceeds and logs MOP override audit when override reason is provided', async () => {
  const { hasActiveMopFlag } = jest.requireMock('@/domains/seller/case-flag.service') as {
    hasActiveMopFlag: jest.Mock;
  };
  hasActiveMopFlag.mockResolvedValueOnce(true);
  propertyRepo.create.mockResolvedValue({ id: 'prop-1', slug: 'ang-mo-kio-123-abc' });
  propertyRepo.createListing.mockResolvedValue({});

  await service.createProperty({
    sellerId: 'seller-1',
    town: 'ANG MO KIO',
    street: 'ANG MO KIO AVE 1',
    block: '123',
    flatType: '4 ROOM',
    storeyRange: '07 TO 09',
    floorAreaSqm: 92,
    flatModel: 'Improved',
    leaseCommenceDate: 1990,
    mopOverrideReason: 'HDB hardship exemption granted — ref HDB/2026/001',
  });

  expect(auditService.log).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'case_flag.mop_override',
      details: expect.objectContaining({
        mopOverrideReason: 'HDB hardship exemption granted — ref HDB/2026/001',
      }),
    }),
  );
});
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
npm test -- --testPathPattern="property.service"
```

Expected: FAIL (MOP tests fail; logic not yet implemented)

- [ ] **Step 4: Update `property.service.ts` with MOP enforcement**

At the top of `src/domains/property/property.service.ts`, add the import:

```typescript
import * as caseFlagService from '@/domains/seller/case-flag.service';
```

Add `ComplianceError` to the error imports (if not already present):

```typescript
import { ComplianceError, /* existing errors */ } from '@/domains/shared/errors';
```

In `createProperty()`, insert the following block immediately after `export async function createProperty(input: CreatePropertyInput) {` and before the slug generation:

```typescript
  // MOP enforcement: block listing if mop_not_met flag is active unless agent provides override reason
  const hasMopBlock = await caseFlagService.hasActiveMopFlag(input.sellerId);
  if (hasMopBlock && !input.mopOverrideReason) {
    throw new ComplianceError(
      'MOP not yet met: listing creation is blocked. Provide mopOverrideReason to override.',
    );
  }
```

After the property is created (after `await propertyRepo.createListing(property.id)`), add the MOP override audit log:

```typescript
  // Audit the MOP override if an override reason was provided
  if (hasMopBlock && input.mopOverrideReason) {
    await auditService.log({
      action: 'case_flag.mop_override',
      entityType: 'property',
      entityId: property.id,
      details: { sellerId: input.sellerId, mopOverrideReason: input.mopOverrideReason },
    });
  }
```

Note: `hasMopBlock` is already in scope from the check above. The `auditService.log` call already exists for `property.created` — add the override log as a separate call just below it.

- [ ] **Step 5: Run test — expect PASS**

```bash
npm test -- --testPathPattern="property.service"
```

Expected: all PASS including new MOP tests

- [ ] **Step 6: Commit**

```bash
git add src/domains/property/property.types.ts \
        src/domains/property/property.service.ts \
        src/domains/property/__tests__/property.service.test.ts
git commit -m "feat(case-flags): enforce MOP block in property service with override audit log"
```

---

### Task 5: Agent API Routes for Case Flags

**Files:**
- Create: `src/domains/seller/case-flag.validator.ts`
- Modify: `src/domains/agent/agent.router.ts`
- Modify: `src/domains/agent/__tests__/agent.router.test.ts`

- [ ] **Step 1: Write the failing route tests**

Open `src/domains/agent/__tests__/agent.router.test.ts`. Add a `mockCaseFlagService` to the mock setup at the top of the file:

```typescript
const mockCaseFlagService = {
  createCaseFlag: jest.fn(),
  updateCaseFlag: jest.fn(),
};
jest.mock('@/domains/seller/case-flag.service', () => mockCaseFlagService);
```

Then add a describe block for case flag routes:

```typescript
describe('POST /agent/sellers/:id/case-flags', () => {
  it('creates a case flag and returns 201', async () => {
    mockCaseFlagService.createCaseFlag.mockResolvedValue({
      id: 'flag-1',
      flagType: 'mop_not_met',
      status: 'identified',
    });

    const res = await request(app)
      .post('/agent/sellers/seller-1/case-flags')
      .set('Cookie', agentCookie)
      .send({ flagType: 'mop_not_met', description: 'MOP date is 2027-01' });

    expect(res.status).toBe(201);
    expect(res.body.flag).toMatchObject({ id: 'flag-1' });
  });

  it('returns 400 for invalid flagType', async () => {
    const res = await request(app)
      .post('/agent/sellers/seller-1/case-flags')
      .set('Cookie', agentCookie)
      .send({ flagType: 'not_a_valid_type', description: 'test' });

    expect(res.status).toBe(400);
  });
});

describe('PUT /agent/sellers/:id/case-flags/:flagId', () => {
  it('updates a case flag and returns 200', async () => {
    mockCaseFlagService.updateCaseFlag.mockResolvedValue({
      id: 'flag-1',
      status: 'in_progress',
    });

    const res = await request(app)
      .put('/agent/sellers/seller-1/case-flags/flag-1')
      .set('Cookie', agentCookie)
      .send({ status: 'in_progress', guidanceProvided: 'Waiting for probate' });

    expect(res.status).toBe(200);
    expect(res.body.flag).toMatchObject({ status: 'in_progress' });
  });

  it('returns 400 for invalid status', async () => {
    const res = await request(app)
      .put('/agent/sellers/seller-1/case-flags/flag-1')
      .set('Cookie', agentCookie)
      .send({ status: 'not_valid' });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --testPathPattern="agent.router"
```

Expected: FAIL (routes return 404)

- [ ] **Step 3: Create `src/domains/seller/case-flag.validator.ts`**

```typescript
// src/domains/seller/case-flag.validator.ts
import { body, param } from 'express-validator';

const VALID_FLAG_TYPES = [
  'deceased_estate', 'divorce', 'mop_not_met', 'eip_restriction',
  'pr_quota', 'bank_loan', 'court_order', 'other',
] as const;

const VALID_STATUSES = ['identified', 'in_progress', 'resolved', 'out_of_scope'] as const;

export const validateCreateCaseFlag = [
  param('id').isString().notEmpty().withMessage('Seller ID is required'),
  body('flagType')
    .isIn(VALID_FLAG_TYPES)
    .withMessage(`flagType must be one of: ${VALID_FLAG_TYPES.join(', ')}`),
  body('description').isString().trim().notEmpty().withMessage('Description is required'),
];

export const validateUpdateCaseFlag = [
  param('flagId').isString().notEmpty().withMessage('Flag ID is required'),
  body('status')
    .isIn(VALID_STATUSES)
    .withMessage(`status must be one of: ${VALID_STATUSES.join(', ')}`),
  body('guidanceProvided').optional().isString().trim(),
];
```

- [ ] **Step 4: Add case flag routes to `src/domains/agent/agent.router.ts`**

Add at the top of the file, with the other service/validator imports:

```typescript
import * as caseFlagService from '@/domains/seller/case-flag.service';
import {
  validateCreateCaseFlag,
  validateUpdateCaseFlag,
} from '@/domains/seller/case-flag.validator';
```

Check that `validationResult` is already imported from `express-validator`. If not, add it.

At the end of the router (before `export`), add:

```typescript
// POST /agent/sellers/:id/case-flags — agent creates case flag
agentRouter.post(
  '/agent/sellers/:id/case-flags',
  ...agentAuth,
  ...validateCreateCaseFlag,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const flag = await caseFlagService.createCaseFlag({
        sellerId: req.params.id,
        flagType: req.body.flagType,
        description: req.body.description as string,
        agentId: user.id,
      });

      res.status(201).json({ flag });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /agent/sellers/:id/case-flags/:flagId — agent updates case flag
agentRouter.put(
  '/agent/sellers/:id/case-flags/:flagId',
  ...agentAuth,
  ...validateUpdateCaseFlag,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const flag = await caseFlagService.updateCaseFlag({
        flagId: req.params.flagId,
        status: req.body.status,
        guidanceProvided: req.body.guidanceProvided as string | undefined,
        agentId: user.id,
      });

      res.status(200).json({ flag });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 5: Run test — expect PASS**

```bash
npm test -- --testPathPattern="agent.router"
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/domains/seller/case-flag.validator.ts \
        src/domains/agent/agent.router.ts \
        src/domains/agent/__tests__/agent.router.test.ts
git commit -m "feat(case-flags): add agent API routes for case flag CRUD"
```

---

### Task 6: Seller Case Flags View

**Files:**
- Modify: `src/domains/seller/seller.router.ts`
- Create: `src/views/pages/seller/case-flags.njk`
- Create: `src/views/partials/seller/case-flags-content.njk`
- Modify: `src/domains/seller/__tests__/seller.router.test.ts`

> **Architecture note:** The seller router already applies `sellerAuth` globally via `router.use()`. Do NOT add `...sellerAuth` to individual route definitions — it is redundant. Use `user.id` as the seller ID (not `user.sellerId`, which does not exist on `AuthenticatedUser`).

- [ ] **Step 1: Write the failing route test**

Open `src/domains/seller/__tests__/seller.router.test.ts`. Add at the top with other mocks:

```typescript
const mockCaseFlagService = {
  getCaseFlagsForSeller: jest.fn().mockResolvedValue([]),
  getChecklistForType: jest.fn().mockReturnValue([]),
};
jest.mock('@/domains/seller/case-flag.service', () => mockCaseFlagService);
```

Add a describe block:

```typescript
describe('GET /seller/case-flags', () => {
  it('renders case flags page for authenticated seller', async () => {
    const res = await request(app)
      .get('/seller/case-flags')
      .set('Cookie', sellerCookie);

    expect(res.status).toBe(200);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/seller/case-flags');
    expect(res.status).toBe(401);
  });

  it('returns HTMX partial when HX-Request header is set', async () => {
    const res = await request(app)
      .get('/seller/case-flags')
      .set('Cookie', sellerCookie)
      .set('HX-Request', 'true');

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --testPathPattern="seller.router"
```

Expected: FAIL (route returns 404)

- [ ] **Step 3: Add `GET /seller/case-flags` route to `seller.router.ts`**

Open `src/domains/seller/seller.router.ts`. Add the import near the top:

```typescript
import * as caseFlagService from './case-flag.service';
```

Add the route (e.g., before the referral route). Note: no `...sellerAuth` here — the router middleware already covers it:

```typescript
// GET /seller/case-flags — view case flags and guidance
sellerRouter.get(
  '/seller/case-flags',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const flags = await caseFlagService.getCaseFlagsForSeller(user.id);
      const flagsWithChecklist = flags.map((flag) => ({
        ...flag,
        checklist: caseFlagService.getChecklistForType(flag.flagType),
      }));

      if (req.headers['hx-request']) {
        return res.render('partials/seller/case-flags-content', { flags: flagsWithChecklist });
      }
      res.render('pages/seller/case-flags', { flags: flagsWithChecklist });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 4: Create `src/views/pages/seller/case-flags.njk`**

```nunjucks
{% extends "layouts/seller.njk" %}

{% block title %}{{ "Special Circumstances" | t }}{% endblock %}

{% block content %}
  <div class="max-w-3xl mx-auto">
    <h1 class="text-2xl font-semibold text-gray-900 mb-6">{{ "Special Circumstances" | t }}</h1>

    {% include "partials/seller/case-flags-content.njk" %}
  </div>
{% endblock %}
```

- [ ] **Step 5: Create `src/views/partials/seller/case-flags-content.njk`**

```nunjucks
{% if flags.length == 0 %}
  <p class="text-gray-500 text-sm">{{ "No special circumstances have been noted for your case." | t }}</p>
{% else %}
  <div class="bg-amber-50 border border-amber-200 rounded-md p-4 mb-6">
    <p class="text-amber-800 text-sm font-medium">
      {{ "Your agent has noted one or more special circumstances. Please review the guidance below." | t }}
    </p>
  </div>

  <div class="space-y-6">
    {% for flag in flags %}
      <div class="border border-gray-200 rounded-lg p-5">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-base font-semibold text-gray-900">
            {{ flag.flagType | replace("_", " ") | title }}
          </h2>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
            {% if flag.status == 'resolved' %}bg-green-100 text-green-800
            {% elif flag.status == 'out_of_scope' %}bg-gray-100 text-gray-600
            {% elif flag.status == 'in_progress' %}bg-blue-100 text-blue-800
            {% else %}bg-amber-100 text-amber-800{% endif %}">
            {{ flag.status | replace("_", " ") | title }}
          </span>
        </div>

        {% if flag.description %}
          <p class="text-sm text-gray-700 mb-4">{{ flag.description }}</p>
        {% endif %}

        {% if flag.checklist.length > 0 %}
          <h3 class="text-sm font-medium text-gray-700 mb-2">{{ "Guidance checklist:" | t }}</h3>
          <ul class="list-disc list-inside space-y-1">
            {% for item in flag.checklist %}
              <li class="text-sm text-gray-600">{{ item }}</li>
            {% endfor %}
          </ul>
        {% endif %}

        {% if flag.guidanceProvided %}
          <div class="mt-4 p-3 bg-blue-50 rounded-md">
            <p class="text-xs font-medium text-blue-700 mb-1">{{ "Agent guidance:" | t }}</p>
            <p class="text-sm text-blue-800">{{ flag.guidanceProvided }}</p>
          </div>
        {% endif %}
      </div>
    {% endfor %}
  </div>
{% endif %}
```

- [ ] **Step 6: Run test — expect PASS**

```bash
npm test -- --testPathPattern="seller.router"
```

Expected: all PASS

- [ ] **Step 7: Run full test suite**

```bash
npm test && npm run test:integration
```

Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add src/domains/seller/seller.router.ts \
        src/domains/seller/__tests__/seller.router.test.ts \
        src/views/pages/seller/case-flags.njk \
        src/views/partials/seller/case-flags-content.njk
git commit -m "feat(case-flags): add seller case flags view"
```

---

## Chunk 2: Notification Preference Settings

### Task 7: Seller Service Extensions for Settings

**Files:**
- Modify: `src/domains/seller/seller.types.ts`
- Modify: `src/domains/seller/seller.service.ts`
- Modify: `src/domains/seller/seller.repository.ts`
- Modify: `src/domains/seller/__tests__/seller.service.test.ts`
- Modify: `src/domains/seller/__tests__/seller.repository.test.ts`

> **Architecture note:** Routers must only call services — never repositories directly. The GET /seller/settings route will call `sellerService.getSellerSettings()`. The PUT route will use the return value of `updateNotificationPreference()` to avoid a second DB lookup. `user.id` is the seller ID (not `user.sellerId`).

- [ ] **Step 1: Write failing tests**

Open `src/domains/seller/__tests__/seller.service.test.ts`. Add two new describe blocks:

```typescript
describe('getSellerSettings', () => {
  it('returns notificationPreference for the seller', async () => {
    mockedSellerRepo.findById.mockResolvedValue({
      id: 'seller-1',
      notificationPreference: 'email_only',
    });

    const result = await service.getSellerSettings('seller-1');

    expect(result).toEqual({ notificationPreference: 'email_only' });
  });

  it('throws NotFoundError when seller does not exist', async () => {
    mockedSellerRepo.findById.mockResolvedValue(null);
    await expect(service.getSellerSettings('bad-id')).rejects.toThrow(NotFoundError);
  });
});

describe('updateNotificationPreference', () => {
  it('updates preference and writes audit log, returns updated seller', async () => {
    const updatedSeller = { id: 'seller-1', notificationPreference: 'email_only' };
    mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', notificationPreference: 'whatsapp_and_email' });
    mockedSellerRepo.updateNotificationPreference = jest.fn().mockResolvedValue(updatedSeller);

    const result = await service.updateNotificationPreference({
      sellerId: 'seller-1',
      preference: 'email_only',
      agentId: 'seller-1',
    });

    expect(mockedSellerRepo.updateNotificationPreference).toHaveBeenCalledWith(
      'seller-1',
      'email_only',
    );
    expect(mockedAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'seller.notification_preference_changed',
        entityId: 'seller-1',
        details: { newPreference: 'email_only' },
      }),
    );
    expect(result).toEqual(updatedSeller);
  });

  it('throws NotFoundError when seller does not exist', async () => {
    mockedSellerRepo.findById.mockResolvedValue(null);
    await expect(
      service.updateNotificationPreference({ sellerId: 'bad-id', preference: 'email_only', agentId: 'x' }),
    ).rejects.toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --testPathPattern="seller.service"
```

Expected: FAIL (functions not found)

- [ ] **Step 3: Add `UpdateNotificationPreferenceInput` and `SellerSettings` to `seller.types.ts`**

Open `src/domains/seller/seller.types.ts`. Add:

```typescript
export interface SellerSettings {
  notificationPreference: 'whatsapp_and_email' | 'email_only';
}

export interface UpdateNotificationPreferenceInput {
  sellerId: string;
  preference: 'whatsapp_and_email' | 'email_only';
  agentId: string;
}
```

- [ ] **Step 4: Add `updateNotificationPreference` to `seller.repository.ts`**

Append to `src/domains/seller/seller.repository.ts`:

```typescript
export async function updateNotificationPreference(
  id: string,
  preference: 'whatsapp_and_email' | 'email_only',
) {
  return prisma.seller.update({
    where: { id },
    data: { notificationPreference: preference },
  });
}
```

- [ ] **Step 5: Add `getSellerSettings` and `updateNotificationPreference` to `seller.service.ts`**

Open `src/domains/seller/seller.service.ts`. Ensure `SellerSettings` and `UpdateNotificationPreferenceInput` are imported from `./seller.types`. Ensure `NotFoundError` is imported from `@/domains/shared/errors`.

Add:

```typescript
export async function getSellerSettings(sellerId: string): Promise<SellerSettings> {
  const seller = await sellerRepo.findById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);
  return { notificationPreference: seller.notificationPreference };
}

export async function updateNotificationPreference(input: UpdateNotificationPreferenceInput) {
  const seller = await sellerRepo.findById(input.sellerId);
  if (!seller) throw new NotFoundError('Seller', input.sellerId);

  const updated = await sellerRepo.updateNotificationPreference(input.sellerId, input.preference);

  await auditService.log({
    agentId: input.agentId,
    action: 'seller.notification_preference_changed',
    entityType: 'seller',
    entityId: input.sellerId,
    details: { newPreference: input.preference },
  });

  return updated;
}
```

- [ ] **Step 6: Run test — expect PASS**

```bash
npm test -- --testPathPattern="seller.service"
```

Expected: all PASS

- [ ] **Step 7: Add repository test for `updateNotificationPreference`**

Open `src/domains/seller/__tests__/seller.repository.test.ts`. Add:

```typescript
describe('updateNotificationPreference', () => {
  it('calls prisma.seller.update with the preference', async () => {
    prisma.seller.update.mockResolvedValue({
      id: 'seller-1',
      notificationPreference: 'email_only',
    });

    await repo.updateNotificationPreference('seller-1', 'email_only');

    expect(prisma.seller.update).toHaveBeenCalledWith({
      where: { id: 'seller-1' },
      data: { notificationPreference: 'email_only' },
    });
  });
});
```

- [ ] **Step 8: Run tests — expect PASS**

```bash
npm test -- --testPathPattern="seller.repository|seller.service"
```

Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add src/domains/seller/seller.types.ts \
        src/domains/seller/seller.repository.ts \
        src/domains/seller/seller.service.ts \
        src/domains/seller/__tests__/seller.service.test.ts \
        src/domains/seller/__tests__/seller.repository.test.ts
git commit -m "feat(settings): add getSellerSettings and updateNotificationPreference to seller service"
```

---

### Task 8: Seller Settings Routes + Templates

**Files:**
- Modify: `src/domains/seller/seller.router.ts`
- Create: `src/views/pages/seller/settings.njk`
- Create: `src/views/partials/seller/settings-notifications.njk`
- Modify: `src/domains/seller/__tests__/seller.router.test.ts`

> **Architecture note:** The seller layout sidebar already links to `/seller/settings`. No sidebar changes needed.

- [ ] **Step 1: Write failing route tests**

Open `src/domains/seller/__tests__/seller.router.test.ts`. Add at the top with other mocks:

```typescript
// In the existing mockedSellerService mock object, add:
// getSellerSettings: jest.fn().mockResolvedValue({ notificationPreference: 'whatsapp_and_email' }),
// updateNotificationPreference: jest.fn(),
```

Add describe blocks:

```typescript
describe('GET /seller/settings', () => {
  it('renders settings page for authenticated seller', async () => {
    mockedSellerService.getSellerSettings = jest
      .fn()
      .mockResolvedValue({ notificationPreference: 'whatsapp_and_email' });

    const res = await request(app)
      .get('/seller/settings')
      .set('Cookie', sellerCookie);

    expect(res.status).toBe(200);
  });
});

describe('PUT /seller/settings/notifications', () => {
  it('updates preference and returns 200 with HTMX partial', async () => {
    mockedSellerService.updateNotificationPreference = jest
      .fn()
      .mockResolvedValue({ id: 'seller-1', notificationPreference: 'email_only' });

    const res = await request(app)
      .put('/seller/settings/notifications')
      .set('Cookie', sellerCookie)
      .set('HX-Request', 'true')
      .send({ preference: 'email_only' });

    expect(res.status).toBe(200);
    expect(mockedSellerService.updateNotificationPreference).toHaveBeenCalledWith(
      expect.objectContaining({ preference: 'email_only' }),
    );
  });

  it('returns 400 for invalid preference value', async () => {
    const res = await request(app)
      .put('/seller/settings/notifications')
      .set('Cookie', sellerCookie)
      .send({ preference: 'invalid_value' });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --testPathPattern="seller.router"
```

Expected: FAIL (routes return 404)

- [ ] **Step 3: Add settings routes to `seller.router.ts`**

Ensure `sellerService` is imported. Most routes in `seller.router.ts` call `sellerService.*` functions. Add the import if not already present:

```typescript
import * as sellerService from './seller.service';
```

Also ensure `body` and `validationResult` are imported from `express-validator`:

```typescript
import { body, validationResult } from 'express-validator';
```

Add the routes (no `...sellerAuth` needed — already applied by the router middleware):

```typescript
// GET /seller/settings — settings page
sellerRouter.get(
  '/seller/settings',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const settings = await sellerService.getSellerSettings(user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/settings-notifications', { settings });
      }
      res.render('pages/seller/settings', { settings });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /seller/settings/notifications — update notification preference
const validateNotificationPreference = [
  body('preference')
    .isIn(['whatsapp_and_email', 'email_only'])
    .withMessage('preference must be whatsapp_and_email or email_only'),
];

sellerRouter.put(
  '/seller/settings/notifications',
  ...validateNotificationPreference,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const updated = await sellerService.updateNotificationPreference({
        sellerId: user.id,
        preference: req.body.preference as 'whatsapp_and_email' | 'email_only',
        agentId: user.id, // seller is making this change themselves
      });

      const settings = { notificationPreference: updated.notificationPreference };

      if (req.headers['hx-request']) {
        return res.render('partials/seller/settings-notifications', {
          settings,
          successMessage: true,
        });
      }
      res.redirect('/seller/settings');
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 4: Create `src/views/pages/seller/settings.njk`**

```nunjucks
{% extends "layouts/seller.njk" %}

{% block title %}{{ "Settings" | t }}{% endblock %}

{% block content %}
  <div class="max-w-2xl mx-auto">
    <h1 class="text-2xl font-semibold text-gray-900 mb-6">{{ "Settings" | t }}</h1>

    <div id="settings-notifications">
      {% include "partials/seller/settings-notifications.njk" %}
    </div>
  </div>
{% endblock %}
```

- [ ] **Step 5: Create `src/views/partials/seller/settings-notifications.njk`**

```nunjucks
<div class="bg-white border border-gray-200 rounded-lg p-6">
  <h2 class="text-base font-semibold text-gray-900 mb-1">{{ "Notification preferences" | t }}</h2>
  <p class="text-sm text-gray-500 mb-4">
    {{ "Choose how you receive updates. In-app notifications are always sent." | t }}
  </p>

  {% if successMessage %}
    <div class="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
      <p class="text-sm text-green-700">{{ "Notification preference updated." | t }}</p>
    </div>
  {% endif %}

  <form hx-put="/seller/settings/notifications"
        hx-target="#settings-notifications"
        hx-swap="outerHTML">

    <fieldset class="space-y-3">
      <div class="flex items-start gap-3">
        <input type="radio"
               id="pref-whatsapp"
               name="preference"
               value="whatsapp_and_email"
               class="mt-0.5"
               {% if settings.notificationPreference == 'whatsapp_and_email' %}checked{% endif %}>
        <label for="pref-whatsapp" class="text-sm">
          <span class="font-medium text-gray-900">{{ "WhatsApp & Email" | t }}</span>
          <span class="block text-gray-500">{{ "Receive updates via WhatsApp first, with email as fallback." | t }}</span>
        </label>
      </div>

      <div class="flex items-start gap-3">
        <input type="radio"
               id="pref-email"
               name="preference"
               value="email_only"
               class="mt-0.5"
               {% if settings.notificationPreference == 'email_only' %}checked{% endif %}>
        <label for="pref-email" class="text-sm">
          <span class="font-medium text-gray-900">{{ "Email only" | t }}</span>
          <span class="block text-gray-500">{{ "Receive all notifications by email only." | t }}</span>
        </label>
      </div>
    </fieldset>

    <button type="submit"
            class="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700">
      {{ "Save preference" | t }}
    </button>
  </form>
</div>
```

- [ ] **Step 6: Run test — expect PASS**

```bash
npm test -- --testPathPattern="seller.router"
```

Expected: all PASS

- [ ] **Step 7: Run full test suite**

```bash
npm test && npm run test:integration
```

Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add src/domains/seller/seller.router.ts \
        src/domains/seller/__tests__/seller.router.test.ts \
        src/views/pages/seller/settings.njk \
        src/views/partials/seller/settings-notifications.njk
git commit -m "feat(settings): add seller notification preference settings page and routes"
```

---

## Chunk 3: Co-Broke Auto-detection + Fallen-Through Improvements

### Task 9: Co-broke Auto-detection

**Files:**
- Modify: `src/domains/offer/offer.types.ts`
- Modify: `src/domains/offer/offer.service.ts`
- Modify: `src/domains/offer/offer.router.ts`
- Modify: `src/domains/offer/offer.validator.ts`
- Modify: `src/domains/offer/__tests__/offer.service.test.ts`
- Modify: `src/domains/offer/__tests__/offer.router.test.ts`

> **Note:** `isCoBroke` must be removed from `CreateOfferInput` (it becomes auto-derived), the router body parsing, the validator, and all test call-sites. The `counterOffer` function reads `isCoBroke` from the parent offer record (DB), so it is unaffected.

- [ ] **Step 1: Write the failing tests**

Open `src/domains/offer/__tests__/offer.service.test.ts`. Find all call-sites that pass `isCoBroke` to `createOffer` and replace those with the new assertion pattern. Add two specific cases for co-broke detection:

```typescript
describe('isCoBroke auto-detection', () => {
  it('sets isCoBroke = true when buyerAgentName is provided', async () => {
    offerRepo.create.mockResolvedValue({ id: 'offer-1', isCoBroke: true });
    settingsService.getBoolean.mockResolvedValue(false);

    await service.createOffer({
      propertyId: 'prop-1',
      sellerId: 'seller-1',
      town: 'BISHAN',
      flatType: '4 ROOM',
      buyerName: 'Alice',
      buyerPhone: '91234567',
      buyerAgentName: 'Bob Agent',
      buyerAgentCeaReg: 'R001234A',
      offerAmount: 580000,
      agentId: 'agent-1',
    });

    const createCall = (offerRepo.create as jest.Mock).mock.calls[0][0] as { isCoBroke: boolean };
    expect(createCall.isCoBroke).toBe(true);
  });

  it('sets isCoBroke = false when buyerAgentName is absent', async () => {
    offerRepo.create.mockResolvedValue({ id: 'offer-1', isCoBroke: false });
    settingsService.getBoolean.mockResolvedValue(false);

    await service.createOffer({
      propertyId: 'prop-1',
      sellerId: 'seller-1',
      town: 'BISHAN',
      flatType: '4 ROOM',
      buyerName: 'Alice',
      buyerPhone: '91234567',
      offerAmount: 580000,
      agentId: 'agent-1',
    });

    const createCall = (offerRepo.create as jest.Mock).mock.calls[0][0] as { isCoBroke: boolean };
    expect(createCall.isCoBroke).toBe(false);
  });
});
```

Also find any existing `createOffer` test calls that pass `isCoBroke: false` or `isCoBroke: true` and remove that property from those calls (it's no longer in the input type).

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --testPathPattern="offer.service"
```

Expected: FAIL (TypeScript will flag `isCoBroke` removal from test calls as a type error, or runtime mismatch)

- [ ] **Step 3: Remove `isCoBroke` from `CreateOfferInput` in `offer.types.ts`**

Open `src/domains/offer/offer.types.ts`. Find `CreateOfferInput`. Remove the `isCoBroke` field if it exists there:

```typescript
// Remove this line:
isCoBroke: boolean;
```

- [ ] **Step 4: Update `createOffer` in `offer.service.ts` to auto-derive isCoBroke**

In `src/domains/offer/offer.service.ts`, in the `createOffer` call to `offerRepo.create`, change:

```typescript
isCoBroke: input.isCoBroke,
```

to:

```typescript
isCoBroke: !!input.buyerAgentName,
```

- [ ] **Step 5: Remove `isCoBroke` from the offer router**

Open `src/domains/offer/offer.router.ts`. Find the `POST` route that creates an offer. Remove the line that reads `isCoBroke` from the request body:

```typescript
// Remove this line:
isCoBroke: req.body.isCoBroke === true || req.body.isCoBroke === 'true',
```

- [ ] **Step 6: Remove `isCoBroke` from the offer validator**

Open `src/domains/offer/offer.validator.ts`. Remove the validator rule for `isCoBroke` if it exists (e.g., `body('isCoBroke').isBoolean()`).

- [ ] **Step 7: Update router test to remove isCoBroke from request bodies**

Open `src/domains/offer/__tests__/offer.router.test.ts`. Find any `createOffer` request bodies that include `isCoBroke` and remove that property.

- [ ] **Step 8: Run tests — expect PASS**

```bash
npm test -- --testPathPattern="offer"
```

Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add src/domains/offer/offer.types.ts \
        src/domains/offer/offer.service.ts \
        src/domains/offer/offer.router.ts \
        src/domains/offer/offer.validator.ts \
        src/domains/offer/__tests__/offer.service.test.ts \
        src/domains/offer/__tests__/offer.router.test.ts
git commit -m "feat(offer): auto-derive isCoBroke from buyerAgentName presence"
```

---

### Task 10: Fallen-Through Reason — Schema + Repository

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/domains/transaction/transaction.repository.ts`

- [ ] **Step 1: Add nullable `fallenThroughReason` to Transaction model in schema**

Open `prisma/schema.prisma`. Find the `Transaction` model. Add after `status`:

```prisma
  fallenThroughReason   String?           @map("fallen_through_reason")
```

- [ ] **Step 2: Run migration**

```bash
npx prisma migrate dev --name add-fallen-through-reason
```

Expected: migration created and applied successfully.

- [ ] **Step 3: Add `updateFallenThroughReason` to `transaction.repository.ts`**

Open `src/domains/transaction/transaction.repository.ts`. Add:

```typescript
export async function updateFallenThroughReason(transactionId: string, reason: string) {
  return prisma.transaction.update({
    where: { id: transactionId },
    data: { fallenThroughReason: reason },
  });
}
```

- [ ] **Step 4: Verify types compile**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma \
        prisma/migrations/ \
        src/domains/transaction/transaction.repository.ts
git commit -m "feat(transaction): add fallenThroughReason field to schema and repository"
```

---

### Task 11: Fallen-Through Service + Dedicated Route

**Files:**
- Modify: `src/domains/transaction/transaction.service.ts`
- Modify: `src/domains/transaction/transaction.validator.ts`
- Modify: `src/domains/transaction/transaction.router.ts`
- Modify: `src/domains/transaction/__tests__/transaction.service.test.ts`
- Modify: `src/domains/transaction/__tests__/transaction.router.test.ts`

> **Key design decisions:**
> - Pass `tx.sellerId` to `handleFallenThrough` as a parameter — no second DB fetch needed.
> - The audit log action is `transaction.fallen_through` for fallen-through transitions only. All other status transitions continue to log `transaction.status_changed`.
> - The generic `PATCH /agent/transactions/:id/status` validator must exclude `fallen_through` to prevent bypassing the reason requirement.

- [ ] **Step 1: Write failing service tests**

Open `src/domains/transaction/__tests__/transaction.service.test.ts`. Add a describe block:

```typescript
describe('advanceTransactionStatus — fallen_through with reason', () => {
  const baseTx = {
    id: 'tx-1',
    status: 'option_issued',
    propertyId: 'prop-1',
    sellerId: 'seller-1',
  };

  beforeEach(() => {
    txRepo.findById.mockResolvedValue(baseTx);
    txRepo.updateTransactionStatus.mockResolvedValue({ ...baseTx, status: 'fallen_through' });
    txRepo.updateFallenThroughReason = jest.fn().mockResolvedValue({});
    txRepo.findOtpByTransactionId.mockResolvedValue(null);
    portalService.expirePortalListings = jest.fn().mockResolvedValue(undefined);
    viewingService.cancelSlotsForPropertyCascade = jest.fn().mockResolvedValue(undefined);
    propertyService.revertPropertyToDraft = jest.fn().mockResolvedValue(undefined);
  });

  it('stores the reason on the transaction', async () => {
    await service.advanceTransactionStatus({
      transactionId: 'tx-1',
      status: 'fallen_through',
      agentId: 'agent-1',
      reason: 'Buyer financing fell through',
    });

    expect(txRepo.updateFallenThroughReason).toHaveBeenCalledWith(
      'tx-1',
      'Buyer financing fell through',
    );
  });

  it('notifies seller with reason', async () => {
    await service.advanceTransactionStatus({
      transactionId: 'tx-1',
      status: 'fallen_through',
      agentId: 'agent-1',
      reason: 'Deal did not proceed',
    });

    const sellerCall = (notificationService.send as jest.Mock).mock.calls.find(
      (c) => (c[0] as { recipientType: string }).recipientType === 'seller',
    );
    expect(sellerCall).toBeDefined();
    expect(
      (sellerCall![0] as { templateData: { reason: string } }).templateData.reason,
    ).toBe('Deal did not proceed');
  });

  it('logs transaction.fallen_through action', async () => {
    await service.advanceTransactionStatus({
      transactionId: 'tx-1',
      status: 'fallen_through',
      agentId: 'agent-1',
      reason: 'Buyer withdrew offer',
    });

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transaction.fallen_through' }),
    );
  });
});

describe('advanceTransactionStatus — non-fallen_through still logs transaction.status_changed', () => {
  it('logs transaction.status_changed for normal status advance', async () => {
    txRepo.findById.mockResolvedValue({ id: 'tx-1', status: 'option_issued', propertyId: 'prop-1', sellerId: 'seller-1' });
    txRepo.updateTransactionStatus.mockResolvedValue({ id: 'tx-1', status: 'option_exercised' });

    await service.advanceTransactionStatus({
      transactionId: 'tx-1',
      status: 'option_exercised',
      agentId: 'agent-1',
    });

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transaction.status_changed' }),
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --testPathPattern="transaction.service"
```

Expected: FAIL (reason not stored, seller not notified, audit action wrong)

- [ ] **Step 3: Update `advanceTransactionStatus` signature to accept optional `reason`**

In `src/domains/transaction/transaction.service.ts`, change the input type of `advanceTransactionStatus`:

```typescript
export async function advanceTransactionStatus(input: {
  transactionId: string;
  status: 'option_exercised' | 'completing' | 'completed' | 'fallen_through';
  agentId: string;
  reason?: string;
}) {
```

- [ ] **Step 4: Pass `tx.sellerId` and `reason` to `handleFallenThrough`**

In `advanceTransactionStatus`, find:

```typescript
  if (input.status === 'fallen_through') {
    await handleFallenThrough(tx.propertyId, input.transactionId, input.agentId);
  }
```

Change to:

```typescript
  if (input.status === 'fallen_through') {
    await handleFallenThrough(tx.propertyId, input.transactionId, input.agentId, tx.sellerId, input.reason ?? '');
  }
```

Note: `tx` is the transaction object fetched at the start of the function and has `sellerId` as a scalar column.

- [ ] **Step 5: Update `handleFallenThrough` to accept sellerId and reason, store reason, notify seller, fix audit**

Change the function signature from:

```typescript
async function handleFallenThrough(propertyId: string, transactionId: string, agentId: string) {
```

to:

```typescript
async function handleFallenThrough(
  propertyId: string,
  transactionId: string,
  agentId: string,
  sellerId: string,
  reason: string,
) {
```

Inside the function, after step 1 (Expire active OTP), add:

```typescript
  // 2. Store fallen-through reason
  await txRepo.updateFallenThroughReason(transactionId, reason);
```

Before the existing agent notification (which becomes step 6), add:

```typescript
  // 5. Notify seller with reason
  await notificationService.send(
    {
      recipientType: 'seller',
      recipientId: sellerId,
      templateName: 'transaction_update',
      templateData: {
        address: propertyId,
        status: 'fallen_through',
        reason,
      },
    },
    agentId,
  );
```

- [ ] **Step 6: Fix the audit log action to be conditional**

In `advanceTransactionStatus`, find the `auditService.log` call at the end and change it to:

```typescript
  await auditService.log({
    agentId: input.agentId,
    action: input.status === 'fallen_through' ? 'transaction.fallen_through' : 'transaction.status_changed',
    entityType: 'transaction',
    entityId: input.transactionId,
    details: input.status === 'fallen_through'
      ? { reason: input.reason ?? '' }
      : { newStatus: input.status },
  });
```

- [ ] **Step 7: Run test — expect PASS**

```bash
npm test -- --testPathPattern="transaction.service"
```

Expected: all PASS

- [ ] **Step 8: Block `fallen_through` on the generic status route validator**

Open `src/domains/transaction/transaction.validator.ts`. Find `validateAdvanceStatus`. It currently includes `fallen_through` in the `isIn` list. Remove it:

Change:
```typescript
.isIn(['option_exercised', 'completing', 'completed', 'fallen_through'])
```
to:
```typescript
.isIn(['option_exercised', 'completing', 'completed'])
.withMessage("Use POST /agent/transactions/:id/fallen-through to mark a transaction as fallen through")
```

- [ ] **Step 9: Add validator for the dedicated fallen-through route**

In `src/domains/transaction/transaction.validator.ts`, add:

```typescript
export const validateMarkFallenThrough = [
  body('reason')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Reason is required when marking a transaction as fallen through'),
];
```

Ensure `body` is imported from `express-validator` at the top of the file.

- [ ] **Step 10: Write failing router tests**

Open `src/domains/transaction/__tests__/transaction.router.test.ts`. Add:

```typescript
describe('POST /agent/transactions/:id/fallen-through', () => {
  it('marks transaction fallen through with reason and returns 200', async () => {
    txService.advanceTransactionStatus.mockResolvedValue({
      id: 'tx-1',
      status: 'fallen_through',
    });

    const res = await request(app)
      .post('/agent/transactions/tx-1/fallen-through')
      .set('Cookie', agentCookie)
      .send({ reason: 'Buyer financing fell through' });

    expect(res.status).toBe(200);
    expect(txService.advanceTransactionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'tx-1',
        status: 'fallen_through',
        reason: 'Buyer financing fell through',
      }),
    );
  });

  it('returns 400 when reason is missing', async () => {
    const res = await request(app)
      .post('/agent/transactions/tx-1/fallen-through')
      .set('Cookie', agentCookie)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('PATCH /agent/transactions/:id/status — fallen_through blocked', () => {
  it('returns 400 when attempting to set status to fallen_through via generic route', async () => {
    const res = await request(app)
      .patch('/agent/transactions/tx-1/status')
      .set('Cookie', agentCookie)
      .send({ status: 'fallen_through' });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 11: Run test — expect FAIL**

```bash
npm test -- --testPathPattern="transaction.router"
```

Expected: FAIL (dedicated route returns 404; generic route test may vary)

- [ ] **Step 12: Add dedicated fallen-through route to `transaction.router.ts`**

Open `src/domains/transaction/transaction.router.ts`. Add to the validator imports:

```typescript
import {
  validateCreateTransaction,
  validateAdvanceStatus,
  validateCreateOtp,
  validateUploadInvoice,
  validateUpdateHdb,
  validateSendInvoice,
  validateMarkFallenThrough,    // add this
} from './transaction.validator';
```

Add the route at the end of the router:

```typescript
// POST /agent/transactions/:id/fallen-through — dedicated fallen-through endpoint (requires reason)
transactionRouter.post(
  '/agent/transactions/:id/fallen-through',
  ...agentAuth,
  ...validateMarkFallenThrough,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const tx = await txService.advanceTransactionStatus({
        transactionId: req.params.id,
        status: 'fallen_through',
        agentId: user.id,
        reason: req.body.reason as string,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/transaction-status', { tx });
      }
      res.status(200).json({ tx });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 13: Run test — expect PASS**

```bash
npm test -- --testPathPattern="transaction.router"
```

Expected: all PASS

- [ ] **Step 14: Run full test suite**

```bash
npm test && npm run test:integration
```

Expected: all PASS

- [ ] **Step 15: Commit**

```bash
git add src/domains/transaction/transaction.service.ts \
        src/domains/transaction/transaction.validator.ts \
        src/domains/transaction/transaction.router.ts \
        src/domains/transaction/__tests__/transaction.service.test.ts \
        src/domains/transaction/__tests__/transaction.router.test.ts
git commit -m "feat(transaction): fallen-through reason, seller notification, dedicated route, block generic route"
```

---

## Final Verification

- [ ] **Run complete test suite**

```bash
npm test && npm run test:integration
```

Expected: all tests PASS

- [ ] **Check for TypeScript errors**

```bash
npm run build
```

Expected: no errors

- [ ] **Run linter**

```bash
npm run lint
```

Expected: no errors

- [ ] **Final commit if any lint fixes applied**

```bash
git add -A
git commit -m "chore: fix lint warnings after phase-2e implementation"
```
