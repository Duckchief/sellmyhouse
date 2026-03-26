# Phase 2A: Seller Dashboard Shell + Onboarding Wizard — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the seller dashboard shell (sidebar nav, overview, placeholder pages) and 5-step HTMX onboarding wizard so sellers can log in and complete onboarding.

**Architecture:** New `src/domains/seller/` domain module following the project's standard pattern (types → repository → service → validator → router). Onboarding wizard is a single page with HTMX-loaded steps. Dashboard pages render full pages or HTMX fragments based on `hx-request` header. Seller layout sidebar provides navigation to all dashboard sections.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Tailwind CSS, Jest, Supertest

**Spec:** `docs/superpowers/specs/2026-03-10-phase-2-seller-dashboard-design.md` (Sub-project 2A section)

---

## Chunk 1: Database Migration + Seller Domain Foundation

### Task 1: Add onboardingStep field to Seller model + update factory

**Files:**
- Modify: `prisma/schema.prisma` (Seller model)
- Modify: `tests/fixtures/factory.ts` (add onboardingStep override support)

- [ ] **Step 1: Add onboardingStep to Seller model in Prisma schema**

In `prisma/schema.prisma`, add to the Seller model after the `leadSource` field:

```prisma
onboardingStep    Int      @default(0)  @map("onboarding_step")
```

- [ ] **Step 2: Generate and run migration**

Run:
```bash
npx prisma migrate dev --name add-seller-onboarding-step
```

Expected: Migration created and applied successfully.

- [ ] **Step 3: Verify migration**

Run:
```bash
npx prisma migrate status
```

Expected: All migrations applied, no pending.

- [ ] **Step 4: Update factory to support onboardingStep**

In `tests/fixtures/factory.ts`, add `onboardingStep` to the seller factory's overrides type and pass it through to `prisma.seller.create`:

```typescript
// In the seller factory overrides interface, add:
onboardingStep?: number;

// In the create call, add to data:
onboardingStep: overrides?.onboardingStep ?? 0,
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ tests/fixtures/factory.ts
git commit -m "feat(seller): add onboardingStep field to Seller model"
```

---

### Task 2: Create seller domain types

**Files:**
- Create: `src/domains/seller/seller.types.ts`

- [ ] **Step 1: Create the seller types file**

```typescript
import type { Seller, ConsentRecord } from '@prisma/client';

// Onboarding step constants
export const ONBOARDING_STEPS = {
  NOT_STARTED: 0,
  WELCOME: 1,
  PROPERTY_DETAILS: 2,
  FINANCIAL_SITUATION: 3,
  PHOTOS: 4,
  AGREEMENT: 5,
} as const;

export const TOTAL_ONBOARDING_STEPS = 5;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[keyof typeof ONBOARDING_STEPS];

export interface OnboardingStatus {
  currentStep: number;
  isComplete: boolean;
  completedSteps: number[];
}

export interface DashboardOverview {
  seller: Pick<Seller, 'id' | 'name' | 'email' | 'phone' | 'status' | 'onboardingStep'>;
  onboarding: OnboardingStatus;
  propertyStatus: string | null;
  transactionStatus: string | null;
  unreadNotificationCount: number;
  nextSteps: NextStep[];
}

export interface NextStep {
  label: string;
  description: string;
  href: string;
  priority: number;
}

export interface SellerMyData {
  personalInfo: {
    name: string;
    email: string | null;
    phone: string;
  };
  consentStatus: {
    service: boolean;
    marketing: boolean;
    consentTimestamp: Date | null;
    withdrawnAt: Date | null;
  };
  consentHistory: Pick<ConsentRecord, 'id' | 'purposeService' | 'purposeMarketing' | 'consentGivenAt' | 'consentWithdrawnAt'>[];
  dataActions: {
    canRequestCorrection: boolean;
    canRequestDeletion: boolean;
    canWithdrawConsent: boolean;
  };
}

export interface DocumentChecklistItem {
  id: string;
  label: string;
  description: string;
  required: boolean;
  status: 'not_uploaded' | 'uploaded' | 'verified';
  applicableStages: string[];
}

export interface TimelineMilestone {
  label: string;
  status: 'completed' | 'current' | 'upcoming';
  date: Date | null;
  description: string;
}

export interface CompleteOnboardingStepInput {
  sellerId: string;
  step: number;
  data?: Record<string, unknown>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/seller/seller.types.ts
git commit -m "feat(seller): add seller domain types for dashboard and onboarding"
```

---

### Task 3: Add countUnreadForRecipient to notification repository

**Files:**
- Modify: `src/domains/notification/notification.repository.ts`
- Modify: `src/domains/notification/__tests__/notification.repository.test.ts`

This function is needed by the seller service (Task 5). Adding it as its own TDD task.

- [ ] **Step 1: Write failing test**

Add to `src/domains/notification/__tests__/notification.repository.test.ts`:

```typescript
// Add 'count' to the jest.mock prisma.notification object:
// count: jest.fn(),

it('countUnreadForRecipient returns count of unread in-app notifications', async () => {
  prisma.notification.count.mockResolvedValue(3);

  const result = await repo.countUnreadForRecipient('seller', 's1');

  expect(result).toBe(3);
  expect(prisma.notification.count).toHaveBeenCalledWith({
    where: {
      recipientType: 'seller',
      recipientId: 's1',
      status: { not: 'read' },
      channel: 'in_app',
    },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/domains/notification/__tests__/notification.repository.test.ts --no-coverage`

Expected: FAIL — `countUnreadForRecipient` is not a function.

- [ ] **Step 3: Implement countUnreadForRecipient**

Add to `src/domains/notification/notification.repository.ts`:

```typescript
export async function countUnreadForRecipient(
  recipientType: 'seller' | 'agent',
  recipientId: string,
): Promise<number> {
  return prisma.notification.count({
    where: {
      recipientType,
      recipientId,
      status: { not: 'read' },
      channel: 'in_app',
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/domains/notification/__tests__/notification.repository.test.ts --no-coverage`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/notification/notification.repository.ts src/domains/notification/__tests__/notification.repository.test.ts
git commit -m "feat(notification): add countUnreadForRecipient to repository"
```

---

### Task 4: Create seller repository

**Files:**
- Create: `src/domains/seller/seller.repository.ts`
- Create: `src/domains/seller/__tests__/seller.repository.test.ts`

- [ ] **Step 1: Write failing test for repository**

Create `src/domains/seller/__tests__/seller.repository.test.ts`:

```typescript
import * as sellerRepo from '../seller.repository';

jest.mock('../../../infra/database/prisma', () => ({
  prisma: {
    seller: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    consentRecord: {
      findMany: jest.fn(),
    },
    videoTutorial: {
      findMany: jest.fn(),
    },
  },
  createId: jest.fn().mockReturnValue('test-seller-id'),
}));

const { prisma } = jest.requireMock('../../../infra/database/prisma');

describe('seller.repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('findById', () => {
    it('returns seller when found', async () => {
      const mockSeller = {
        id: 'seller-1',
        name: 'Test Seller',
        email: 'test@test.local',
        phone: '91234567',
        onboardingStep: 0,
        status: 'lead',
      };
      prisma.seller.findUnique.mockResolvedValue(mockSeller);

      const result = await sellerRepo.findById('seller-1');

      expect(result).toEqual(mockSeller);
      expect(prisma.seller.findUnique).toHaveBeenCalledWith({
        where: { id: 'seller-1' },
      });
    });

    it('returns null when not found', async () => {
      prisma.seller.findUnique.mockResolvedValue(null);

      const result = await sellerRepo.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('updateOnboardingStep', () => {
    it('updates the onboarding step', async () => {
      const updated = { id: 'seller-1', onboardingStep: 2 };
      prisma.seller.update.mockResolvedValue(updated);

      const result = await sellerRepo.updateOnboardingStep('seller-1', 2);

      expect(result).toEqual(updated);
      expect(prisma.seller.update).toHaveBeenCalledWith({
        where: { id: 'seller-1' },
        data: { onboardingStep: 2 },
      });
    });
  });

  describe('getSellerWithRelations', () => {
    it('includes properties, transactions, consent records, and case flags', async () => {
      const mockSeller = {
        id: 'seller-1',
        name: 'Test',
        properties: [{ id: 'prop-1', status: 'draft' }],
        transactions: [],
        consentRecords: [],
        caseFlags: [],
      };
      prisma.seller.findUnique.mockResolvedValue(mockSeller);

      const result = await sellerRepo.getSellerWithRelations('seller-1');

      expect(result).toEqual(mockSeller);
      expect(prisma.seller.findUnique).toHaveBeenCalledWith({
        where: { id: 'seller-1' },
        include: {
          properties: true,
          transactions: true,
          consentRecords: { orderBy: { consentGivenAt: 'desc' } },
          caseFlags: { where: { status: { not: 'resolved' } } },
        },
      });
    });
  });

  describe('getConsentHistory', () => {
    it('returns consent records for seller', async () => {
      const records = [{ id: 'cr-1', purposeService: true }];
      prisma.consentRecord.findMany.mockResolvedValue(records);

      const result = await sellerRepo.getConsentHistory('seller-1');

      expect(result).toEqual(records);
      expect(prisma.consentRecord.findMany).toHaveBeenCalledWith({
        where: { subjectType: 'seller', subjectId: 'seller-1' },
        orderBy: { consentGivenAt: 'desc' },
      });
    });
  });

  describe('findTutorialsGroupedByCategory', () => {
    it('returns tutorials ordered by category and index', async () => {
      const tutorials = [
        { id: 't1', category: 'photography', orderIndex: 1 },
        { id: 't2', category: 'process', orderIndex: 1 },
      ];
      prisma.videoTutorial.findMany.mockResolvedValue(tutorials);

      const result = await sellerRepo.findTutorialsGroupedByCategory();

      expect(result).toEqual(tutorials);
      expect(prisma.videoTutorial.findMany).toHaveBeenCalledWith({
        orderBy: [{ category: 'asc' }, { orderIndex: 'asc' }],
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/domains/seller/__tests__/seller.repository.test.ts --no-coverage`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the repository implementation**

Create `src/domains/seller/seller.repository.ts`:

```typescript
import { prisma } from '@/infra/database/prisma';
import type { Seller } from '@prisma/client';

export async function findById(id: string): Promise<Seller | null> {
  return prisma.seller.findUnique({
    where: { id },
  });
}

export async function updateOnboardingStep(
  id: string,
  step: number,
): Promise<Seller> {
  return prisma.seller.update({
    where: { id },
    data: { onboardingStep: step },
  });
}

export async function getSellerWithRelations(id: string) {
  return prisma.seller.findUnique({
    where: { id },
    include: {
      properties: true,
      transactions: true,
      consentRecords: { orderBy: { consentGivenAt: 'desc' } },
      caseFlags: { where: { status: { not: 'resolved' } } },
    },
  });
}

export async function getConsentHistory(sellerId: string) {
  return prisma.consentRecord.findMany({
    where: {
      subjectType: 'seller',
      subjectId: sellerId,
    },
    orderBy: { consentGivenAt: 'desc' },
  });
}

export async function findTutorialsGroupedByCategory() {
  return prisma.videoTutorial.findMany({
    orderBy: [{ category: 'asc' }, { orderIndex: 'asc' }],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/domains/seller/__tests__/seller.repository.test.ts --no-coverage`

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/domains/seller/seller.repository.ts src/domains/seller/__tests__/seller.repository.test.ts
git commit -m "feat(seller): add seller repository with onboarding, dashboard, and tutorial queries"
```

---

### Task 5: Create seller service

**Files:**
- Create: `src/domains/seller/seller.service.ts`
- Create: `src/domains/seller/__tests__/seller.service.test.ts`

- [ ] **Step 1: Write failing tests for seller service**

Create `src/domains/seller/__tests__/seller.service.test.ts`:

```typescript
import * as sellerService from '../seller.service';
import * as sellerRepo from '../seller.repository';
import * as notificationRepo from '../../notification/notification.repository';
import * as auditService from '../../shared/audit.service';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { TOTAL_ONBOARDING_STEPS } from '../seller.types';

jest.mock('../seller.repository');
jest.mock('../../notification/notification.repository');
jest.mock('../../shared/audit.service');

const mockedSellerRepo = jest.mocked(sellerRepo);
const mockedNotificationRepo = jest.mocked(notificationRepo);
const mockedAuditService = jest.mocked(auditService);

describe('seller.service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getOnboardingStatus', () => {
    it('returns not started when step is 0', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 0,
      } as any);

      const result = await sellerService.getOnboardingStatus('seller-1');

      expect(result).toEqual({
        currentStep: 0,
        isComplete: false,
        completedSteps: [],
      });
    });

    it('returns complete when step equals total', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: TOTAL_ONBOARDING_STEPS,
      } as any);

      const result = await sellerService.getOnboardingStatus('seller-1');

      expect(result.isComplete).toBe(true);
      expect(result.completedSteps).toEqual([1, 2, 3, 4, 5]);
    });

    it('throws NotFoundError for nonexistent seller', async () => {
      mockedSellerRepo.findById.mockResolvedValue(null);

      await expect(sellerService.getOnboardingStatus('bad-id'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('completeOnboardingStep', () => {
    it('advances to the next step', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 1,
      } as any);
      mockedSellerRepo.updateOnboardingStep.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 2,
      } as any);

      const result = await sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: 2,
      });

      expect(mockedSellerRepo.updateOnboardingStep)
        .toHaveBeenCalledWith('seller-1', 2);
      expect(result.onboardingStep).toBe(2);
    });

    it('rejects step below 1', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 0,
      } as any);

      await expect(sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: 0,
      })).rejects.toThrow(ValidationError);
    });

    it('rejects step beyond total', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 3,
      } as any);

      await expect(sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: TOTAL_ONBOARDING_STEPS + 1,
      })).rejects.toThrow(ValidationError);
    });

    it('rejects skipping steps', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 1,
      } as any);

      await expect(sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: 3,
      })).rejects.toThrow(ValidationError);
    });

    it('rejects going backward', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 3,
      } as any);

      await expect(sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: 2,
      })).rejects.toThrow(ValidationError);
    });

    it('rejects completing step when already fully onboarded', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: TOTAL_ONBOARDING_STEPS,
      } as any);

      await expect(sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: TOTAL_ONBOARDING_STEPS + 1,
      })).rejects.toThrow(ValidationError);
    });

    it('logs audit entry on step completion', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 0,
      } as any);
      mockedSellerRepo.updateOnboardingStep.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 1,
      } as any);

      await sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: 1,
      });

      expect(mockedAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'seller.onboarding_step_completed',
          entityType: 'seller',
          entityId: 'seller-1',
          details: { step: 1 },
        }),
      );
    });
  });

  describe('getDashboardOverview', () => {
    it('returns overview with onboarding status and next steps', async () => {
      mockedSellerRepo.getSellerWithRelations.mockResolvedValue({
        id: 'seller-1',
        name: 'Test Seller',
        email: 'test@test.local',
        phone: '91234567',
        status: 'engaged',
        onboardingStep: 3,
        properties: [],
        transactions: [],
        consentRecords: [],
        caseFlags: [],
      } as any);
      mockedNotificationRepo.countUnreadForRecipient.mockResolvedValue(5);

      const result = await sellerService.getDashboardOverview('seller-1');

      expect(result.seller.name).toBe('Test Seller');
      expect(result.onboarding.currentStep).toBe(3);
      expect(result.onboarding.isComplete).toBe(false);
      expect(result.unreadNotificationCount).toBe(5);
      expect(result.nextSteps.length).toBeGreaterThan(0);
    });

    it('throws NotFoundError for nonexistent seller', async () => {
      mockedSellerRepo.getSellerWithRelations.mockResolvedValue(null);

      await expect(sellerService.getDashboardOverview('bad-id'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('getMyData', () => {
    it('returns personal info and consent status', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        name: 'Test Seller',
        email: 'test@test.local',
        phone: '91234567',
        consentService: true,
        consentMarketing: false,
        consentTimestamp: new Date('2026-01-01'),
        consentWithdrawnAt: null,
        status: 'active',
      } as any);
      mockedSellerRepo.getConsentHistory.mockResolvedValue([]);

      const result = await sellerService.getMyData('seller-1');

      expect(result.personalInfo.name).toBe('Test Seller');
      expect(result.consentStatus.service).toBe(true);
      expect(result.consentStatus.marketing).toBe(false);
      expect(result.dataActions.canRequestCorrection).toBe(true);
      expect(result.dataActions.canRequestDeletion).toBe(false); // active status
      expect(result.dataActions.canWithdrawConsent).toBe(true);
    });
  });

  describe('getTutorialsGrouped', () => {
    it('groups tutorials by category', async () => {
      mockedSellerRepo.findTutorialsGroupedByCategory.mockResolvedValue([
        { id: 't1', category: 'photography', title: 'Photo tips', orderIndex: 1 },
        { id: 't2', category: 'photography', title: 'Lighting', orderIndex: 2 },
        { id: 't3', category: 'process', title: 'Timeline', orderIndex: 1 },
      ] as any);

      const result = await sellerService.getTutorialsGrouped();

      expect(result['photography']).toHaveLength(2);
      expect(result['process']).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/domains/seller/__tests__/seller.service.test.ts --no-coverage`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the service implementation**

Create `src/domains/seller/seller.service.ts`:

```typescript
import * as sellerRepo from './seller.repository';
import * as notificationRepo from '../notification/notification.repository';
import * as auditService from '../shared/audit.service';
import { NotFoundError, ValidationError } from '../shared/errors';
import {
  TOTAL_ONBOARDING_STEPS,
  type OnboardingStatus,
  type DashboardOverview,
  type SellerMyData,
  type NextStep,
  type CompleteOnboardingStepInput,
  type TimelineMilestone,
  type DocumentChecklistItem,
} from './seller.types';

export async function getOnboardingStatus(sellerId: string): Promise<OnboardingStatus> {
  const seller = await sellerRepo.findById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  return buildOnboardingStatus(seller.onboardingStep);
}

export async function completeOnboardingStep(
  input: CompleteOnboardingStepInput,
): Promise<{ onboardingStep: number }> {
  const seller = await sellerRepo.findById(input.sellerId);
  if (!seller) throw new NotFoundError('Seller', input.sellerId);

  // Validate bounds first
  if (input.step < 1 || input.step > TOTAL_ONBOARDING_STEPS) {
    throw new ValidationError(
      `Step must be between 1 and ${TOTAL_ONBOARDING_STEPS}.`,
    );
  }

  // Validate sequential progression
  const expectedStep = seller.onboardingStep + 1;
  if (input.step !== expectedStep) {
    throw new ValidationError(
      `Cannot complete step ${input.step}. Expected step ${expectedStep}.`,
    );
  }

  const updated = await sellerRepo.updateOnboardingStep(input.sellerId, input.step);

  await auditService.log({
    action: 'seller.onboarding_step_completed',
    entityType: 'seller',
    entityId: input.sellerId,
    details: { step: input.step },
  });

  return { onboardingStep: updated.onboardingStep };
}

export async function getDashboardOverview(sellerId: string): Promise<DashboardOverview> {
  const seller = await sellerRepo.getSellerWithRelations(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const unreadNotificationCount = await notificationRepo.countUnreadForRecipient(
    'seller',
    sellerId,
  );

  const onboarding = buildOnboardingStatus(seller.onboardingStep);
  const property = seller.properties?.[0] ?? null;
  const transaction = seller.transactions?.[0] ?? null;
  const nextSteps = buildNextSteps(onboarding, property);

  return {
    seller: {
      id: seller.id,
      name: seller.name,
      email: seller.email,
      phone: seller.phone,
      status: seller.status,
      onboardingStep: seller.onboardingStep,
    },
    onboarding,
    propertyStatus: property?.status ?? null,
    transactionStatus: transaction?.status ?? null,
    unreadNotificationCount,
    nextSteps,
  };
}

export async function getMyData(sellerId: string): Promise<SellerMyData> {
  const seller = await sellerRepo.findById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const consentHistory = await sellerRepo.getConsentHistory(sellerId);

  return {
    personalInfo: {
      name: seller.name,
      email: seller.email,
      phone: seller.phone,
    },
    consentStatus: {
      service: seller.consentService,
      marketing: seller.consentMarketing,
      consentTimestamp: seller.consentTimestamp,
      withdrawnAt: seller.consentWithdrawnAt,
    },
    consentHistory: consentHistory.map((c) => ({
      id: c.id,
      purposeService: c.purposeService,
      purposeMarketing: c.purposeMarketing,
      consentGivenAt: c.consentGivenAt,
      consentWithdrawnAt: c.consentWithdrawnAt,
    })),
    dataActions: {
      canRequestCorrection: true,
      canRequestDeletion: seller.status !== 'active',
      canWithdrawConsent: seller.consentService || seller.consentMarketing,
    },
  };
}

export async function getTutorialsGrouped(): Promise<Record<string, any[]>> {
  const tutorials = await sellerRepo.findTutorialsGroupedByCategory();

  return tutorials.reduce((acc: Record<string, any[]>, t) => {
    if (!acc[t.category]) acc[t.category] = [];
    acc[t.category].push(t);
    return acc;
  }, {});
}

export function getTimelineMilestones(
  propertyStatus: string | null,
  transactionStatus: string | null,
): TimelineMilestone[] {
  const milestones: TimelineMilestone[] = [
    { label: 'Property Listed', status: 'upcoming', date: null, description: 'Your property is live on the market' },
    { label: 'Viewings', status: 'upcoming', date: null, description: 'Buyers view your home' },
    { label: 'Offer Received', status: 'upcoming', date: null, description: 'A buyer makes an offer' },
    { label: 'OTP Issued', status: 'upcoming', date: null, description: 'Option to Purchase signed' },
    { label: 'OTP Exercised', status: 'upcoming', date: null, description: 'Buyer exercises the option' },
    { label: 'Completion', status: 'upcoming', date: null, description: 'Sale completed' },
  ];

  const propertyStageMap: Record<string, number> = {
    listed: 0,
    offer_received: 2,
    under_option: 3,
    completing: 4,
    completed: 5,
  };

  if (propertyStatus && propertyStatus in propertyStageMap) {
    const completedUpTo = propertyStageMap[propertyStatus];
    for (let i = 0; i <= completedUpTo; i++) {
      milestones[i].status = i === completedUpTo ? 'current' : 'completed';
    }
  }

  return milestones;
}

export function getDocumentChecklist(propertyStatus: string | null): DocumentChecklistItem[] {
  const items: DocumentChecklistItem[] = [
    { id: 'nric', label: 'NRIC', description: 'Identity document for verification', required: true, status: 'not_uploaded', applicableStages: ['draft', 'listed'] },
    { id: 'marriage-cert', label: 'Marriage Certificate', description: 'If property is jointly owned', required: false, status: 'not_uploaded', applicableStages: ['draft', 'listed'] },
    { id: 'eligibility-letter', label: 'HDB Eligibility Letter', description: 'From HDB after resale application', required: true, status: 'not_uploaded', applicableStages: ['under_option', 'completing'] },
    { id: 'otp-scan', label: 'Signed OTP', description: 'Scanned copy of signed Option to Purchase', required: true, status: 'not_uploaded', applicableStages: ['under_option'] },
    { id: 'estate-agency-agreement', label: 'Estate Agency Agreement', description: 'CEA Form 1 signed with agent', required: true, status: 'not_uploaded', applicableStages: ['draft', 'listed'] },
  ];

  if (!propertyStatus) return items;
  return items.filter((item) => item.applicableStages.includes(propertyStatus));
}

// --- Private helpers ---

function buildOnboardingStatus(step: number): OnboardingStatus {
  const completedSteps: number[] = [];
  for (let i = 1; i <= step; i++) {
    completedSteps.push(i);
  }
  return {
    currentStep: step,
    isComplete: step >= TOTAL_ONBOARDING_STEPS,
    completedSteps,
  };
}

function buildNextSteps(
  onboarding: OnboardingStatus,
  property: any,
): NextStep[] {
  const steps: NextStep[] = [];

  if (!onboarding.isComplete) {
    steps.push({
      label: 'Complete Onboarding',
      description: `Step ${onboarding.currentStep + 1} of ${TOTAL_ONBOARDING_STEPS}`,
      href: '/seller/onboarding',
      priority: 1,
    });
    return steps;
  }

  if (!property) {
    steps.push({
      label: 'Add Property Details',
      description: 'Enter your flat details to get started',
      href: '/seller/property',
      priority: 1,
    });
  } else if (property.status === 'draft') {
    steps.push({
      label: 'Complete Property Listing',
      description: 'Add photos and submit for review',
      href: '/seller/photos',
      priority: 1,
    });
  }

  return steps;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/domains/seller/__tests__/seller.service.test.ts --no-coverage`

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/domains/seller/seller.service.ts src/domains/seller/__tests__/seller.service.test.ts
git commit -m "feat(seller): add seller service with onboarding, dashboard, and PDPA logic"
```

---

### Task 6: Create seller validator

**Files:**
- Create: `src/domains/seller/seller.validator.ts`

- [ ] **Step 1: Create the validator**

```typescript
import { param } from 'express-validator';
import { TOTAL_ONBOARDING_STEPS } from './seller.types';

export const validateOnboardingStep = [
  param('step')
    .isInt({ min: 1, max: TOTAL_ONBOARDING_STEPS })
    .withMessage(`Step must be between 1 and ${TOTAL_ONBOARDING_STEPS}`)
    .toInt(),
];
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/seller/seller.validator.ts
git commit -m "feat(seller): add onboarding step validator"
```

---

### Task 7: Create seller router

**Files:**
- Create: `src/domains/seller/seller.router.ts`
- Create: `src/domains/seller/__tests__/seller.router.test.ts`

- [ ] **Step 1: Write failing tests for the router**

Create `src/domains/seller/__tests__/seller.router.test.ts`:

```typescript
import * as sellerService from '../seller.service';
import { TOTAL_ONBOARDING_STEPS } from '../seller.types';

jest.mock('../seller.service');

const mockedService = jest.mocked(sellerService);

import request from 'supertest';
import express from 'express';
import { sellerRouter } from '../seller.router';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mock Nunjucks render
  app.engine('njk', (_path: string, options: any, callback: Function) => {
    callback(null, JSON.stringify({ template: _path, data: options }));
  });
  app.set('view engine', 'njk');
  app.set('views', 'src/views');

  // Mock authenticated seller
  app.use((req, _res, next) => {
    req.user = { id: 'seller-1', role: 'seller', email: 'test@test.local', name: 'Test', twoFactorEnabled: false, twoFactorVerified: false };
    req.isAuthenticated = () => true;
    next();
  });

  app.use(sellerRouter);
  return app;
}

describe('seller.router', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  describe('GET /seller/dashboard', () => {
    it('redirects to onboarding if not complete', async () => {
      mockedService.getDashboardOverview.mockResolvedValue({
        seller: { id: 'seller-1', name: 'Test', email: 'test@test.local', phone: '91234567', status: 'lead', onboardingStep: 2 },
        onboarding: { currentStep: 2, isComplete: false, completedSteps: [1, 2] },
        propertyStatus: null,
        transactionStatus: null,
        unreadNotificationCount: 0,
        nextSteps: [],
      });

      const res = await request(app).get('/seller/dashboard');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/seller/onboarding');
    });

    it('renders dashboard when onboarding is complete', async () => {
      mockedService.getDashboardOverview.mockResolvedValue({
        seller: { id: 'seller-1', name: 'Test', email: 'test@test.local', phone: '91234567', status: 'engaged', onboardingStep: 5 },
        onboarding: { currentStep: 5, isComplete: true, completedSteps: [1, 2, 3, 4, 5] },
        propertyStatus: null,
        transactionStatus: null,
        unreadNotificationCount: 3,
        nextSteps: [],
      });

      const res = await request(app).get('/seller/dashboard');

      expect(res.status).toBe(200);
    });

    it('returns HTMX partial when hx-request is set', async () => {
      mockedService.getDashboardOverview.mockResolvedValue({
        seller: { id: 'seller-1', name: 'Test', email: 'test@test.local', phone: '91234567', status: 'engaged', onboardingStep: 5 },
        onboarding: { currentStep: 5, isComplete: true, completedSteps: [1, 2, 3, 4, 5] },
        propertyStatus: null,
        transactionStatus: null,
        unreadNotificationCount: 0,
        nextSteps: [],
      });

      const res = await request(app)
        .get('/seller/dashboard')
        .set('HX-Request', 'true');

      expect(res.status).toBe(200);
      // Should render the partial template path
      const body = JSON.parse(res.text);
      expect(body.template).toContain('partials/seller/dashboard-overview');
    });
  });

  describe('GET /seller/onboarding', () => {
    it('renders onboarding page', async () => {
      mockedService.getOnboardingStatus.mockResolvedValue({
        currentStep: 0,
        isComplete: false,
        completedSteps: [],
      });

      const res = await request(app).get('/seller/onboarding');

      expect(res.status).toBe(200);
    });

    it('redirects to dashboard if onboarding is complete', async () => {
      mockedService.getOnboardingStatus.mockResolvedValue({
        currentStep: TOTAL_ONBOARDING_STEPS,
        isComplete: true,
        completedSteps: [1, 2, 3, 4, 5],
      });

      const res = await request(app).get('/seller/onboarding');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/seller/dashboard');
    });
  });

  describe('POST /seller/onboarding/step/:step', () => {
    it('completes step and returns next step partial for HTMX', async () => {
      mockedService.completeOnboardingStep.mockResolvedValue({ onboardingStep: 2 });

      const res = await request(app)
        .post('/seller/onboarding/step/2')
        .set('HX-Request', 'true');

      expect(res.status).toBe(200);
      expect(mockedService.completeOnboardingStep).toHaveBeenCalledWith({
        sellerId: 'seller-1',
        step: 2,
      });
    });

    it('redirects to dashboard after completing last step', async () => {
      mockedService.completeOnboardingStep.mockResolvedValue({
        onboardingStep: TOTAL_ONBOARDING_STEPS,
      });

      const res = await request(app)
        .post(`/seller/onboarding/step/${TOTAL_ONBOARDING_STEPS}`)
        .set('HX-Request', 'true');

      expect(res.status).toBe(200);
      expect(res.headers['hx-redirect']).toBe('/seller/dashboard');
    });
  });

  describe('GET /seller/my-data', () => {
    it('renders My Data page', async () => {
      mockedService.getMyData.mockResolvedValue({
        personalInfo: { name: 'Test', email: 'test@test.local', phone: '91234567' },
        consentStatus: { service: true, marketing: false, consentTimestamp: new Date(), withdrawnAt: null },
        consentHistory: [],
        dataActions: { canRequestCorrection: true, canRequestDeletion: true, canWithdrawConsent: true },
      });

      const res = await request(app).get('/seller/my-data');

      expect(res.status).toBe(200);
    });
  });

  describe('GET /seller/tutorials', () => {
    it('renders tutorials page with grouped data', async () => {
      mockedService.getTutorialsGrouped.mockResolvedValue({
        photography: [{ id: 't1', title: 'Photo tips' }],
      });

      const res = await request(app).get('/seller/tutorials');

      expect(res.status).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/domains/seller/__tests__/seller.router.test.ts --no-coverage`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the router implementation**

Create `src/domains/seller/seller.router.ts`:

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as sellerService from './seller.service';
import { validateOnboardingStep } from './seller.validator';
import { TOTAL_ONBOARDING_STEPS } from './seller.types';
import { requireAuth, requireRole } from '@/infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

export const sellerRouter = Router();

const sellerAuth = [requireAuth(), requireRole('seller')];

// Middleware: inject currentPath and unreadCount for all seller routes
sellerRouter.use('/seller', ...sellerAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.locals.currentPath = req.path === '/' ? '/seller/dashboard' : `/seller${req.path}`;
    // Lazy-load unread count for sidebar badge
    const user = req.user as AuthenticatedUser;
    const notificationRepo = await import('../notification/notification.repository');
    res.locals.unreadCount = await notificationRepo.countUnreadForRecipient('seller', user.id);
    next();
  } catch (err) {
    next(err);
  }
});

// Dashboard overview
sellerRouter.get(
  '/seller/dashboard',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const overview = await sellerService.getDashboardOverview(user.id);

      if (!overview.onboarding.isComplete) {
        return res.redirect('/seller/onboarding');
      }

      const milestones = sellerService.getTimelineMilestones(
        overview.propertyStatus,
        overview.transactionStatus,
      );

      if (req.headers['hx-request']) {
        return res.render('partials/seller/dashboard-overview', { overview, milestones });
      }
      res.render('pages/seller/dashboard', { overview, milestones });
    } catch (err) {
      next(err);
    }
  },
);

// Onboarding wizard
sellerRouter.get(
  '/seller/onboarding',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const status = await sellerService.getOnboardingStatus(user.id);

      if (status.isComplete) {
        return res.redirect('/seller/dashboard');
      }

      res.render('pages/seller/onboarding', { status });
    } catch (err) {
      next(err);
    }
  },
);

// Onboarding step partial (HTMX)
sellerRouter.get(
  '/seller/onboarding/step/:step',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const step = parseInt(req.params.step, 10);
      if (step < 1 || step > TOTAL_ONBOARDING_STEPS) {
        return res.status(400).render('partials/error-message', {
          message: `Invalid step: ${step}`,
        });
      }
      res.render(`partials/seller/onboarding-step-${step}`);
    } catch (err) {
      next(err);
    }
  },
);

// Complete onboarding step
sellerRouter.post(
  '/seller/onboarding/step/:step',
  ...validateOnboardingStep,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render('partials/error-message', {
          message: Object.values(errors.mapped())[0].msg,
        });
      }

      const user = req.user as AuthenticatedUser;
      const step = parseInt(req.params.step, 10);

      const result = await sellerService.completeOnboardingStep({
        sellerId: user.id,
        step,
      });

      if (result.onboardingStep >= TOTAL_ONBOARDING_STEPS) {
        if (req.headers['hx-request']) {
          res.set('HX-Redirect', '/seller/dashboard');
          return res.sendStatus(200);
        }
        return res.redirect('/seller/dashboard');
      }

      const nextStep = step + 1;
      if (req.headers['hx-request']) {
        return res.render(`partials/seller/onboarding-step-${nextStep}`, {
          currentStep: nextStep,
        });
      }
      res.redirect('/seller/onboarding');
    } catch (err) {
      next(err);
    }
  },
);

// Notification feed
sellerRouter.get(
  '/seller/notifications',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const notificationRepo = await import('../notification/notification.repository');
      const notifications = await notificationRepo.findUnreadForRecipient('seller', user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/notification-list', { notifications });
      }
      res.render('pages/seller/notifications', { notifications });
    } catch (err) {
      next(err);
    }
  },
);

// My Data (PDPA)
sellerRouter.get(
  '/seller/my-data',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const myData = await sellerService.getMyData(user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/my-data-content', { myData });
      }
      res.render('pages/seller/my-data', { myData });
    } catch (err) {
      next(err);
    }
  },
);

// Document checklist
sellerRouter.get(
  '/seller/documents',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const overview = await sellerService.getDashboardOverview(user.id);
      const checklist = sellerService.getDocumentChecklist(overview.propertyStatus);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/document-checklist', { checklist });
      }
      res.render('pages/seller/documents', { checklist });
    } catch (err) {
      next(err);
    }
  },
);

// Video tutorials
sellerRouter.get(
  '/seller/tutorials',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const grouped = await sellerService.getTutorialsGrouped();

      if (req.headers['hx-request']) {
        return res.render('partials/seller/tutorials-content', { grouped });
      }
      res.render('pages/seller/tutorials', { grouped });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/domains/seller/__tests__/seller.router.test.ts --no-coverage`

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/domains/seller/seller.router.ts src/domains/seller/seller.validator.ts src/domains/seller/__tests__/seller.router.test.ts
git commit -m "feat(seller): add seller router with dashboard, onboarding, and PDPA routes"
```

---

## Chunk 2: Views + App Registration + Integration Tests

### Task 8: Update seller layout with sidebar navigation

**Files:**
- Modify: `src/views/layouts/seller.njk`

The layout uses `currentPath` and `unreadCount` variables injected by the seller router middleware (Task 7).

- [ ] **Step 1: Update the seller layout with full sidebar**

Replace the content of `src/views/layouts/seller.njk` with:

```nunjucks
{% extends "layouts/base.njk" %}

{% block body %}
<div class="flex min-h-screen">
  {# Sidebar #}
  <aside class="w-64 bg-white border-r border-gray-200 flex flex-col">
    <div class="p-4 border-b border-gray-200">
      <a href="/seller/dashboard" class="text-lg font-bold text-blue-600">
        {{ "SellMyHouse" | t }}
      </a>
    </div>
    <nav class="flex-1 p-4 space-y-1">
      <a href="/seller/dashboard"
         class="flex items-center px-3 py-2 rounded-md text-sm font-medium {% if currentPath == '/seller/dashboard' %}bg-blue-50 text-blue-700{% else %}text-gray-700 hover:bg-gray-100{% endif %}">
        {{ "Overview" | t }}
      </a>
      <a href="/seller/property"
         class="flex items-center px-3 py-2 rounded-md text-sm font-medium {% if currentPath == '/seller/property' %}bg-blue-50 text-blue-700{% else %}text-gray-700 hover:bg-gray-100{% endif %}">
        {{ "Property" | t }}
      </a>
      <a href="/seller/photos"
         class="flex items-center px-3 py-2 rounded-md text-sm font-medium {% if currentPath == '/seller/photos' %}bg-blue-50 text-blue-700{% else %}text-gray-700 hover:bg-gray-100{% endif %}">
        {{ "Photos" | t }}
      </a>
      <a href="/seller/viewings"
         class="flex items-center px-3 py-2 rounded-md text-sm font-medium {% if currentPath == '/seller/viewings' %}bg-blue-50 text-blue-700{% else %}text-gray-700 hover:bg-gray-100{% endif %}">
        {{ "Viewings" | t }}
      </a>
      <a href="/seller/documents"
         class="flex items-center px-3 py-2 rounded-md text-sm font-medium {% if currentPath == '/seller/documents' %}bg-blue-50 text-blue-700{% else %}text-gray-700 hover:bg-gray-100{% endif %}">
        {{ "Documents" | t }}
      </a>
      <a href="/seller/financial"
         class="flex items-center px-3 py-2 rounded-md text-sm font-medium {% if currentPath == '/seller/financial' %}bg-blue-50 text-blue-700{% else %}text-gray-700 hover:bg-gray-100{% endif %}">
        {{ "Financial Report" | t }}
      </a>
      <a href="/seller/tutorials"
         class="flex items-center px-3 py-2 rounded-md text-sm font-medium {% if currentPath == '/seller/tutorials' %}bg-blue-50 text-blue-700{% else %}text-gray-700 hover:bg-gray-100{% endif %}">
        {{ "Video Tutorials" | t }}
      </a>

      <div class="pt-4 mt-4 border-t border-gray-200">
        <a href="/seller/notifications"
           class="flex items-center px-3 py-2 rounded-md text-sm font-medium {% if currentPath == '/seller/notifications' %}bg-blue-50 text-blue-700{% else %}text-gray-700 hover:bg-gray-100{% endif %}">
          {{ "Notifications" | t }}
          {% if unreadCount > 0 %}
          <span class="ml-auto inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold text-white bg-red-500 rounded-full">
            {{ unreadCount }}
          </span>
          {% endif %}
        </a>
        <a href="/seller/settings"
           class="flex items-center px-3 py-2 rounded-md text-sm font-medium {% if currentPath == '/seller/settings' %}bg-blue-50 text-blue-700{% else %}text-gray-700 hover:bg-gray-100{% endif %}">
          {{ "Settings" | t }}
        </a>
        <a href="/seller/my-data"
           class="flex items-center px-3 py-2 rounded-md text-sm font-medium {% if currentPath == '/seller/my-data' %}bg-blue-50 text-blue-700{% else %}text-gray-700 hover:bg-gray-100{% endif %}">
          {{ "My Data" | t }}
        </a>
      </div>
    </nav>
    <div class="p-4 border-t border-gray-200">
      <form action="/auth/logout" method="POST">
        <button type="submit" class="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md">
          {{ "Log Out" | t }}
        </button>
      </form>
    </div>
  </aside>

  {# Main content #}
  <main class="flex-1 p-8">
    {% block content %}{% endblock %}
  </main>
</div>
{% endblock %}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/layouts/seller.njk
git commit -m "feat(seller): update seller layout with full sidebar navigation"
```

---

### Task 9: Create onboarding wizard views

**Files:**
- Create: `src/views/pages/seller/onboarding.njk`
- Create: `src/views/partials/seller/progress-bar.njk`
- Create: `src/views/partials/seller/onboarding-step-1.njk`
- Create: `src/views/partials/seller/onboarding-step-2.njk`
- Create: `src/views/partials/seller/onboarding-step-3.njk`
- Create: `src/views/partials/seller/onboarding-step-4.njk`
- Create: `src/views/partials/seller/onboarding-step-5.njk`

- [ ] **Step 1: Create progress bar partial**

Create `src/views/partials/seller/progress-bar.njk`:

```nunjucks
<div class="mb-8">
  <div class="flex items-center justify-between mb-2">
    {% for i in range(1, 6) %}
    <div class="flex items-center {% if i < 5 %}flex-1{% endif %}">
      <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
        {% if i <= status.currentStep %}bg-blue-600 text-white
        {% elif i == status.currentStep + 1 %}bg-blue-100 text-blue-600 border-2 border-blue-600
        {% else %}bg-gray-200 text-gray-500{% endif %}">
        {% if i <= status.currentStep %}✓{% else %}{{ i }}{% endif %}
      </div>
      {% if i < 5 %}
      <div class="flex-1 h-1 mx-2 {% if i <= status.currentStep %}bg-blue-600{% else %}bg-gray-200{% endif %}"></div>
      {% endif %}
    </div>
    {% endfor %}
  </div>
  <div class="flex justify-between text-xs text-gray-500">
    <span>{{ "Welcome" | t }}</span>
    <span>{{ "Property" | t }}</span>
    <span>{{ "Finances" | t }}</span>
    <span>{{ "Photos" | t }}</span>
    <span>{{ "Agreement" | t }}</span>
  </div>
</div>
```

- [ ] **Step 2: Create onboarding container page**

Create `src/views/pages/seller/onboarding.njk`:

Note: Uses HTMX `hx-trigger="load"` to fetch the initial step instead of dynamic `{% include %}` (which Nunjucks does not support with concatenated paths).

```nunjucks
{% extends "layouts/seller.njk" %}

{% block title %}{{ "Onboarding" | t }} — SellMyHouse.sg{% endblock %}

{% block content %}
<div class="max-w-2xl mx-auto">
  <h1 class="text-2xl font-bold mb-6">{{ "Get Started" | t }}</h1>

  {% include "partials/seller/progress-bar.njk" %}

  <div id="onboarding-step"
       hx-get="/seller/onboarding/step/{{ status.currentStep + 1 }}"
       hx-trigger="load"
       hx-swap="innerHTML">
    <div class="flex items-center justify-center p-8">
      <span class="text-gray-400">{{ "Loading..." | t }}</span>
    </div>
  </div>
</div>
{% endblock %}
```

- [ ] **Step 3: Create step 1 — Welcome**

Create `src/views/partials/seller/onboarding-step-1.njk`:

```nunjucks
<div class="bg-white rounded-lg shadow p-6">
  <h2 class="text-xl font-semibold mb-4">{{ "Welcome to SellMyHouse.sg" | t }}</h2>

  <div class="space-y-4 text-gray-700">
    <p>{{ "We're here to help you sell your HDB flat at a fixed fee of $1,499 + GST. Here's how it works:" | t }}</p>

    <ul class="list-disc pl-5 space-y-2">
      <li>{{ "You take the photos and conduct the viewings — we guide you every step of the way" | t }}</li>
      <li>{{ "Your agent reviews everything and handles the complex parts — negotiations, paperwork, compliance" | t }}</li>
      <li>{{ "No AI-generated content reaches anyone without your agent's review and approval" | t }}</li>
    </ul>

    <div class="bg-blue-50 border border-blue-200 rounded p-4">
      <p class="font-medium mb-2">{{ "Recommended: Watch the complete HDB resale timeline video" | t }}</p>
      <a href="/seller/tutorials" class="text-blue-600 hover:underline text-sm">
        {{ "View Video Tutorials →" | t }}
      </a>
    </div>
  </div>

  <div class="mt-6">
    <button
      hx-post="/seller/onboarding/step/1"
      hx-target="#onboarding-step"
      hx-swap="innerHTML"
      class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition"
    >
      {{ "I understand the process — Continue" | t }}
    </button>
  </div>
</div>
```

- [ ] **Step 4: Create step 2 — Property Details (stub)**

Create `src/views/partials/seller/onboarding-step-2.njk`:

```nunjucks
<div class="bg-white rounded-lg shadow p-6">
  <h2 class="text-xl font-semibold mb-4">{{ "Your Property Details" | t }}</h2>

  <p class="text-gray-600 mb-4">{{ "Enter your flat details below. These will be used to generate your financial report and listing." | t }}</p>

  <form id="property-form" class="space-y-4">
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">{{ "Town" | t }}</label>
        <select name="town" class="w-full border border-gray-300 rounded-md px-3 py-2" disabled>
          <option>{{ "Coming in Phase 2B" | t }}</option>
        </select>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">{{ "Flat Type" | t }}</label>
        <select name="flatType" class="w-full border border-gray-300 rounded-md px-3 py-2" disabled>
          <option>{{ "Coming in Phase 2B" | t }}</option>
        </select>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">{{ "Block" | t }}</label>
        <input type="text" name="block" class="w-full border border-gray-300 rounded-md px-3 py-2" placeholder="e.g. 123" disabled>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">{{ "Street" | t }}</label>
        <input type="text" name="street" class="w-full border border-gray-300 rounded-md px-3 py-2" placeholder="e.g. Tampines St 11" disabled>
      </div>
    </div>
    <p class="text-sm text-amber-600">{{ "Property form fields will be fully functional in the next update." | t }}</p>
  </form>

  <div class="mt-6">
    <button
      hx-post="/seller/onboarding/step/2"
      hx-target="#onboarding-step"
      hx-swap="innerHTML"
      class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition"
    >
      {{ "Continue" | t }}
    </button>
  </div>
</div>
```

- [ ] **Step 5: Create step 3 — Financial Situation (stub)**

Create `src/views/partials/seller/onboarding-step-3.njk`:

```nunjucks
<div class="bg-white rounded-lg shadow p-6">
  <h2 class="text-xl font-semibold mb-4">{{ "Your Financial Situation" | t }}</h2>

  <p class="text-gray-600 mb-4">{{ "These details help us estimate your net sale proceeds. You can skip any field you're unsure about and fill it in later." | t }}</p>

  <form id="financial-form" class="space-y-4">
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">{{ "Outstanding Loan Balance ($)" | t }}</label>
      <input type="number" name="outstandingLoan" class="w-full border border-gray-300 rounded-md px-3 py-2" placeholder="e.g. 200000" disabled>
      <p class="text-xs text-gray-500 mt-1">{{ "Check your latest HDB or bank statement" | t }}</p>
    </div>
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">{{ "CPF OA Used for This Flat ($)" | t }}</label>
      <input type="number" name="cpfUsed" class="w-full border border-gray-300 rounded-md px-3 py-2" placeholder="e.g. 50000" disabled>
      <p class="text-xs text-gray-500 mt-1">
        <a href="https://my.cpf.gov.sg" target="_blank" class="text-blue-600 hover:underline">{{ "Not sure? Check my.cpf.gov.sg →" | t }}</a>
      </p>
    </div>
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">{{ "Year of Purchase" | t }}</label>
      <input type="number" name="yearOfPurchase" class="w-full border border-gray-300 rounded-md px-3 py-2" placeholder="e.g. 2015" disabled>
    </div>
    <p class="text-sm text-amber-600">{{ "Financial inputs will be fully functional in a future update." | t }}</p>
  </form>

  <div class="mt-6">
    <button
      hx-post="/seller/onboarding/step/3"
      hx-target="#onboarding-step"
      hx-swap="innerHTML"
      class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition"
    >
      {{ "Continue" | t }}
    </button>
  </div>
</div>
```

- [ ] **Step 6: Create step 4 — Photos**

Create `src/views/partials/seller/onboarding-step-4.njk`:

```nunjucks
<div class="bg-white rounded-lg shadow p-6">
  <h2 class="text-xl font-semibold mb-4">{{ "Take Photos of Your Home" | t }}</h2>

  <div class="space-y-4 text-gray-700">
    <div class="bg-blue-50 border border-blue-200 rounded p-4">
      <p class="font-medium mb-2">{{ "Watch: How to take great listing photos" | t }}</p>
      <a href="/seller/tutorials" class="text-blue-600 hover:underline text-sm">
        {{ "View Photo Tutorial →" | t }}
      </a>
    </div>

    <p>{{ "We recommend taking photos of:" | t }}</p>
    <ul class="list-disc pl-5 space-y-1">
      <li>{{ "Living room" | t }}</li>
      <li>{{ "Kitchen" | t }}</li>
      <li>{{ "Master bedroom" | t }}</li>
      <li>{{ "Other bedrooms" | t }}</li>
      <li>{{ "Bathrooms" | t }}</li>
      <li>{{ "Balcony / view" | t }}</li>
      <li>{{ "Corridor / entrance" | t }}</li>
    </ul>

    <p class="text-sm text-gray-500">{{ "You can upload photos now or later from your dashboard." | t }}</p>
  </div>

  <div class="mt-6">
    <button
      hx-post="/seller/onboarding/step/4"
      hx-target="#onboarding-step"
      hx-swap="innerHTML"
      class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition"
    >
      {{ "I'll take photos — Continue" | t }}
    </button>
  </div>
</div>
```

- [ ] **Step 7: Create step 5 — Agreement**

Create `src/views/partials/seller/onboarding-step-5.njk`:

```nunjucks
<div class="bg-white rounded-lg shadow p-6">
  <h2 class="text-xl font-semibold mb-4">{{ "Understand Your Agreement" | t }}</h2>

  <div class="space-y-4 text-gray-700">
    <div class="bg-blue-50 border border-blue-200 rounded p-4">
      <p class="font-medium mb-2">{{ "Watch: Understanding CEA forms and your agreement" | t }}</p>
      <a href="/seller/tutorials" class="text-blue-600 hover:underline text-sm">
        {{ "View CEA Forms Tutorial →" | t }}
      </a>
    </div>

    <h3 class="font-medium">{{ "Key terms:" | t }}</h3>
    <ul class="list-disc pl-5 space-y-2">
      <li><strong>{{ "Non-exclusive agreement" | t }}</strong> — {{ "you are not locked in to a single agent" | t }}</li>
      <li><strong>{{ "Fixed fee: $1,499 + GST ($1,633.91)" | t }}</strong> — {{ "only payable on successful sale completion" | t }}</li>
      <li><strong>{{ "Co-broking welcomed" | t }}</strong> — {{ "buyer's agents can bring their clients. Commission is not shared." | t }}</li>
    </ul>

    <div class="bg-gray-50 border border-gray-200 rounded p-4 text-sm">
      <p>{{ "The actual agreement signing will happen via a video call with your agent. This step confirms that you've reviewed the key terms." | t }}</p>
    </div>
  </div>

  <div class="mt-6">
    <label class="flex items-start gap-2 mb-4">
      <input type="checkbox" id="agreement-checkbox" class="mt-1 rounded border-gray-300" onchange="document.getElementById('complete-btn').disabled = !this.checked">
      <span class="text-sm text-gray-700">{{ "I have watched the video and understand the terms" | t }}</span>
    </label>

    <button
      id="complete-btn"
      hx-post="/seller/onboarding/step/5"
      hx-target="#onboarding-step"
      hx-swap="innerHTML"
      class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
      disabled
    >
      {{ "Complete Onboarding" | t }}
    </button>
  </div>
</div>
```

- [ ] **Step 8: Commit**

```bash
git add src/views/pages/seller/onboarding.njk src/views/partials/seller/progress-bar.njk src/views/partials/seller/onboarding-step-*.njk
git commit -m "feat(seller): add onboarding wizard views with 5-step HTMX flow"
```

---

### Task 10: Create dashboard and remaining page views

**Files:**
- Create: `src/views/pages/seller/dashboard.njk`
- Create: `src/views/partials/seller/dashboard-overview.njk`
- Create: `src/views/pages/seller/notifications.njk`
- Create: `src/views/partials/seller/notification-list.njk`
- Create: `src/views/pages/seller/my-data.njk`
- Create: `src/views/partials/seller/my-data-content.njk`
- Create: `src/views/pages/seller/documents.njk`
- Create: `src/views/partials/seller/document-checklist.njk`
- Create: `src/views/pages/seller/tutorials.njk`
- Create: `src/views/partials/seller/tutorials-content.njk`
- Create: `src/views/partials/seller/timeline.njk`

- [ ] **Step 1: Create timeline partial**

Create `src/views/partials/seller/timeline.njk`:

```nunjucks
<div class="bg-white rounded-lg shadow p-6">
  <h3 class="font-semibold mb-4">{{ "Your Timeline" | t }}</h3>
  <div class="space-y-4">
    {% for milestone in milestones %}
    <div class="flex items-start gap-3">
      <div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs
        {% if milestone.status == 'completed' %}bg-green-100 text-green-700
        {% elif milestone.status == 'current' %}bg-blue-100 text-blue-700 ring-2 ring-blue-500
        {% else %}bg-gray-100 text-gray-400{% endif %}">
        {% if milestone.status == 'completed' %}✓{% else %}·{% endif %}
      </div>
      <div>
        <p class="text-sm font-medium {% if milestone.status == 'upcoming' %}text-gray-400{% else %}text-gray-900{% endif %}">
          {{ milestone.label | t }}
        </p>
        <p class="text-xs text-gray-500">{{ milestone.description | t }}</p>
        {% if milestone.date %}
        <p class="text-xs text-gray-400">{{ milestone.date | date }}</p>
        {% endif %}
      </div>
    </div>
    {% endfor %}
  </div>
</div>
```

- [ ] **Step 2: Create dashboard-overview partial (HTMX target)**

Create `src/views/partials/seller/dashboard-overview.njk`:

```nunjucks
{# Status card #}
<div class="bg-white rounded-lg shadow p-6 mb-6">
  <h2 class="font-semibold mb-3">{{ "Transaction Status" | t }}</h2>
  <div class="flex items-center gap-2">
    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
      {{ overview.seller.status }}
    </span>
    {% if overview.propertyStatus %}
    <span class="text-sm text-gray-500">{{ "Property:" | t }} {{ overview.propertyStatus }}</span>
    {% endif %}
  </div>
</div>

{# Next steps #}
{% if overview.nextSteps.length > 0 %}
<div class="bg-white rounded-lg shadow p-6 mb-6">
  <h2 class="font-semibold mb-3">{{ "Next Steps" | t }}</h2>
  <ul class="space-y-3">
    {% for step in overview.nextSteps %}
    <li>
      <a href="{{ step.href }}" class="flex items-center justify-between p-3 rounded-md border border-gray-200 hover:bg-gray-50 transition">
        <div>
          <p class="font-medium text-gray-900">{{ step.label | t }}</p>
          <p class="text-sm text-gray-500">{{ step.description | t }}</p>
        </div>
        <span class="text-gray-400">→</span>
      </a>
    </li>
    {% endfor %}
  </ul>
</div>
{% endif %}
```

- [ ] **Step 3: Create dashboard page**

Create `src/views/pages/seller/dashboard.njk`:

```nunjucks
{% extends "layouts/seller.njk" %}

{% block title %}{{ "Dashboard" | t }} — SellMyHouse.sg{% endblock %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Welcome back, " | t }}{{ overview.seller.name }}</h1>

<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
  {# Main content - 2 cols #}
  <div class="lg:col-span-2">
    {% include "partials/seller/dashboard-overview.njk" %}

    {# Notifications preview #}
    {% if overview.unreadNotificationCount > 0 %}
    <div class="bg-white rounded-lg shadow p-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold">{{ "Notifications" | t }}</h2>
        <a href="/seller/notifications" class="text-sm text-blue-600 hover:underline">{{ "View all" | t }}</a>
      </div>
      <p class="text-sm text-gray-600">
        {{ "You have" | t }} {{ overview.unreadNotificationCount }} {{ "unread notification(s)" | t }}
      </p>
    </div>
    {% endif %}
  </div>

  {# Sidebar - 1 col #}
  <div class="space-y-6">
    {% include "partials/seller/timeline.njk" %}
  </div>
</div>
{% endblock %}
```

- [ ] **Step 4: Create notification-list partial and notifications page**

Create `src/views/partials/seller/notification-list.njk`:

```nunjucks
{% if notifications.length == 0 %}
<div class="p-6 text-center text-gray-500">
  {{ "No notifications yet" | t }}
</div>
{% else %}
<ul class="divide-y divide-gray-200">
  {% for n in notifications %}
  <li class="p-4 {% if n.status != 'read' %}bg-blue-50{% endif %}">
    <div class="flex items-start justify-between">
      <div>
        <p class="text-sm font-medium text-gray-900">{{ n.templateName }}</p>
        <p class="text-sm text-gray-600 mt-1">{{ n.content }}</p>
        <p class="text-xs text-gray-400 mt-1">{{ n.createdAt | date }}</p>
      </div>
      {% if n.status != 'read' %}
      <span class="inline-flex h-2 w-2 rounded-full bg-blue-600 mt-1"></span>
      {% endif %}
    </div>
  </li>
  {% endfor %}
</ul>
{% endif %}
```

Create `src/views/pages/seller/notifications.njk`:

```nunjucks
{% extends "layouts/seller.njk" %}

{% block title %}{{ "Notifications" | t }} — SellMyHouse.sg{% endblock %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Notifications" | t }}</h1>

<div class="bg-white rounded-lg shadow">
  {% include "partials/seller/notification-list.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 5: Create my-data-content partial and My Data page**

Create `src/views/partials/seller/my-data-content.njk`:

```nunjucks
{# Personal Information #}
<div class="bg-white rounded-lg shadow p-6 mb-6">
  <h2 class="font-semibold mb-4">{{ "Personal Information" | t }}</h2>
  <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4">
    <div>
      <dt class="text-sm font-medium text-gray-500">{{ "Name" | t }}</dt>
      <dd class="mt-1 text-sm text-gray-900">{{ myData.personalInfo.name }}</dd>
    </div>
    <div>
      <dt class="text-sm font-medium text-gray-500">{{ "Email" | t }}</dt>
      <dd class="mt-1 text-sm text-gray-900">{{ myData.personalInfo.email or "Not provided" | t }}</dd>
    </div>
    <div>
      <dt class="text-sm font-medium text-gray-500">{{ "Phone" | t }}</dt>
      <dd class="mt-1 text-sm text-gray-900">{{ myData.personalInfo.phone }}</dd>
    </div>
  </dl>
  {% if myData.dataActions.canRequestCorrection %}
  <div class="mt-4">
    <a href="#" class="text-sm text-blue-600 hover:underline">{{ "Request data correction →" | t }}</a>
  </div>
  {% endif %}
</div>

{# Consent Status #}
<div class="bg-white rounded-lg shadow p-6 mb-6">
  <h2 class="font-semibold mb-4">{{ "Consent Status" | t }}</h2>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <span class="text-sm text-gray-700">{{ "Service Consent" | t }}</span>
      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {% if myData.consentStatus.service %}bg-green-100 text-green-800{% else %}bg-gray-100 text-gray-800{% endif %}">
        {% if myData.consentStatus.service %}{{ "Granted" | t }}{% else %}{{ "Not Granted" | t }}{% endif %}
      </span>
    </div>
    <div class="flex items-center justify-between">
      <span class="text-sm text-gray-700">{{ "Marketing Consent" | t }}</span>
      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {% if myData.consentStatus.marketing %}bg-green-100 text-green-800{% else %}bg-gray-100 text-gray-800{% endif %}">
        {% if myData.consentStatus.marketing %}{{ "Granted" | t }}{% else %}{{ "Not Granted" | t }}{% endif %}
      </span>
    </div>
    {% if myData.consentStatus.consentTimestamp %}
    <p class="text-xs text-gray-400">{{ "Consent recorded:" | t }} {{ myData.consentStatus.consentTimestamp | date }}</p>
    {% endif %}
  </div>
  {% if myData.dataActions.canWithdrawConsent %}
  <div class="mt-4">
    <a href="#" class="text-sm text-red-600 hover:underline">{{ "Withdraw consent →" | t }}</a>
  </div>
  {% endif %}
</div>

{# Data Deletion #}
{% if myData.dataActions.canRequestDeletion %}
<div class="bg-white rounded-lg shadow p-6 border border-red-200">
  <h2 class="font-semibold mb-2 text-red-700">{{ "Delete My Data" | t }}</h2>
  <p class="text-sm text-gray-600 mb-4">{{ "Request deletion of your personal data. Note: active transactions and legally required records cannot be deleted." | t }}</p>
  <a href="#" class="text-sm text-red-600 hover:underline">{{ "Request data deletion →" | t }}</a>
</div>
{% endif %}
```

Create `src/views/pages/seller/my-data.njk`:

```nunjucks
{% extends "layouts/seller.njk" %}

{% block title %}{{ "My Data" | t }} — SellMyHouse.sg{% endblock %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "My Data" | t }}</h1>

<div class="space-y-6">
  {% include "partials/seller/my-data-content.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 6: Create document-checklist partial and documents page**

Create `src/views/partials/seller/document-checklist.njk`:

```nunjucks
{% if checklist.length == 0 %}
<div class="p-6 text-center text-gray-500">
  {{ "No documents required at this stage" | t }}
</div>
{% else %}
<ul class="divide-y divide-gray-200">
  {% for item in checklist %}
  <li class="p-4 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div class="w-6 h-6 rounded flex items-center justify-center
        {% if item.status == 'verified' %}bg-green-100 text-green-600
        {% elif item.status == 'uploaded' %}bg-blue-100 text-blue-600
        {% else %}bg-gray-100 text-gray-400{% endif %}">
        {% if item.status == 'verified' %}✓
        {% elif item.status == 'uploaded' %}↑
        {% else %}·{% endif %}
      </div>
      <div>
        <p class="text-sm font-medium text-gray-900">
          {{ item.label | t }}
          {% if item.required %}<span class="text-red-500">*</span>{% endif %}
        </p>
        <p class="text-xs text-gray-500">{{ item.description | t }}</p>
      </div>
    </div>
    <span class="text-xs font-medium px-2 py-1 rounded
      {% if item.status == 'verified' %}bg-green-100 text-green-700
      {% elif item.status == 'uploaded' %}bg-blue-100 text-blue-700
      {% else %}bg-gray-100 text-gray-500{% endif %}">
      {% if item.status == 'verified' %}{{ "Verified" | t }}
      {% elif item.status == 'uploaded' %}{{ "Uploaded" | t }}
      {% else %}{{ "Not Uploaded" | t }}{% endif %}
    </span>
  </li>
  {% endfor %}
</ul>
{% endif %}
```

Create `src/views/pages/seller/documents.njk`:

```nunjucks
{% extends "layouts/seller.njk" %}

{% block title %}{{ "Documents" | t }} — SellMyHouse.sg{% endblock %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Document Checklist" | t }}</h1>

<div class="bg-white rounded-lg shadow">
  {% include "partials/seller/document-checklist.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 7: Create tutorials-content partial and tutorials page**

Create `src/views/partials/seller/tutorials-content.njk`:

```nunjucks
{% if grouped | length == 0 %}
<div class="bg-white rounded-lg shadow p-6 text-center text-gray-500">
  {{ "No tutorials available yet" | t }}
</div>
{% else %}
<div class="space-y-8">
  {% for category, tutorials in grouped %}
  <div>
    <h2 class="text-lg font-semibold mb-4 capitalize">{{ category | t }}</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {% for tutorial in tutorials %}
      <div class="bg-white rounded-lg shadow overflow-hidden">
        <div class="aspect-video bg-gray-100">
          <iframe
            src="{{ tutorial.youtubeUrl }}"
            class="w-full h-full"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          ></iframe>
        </div>
        <div class="p-4">
          <h3 class="font-medium text-gray-900">{{ tutorial.title | t }}</h3>
          <p class="text-sm text-gray-500 mt-1">{{ tutorial.description | t }}</p>
        </div>
      </div>
      {% endfor %}
    </div>
  </div>
  {% endfor %}
</div>
{% endif %}
```

Create `src/views/pages/seller/tutorials.njk`:

```nunjucks
{% extends "layouts/seller.njk" %}

{% block title %}{{ "Video Tutorials" | t }} — SellMyHouse.sg{% endblock %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Video Tutorials" | t }}</h1>

{% include "partials/seller/tutorials-content.njk" %}
{% endblock %}
```

- [ ] **Step 8: Commit**

```bash
git add src/views/pages/seller/ src/views/partials/seller/
git commit -m "feat(seller): add dashboard, notifications, my-data, documents, and tutorials views with HTMX partials"
```

---

### Task 11: Register seller router in app factory

**Files:**
- Modify: `src/infra/http/app.ts`

- [ ] **Step 1: Add seller router import and registration**

In `src/infra/http/app.ts`:

1. Add import at the top with other router imports:
```typescript
import { sellerRouter } from '../../domains/seller/seller.router';
```

2. Add the seller router after the notification router (but before error handler):
```typescript
app.use(sellerRouter);
```

- [ ] **Step 2: Commit**

```bash
git add src/infra/http/app.ts
git commit -m "feat(seller): register seller router in Express app"
```

---

### Task 12: Integration tests

**Files:**
- Create: `tests/integration/seller-dashboard.test.ts`

- [ ] **Step 1: Write integration tests**

Create `tests/integration/seller-dashboard.test.ts`:

```typescript
import request from 'supertest';
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';
import { createApp } from '../../src/infra/http/app';

const app = createApp();

// Helper to create an authenticated seller session
async function authenticatedSeller(
  agent: request.SuperAgentTest,
  sellerOverrides?: Record<string, any>,
) {
  const seller = await factory.seller({
    email: 'test@test.local',
    passwordHash: '$2b$12$LJ3m4ys3Lf6jJv8qZzQGbeG2/j0HzRM7LCmHZxYkeyzQdBq1c6J.y', // "password123"
    ...sellerOverrides,
  });

  await agent
    .post('/auth/login/seller')
    .send({ email: 'test@test.local', password: 'password123' });

  return seller;
}

// Helper to create an authenticated agent session
async function authenticatedAgent(agent: request.SuperAgentTest) {
  const agentUser = await factory.agent({
    email: 'agent@test.local',
    passwordHash: '$2b$12$LJ3m4ys3Lf6jJv8qZzQGbeG2/j0HzRM7LCmHZxYkeyzQdBq1c6J.y', // "password123"
  });

  await agent
    .post('/auth/login/agent')
    .send({ email: 'agent@test.local', password: 'password123' });

  return agentUser;
}

describe('Seller Dashboard Integration', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe('GET /seller/dashboard', () => {
    it('redirects unauthenticated users to login', async () => {
      const res = await request(app).get('/seller/dashboard');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/auth/login');
    });

    it('rejects authenticated agent from accessing seller routes', async () => {
      const agent = request.agent(app);
      await authenticatedAgent(agent);

      const res = await agent.get('/seller/dashboard');
      expect(res.status).toBe(403);
    });

    it('redirects to onboarding when not complete', async () => {
      const agent = request.agent(app);
      await authenticatedSeller(agent, { onboardingStep: 2 });

      const res = await agent.get('/seller/dashboard');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/seller/onboarding');
    });

    it('renders dashboard when onboarding is complete', async () => {
      const agent = request.agent(app);
      await authenticatedSeller(agent, { onboardingStep: 5 });

      const res = await agent.get('/seller/dashboard');
      expect(res.status).toBe(200);
    });
  });

  describe('Onboarding flow', () => {
    it('completes full onboarding sequence', async () => {
      const agent = request.agent(app);
      const seller = await authenticatedSeller(agent, { onboardingStep: 0 });

      // Complete steps 1-5
      for (let step = 1; step <= 5; step++) {
        const res = await agent
          .post(`/seller/onboarding/step/${step}`)
          .set('HX-Request', 'true');
        expect(res.status).toBe(200);
      }

      // Verify seller is now onboarded
      const updated = await testPrisma.seller.findUnique({
        where: { id: seller.id },
      });
      expect(updated?.onboardingStep).toBe(5);
    });

    it('rejects skipping steps', async () => {
      const agent = request.agent(app);
      await authenticatedSeller(agent, { onboardingStep: 1 });

      const res = await agent
        .post('/seller/onboarding/step/3')
        .set('HX-Request', 'true');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /seller/my-data', () => {
    it('renders personal data and consent status', async () => {
      const agent = request.agent(app);
      await authenticatedSeller(agent, {
        onboardingStep: 5,
        consentService: true,
        consentMarketing: false,
      });

      const res = await agent.get('/seller/my-data');
      expect(res.status).toBe(200);
    });
  });

  describe('HTMX partial responses', () => {
    it('returns partial for HX-Request on onboarding step', async () => {
      const agent = request.agent(app);
      await authenticatedSeller(agent, { onboardingStep: 0 });

      const res = await agent
        .get('/seller/onboarding/step/1')
        .set('HX-Request', 'true');
      expect(res.status).toBe(200);
      // Should be a partial, not a full page
      expect(res.text).not.toContain('<!DOCTYPE');
    });
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npm run test:integration -- --testPathPattern=seller-dashboard`

Expected: All tests pass (requires test DB via `npm run docker:test:db`).

- [ ] **Step 3: Run all tests to ensure no regressions**

Run: `npm test && npm run test:integration`

Expected: All existing + new tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/seller-dashboard.test.ts
git commit -m "test(seller): add integration tests for dashboard and onboarding flow"
```

---

### Task 13: Final verification and cleanup

- [ ] **Step 1: Run lint**

Run: `npm run lint`

Fix any lint errors.

- [ ] **Step 2: Run format**

Run: `npm run format`

- [ ] **Step 3: Run full test suite**

Run: `npm test && npm run test:integration`

Expected: All tests pass.

- [ ] **Step 4: Final commit if any fixes**

```bash
git add -A
git commit -m "style: fix lint and format for Phase 2A seller dashboard"
```
