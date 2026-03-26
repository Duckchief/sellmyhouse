# Phase 4 SP1: Offer Domain + Portal Formatter — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the offer negotiation domain (recording offers, counter-offer chains, AI-assisted market analysis) and portal-ready listing formatter (generates PropertyGuru/99.co/SRX content for manual posting).

**Architecture:** New `offer` domain following the standard domain pattern (types → repository → service → router → validator). Portal formatter is a pure function added to the `property` domain alongside a thin `portal.service.ts`. Review service wired to auto-generate portal content when a listing is fully approved.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks/HTMX, Jest (unit + integration), AI facade (`@/domains/shared/ai/ai.facade`), `node-cron` (not used in SP1), HDB repository for market comps.

**Spec:** `docs/superpowers/specs/2026-03-11-phase-4-transaction-management-design.md` (Sections 1–3)

**Run tests after each section:** `npm test` (unit), `npm run test:integration` (integration)

---

## Chunk 1: Foundation — Schema, Seed, Types, Factory

### Task 1: Schema migration — add AI analysis fields to Offer model

**Files:**
- Modify: `prisma/schema.prisma`
- Run: `npm run db:migrate`

The `Offer` model needs four new nullable fields for AI-assisted offer analysis.

- [ ] **Step 1: Add fields to Offer model in schema**

Open `prisma/schema.prisma`. Find the `model Offer` block. Add these four fields before the `@@index` line:

```prisma
  aiAnalysis         String?   @map("ai_analysis")
  aiAnalysisProvider String?   @map("ai_analysis_provider")
  aiAnalysisModel    String?   @map("ai_analysis_model")
  aiAnalysisStatus   String?   @map("ai_analysis_status")
```

- [ ] **Step 2: Run migration**

```bash
npm run db:migrate
```

When prompted, name the migration: `add_offer_ai_analysis_fields`

Expected: migration created and applied with no errors.

- [ ] **Step 3: Verify Prisma client regenerated**

```bash
npx prisma generate
```

Expected: `✔ Generated Prisma Client` with no errors.

- [ ] **Step 4: Run existing tests to confirm nothing broke**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add AI analysis fields to Offer model"
```

---

### Task 2: Settings — add new keys to SETTING_KEYS + fix seed

**Files:**
- Modify: `src/domains/shared/settings.types.ts`
- Modify: `prisma/seeds/system-settings.ts`

Two issues to fix: (1) the seed uses `commission_gst_rate` but the code reads `gst_rate` — align the seed to match the code; (2) add missing keys for Phase 4.

- [ ] **Step 1: Add AGENCY_NAME, AGENCY_LICENCE, OFFER_AI_ANALYSIS_ENABLED to SETTING_KEYS**

In `src/domains/shared/settings.types.ts`, add to the `SETTING_KEYS` object:

```typescript
  AGENCY_NAME: 'agency_name',
  AGENCY_LICENCE: 'agency_licence',
  OFFER_AI_ANALYSIS_ENABLED: 'offer_ai_analysis_enabled',
```

- [ ] **Step 2: Fix the seed — rename `commission_gst_rate` to `gst_rate` and add missing keys**

In `prisma/seeds/system-settings.ts`, replace the SETTINGS array:

```typescript
const SETTINGS = [
  { key: 'commission_amount', value: '1499', description: 'Fixed commission amount in SGD' },
  { key: 'gst_rate', value: '0.09', description: 'GST rate applied to commission' },
  { key: 'ai_provider', value: 'anthropic', description: 'Active AI provider (anthropic, openai, google)' },
  { key: 'ai_model', value: 'claude-sonnet-4-20250514', description: 'Active AI model identifier' },
  { key: 'platform_name', value: 'SellMyHouse.sg', description: 'Platform display name' },
  { key: 'agency_name', value: 'Huttons Asia Pte Ltd', description: 'Agency name for CEA compliance' },
  { key: 'agency_licence', value: 'L3008899K', description: 'CEA agency licence number' },
  { key: 'support_email', value: 'support@sellmyhouse.sg', description: 'Platform support email' },
  { key: 'support_phone', value: '+6591234567', description: 'Platform support phone (placeholder)' },
  { key: 'offer_ai_analysis_enabled', value: 'true', description: 'Enable AI narrative generation on offer creation' },
  { key: 'otp_exercise_days', value: '21', description: 'Calendar days from OTP issuance to exercise deadline' },
];
```

Note: the key changes from `commission_gst_rate` to `gst_rate`. The upsert is keyed on the `key` column, so updating the seed alone leaves any existing `commission_gst_rate` row in the database. Add an explicit delete step below.

- [ ] **Step 2b: Add a migration to remove the stale `commission_gst_rate` row**

Create a new Prisma migration file manually or via `npx prisma migrate dev --name remove_stale_gst_rate_key`. In the migration SQL:

```sql
DELETE FROM system_settings WHERE key = 'commission_gst_rate';
```

This ensures any existing database (dev, test, staging) has only the `gst_rate` row after the migration runs.

> **SP2 note:** The Phase 4 spec Section 5 (commission invoice) references `commission_gst_rate` — that is the pre-migration key name. SP2's `transaction.service.ts` must read `gst_rate` (already the correct key in settings.service). Do not use `commission_gst_rate` anywhere after this migration runs.

- [ ] **Step 3: Run unit tests to confirm SETTING_KEYS compiles**

```bash
npm test -- --testPathPattern="settings"
```

Expected: all settings tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/domains/shared/settings.types.ts prisma/seeds/system-settings.ts prisma/migrations/
git commit -m "feat(settings): add agency_name, agency_licence, offer_ai_analysis_enabled keys; fix gst_rate seed key"
```

---

### Task 3: Offer types and state machine constant

**Files:**
- Create: `src/domains/offer/offer.types.ts`

- [ ] **Step 1: Create offer types file**

```typescript
// src/domains/offer/offer.types.ts
import type { OfferStatus } from '@prisma/client';

export type { OfferStatus };

// Valid transitions for offer status state machine
// Only 'pending' offers can be actioned — countered/accepted/rejected are terminal
export const OFFER_TRANSITIONS: Record<OfferStatus, OfferStatus[]> = {
  pending: ['countered', 'accepted', 'rejected', 'expired'],
  countered: [],   // countered offers can't be directly transitioned — a new child offer is created
  accepted: [],
  rejected: [],
  expired: [],
};

// AI analysis status values (domain-specific HITL flow: generated → reviewed → shared)
// Maps to CLAUDE.md canonical: ai_generated → pending_review → approved → sent
export const AI_ANALYSIS_STATUS = {
  GENERATED: 'generated',
  REVIEWED: 'reviewed',
  SHARED: 'shared',
} as const;

export type AiAnalysisStatus = (typeof AI_ANALYSIS_STATUS)[keyof typeof AI_ANALYSIS_STATUS];

export interface CreateOfferInput {
  propertyId: string;
  buyerName: string;
  buyerPhone: string;
  buyerAgentName?: string;
  buyerAgentCeaReg?: string;
  isCoBroke: boolean;
  offerAmount: number;
  notes?: string;
  agentId: string;
}

export interface CounterOfferInput {
  parentOfferId: string;
  counterAmount: number;
  notes?: string;
  agentId: string;
}

export interface OfferWithChain {
  id: string;
  propertyId: string;
  buyerName: string;
  buyerPhone: string;
  buyerAgentName: string | null;
  buyerAgentCeaReg: string | null;
  isCoBroke: boolean;
  offerAmount: string; // Prisma Decimal serializes as string
  counterAmount: string | null;
  status: OfferStatus;
  notes: string | null;
  parentOfferId: string | null;
  aiAnalysis: string | null;
  aiAnalysisProvider: string | null;
  aiAnalysisModel: string | null;
  aiAnalysisStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
  counterOffers: OfferWithChain[];
}
```

- [ ] **Step 2: Run TypeScript compilation to verify**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/domains/offer/offer.types.ts
git commit -m "feat(offer): add offer types and state machine constants"
```

---

### Task 4: Offer repository + test factory

**Files:**
- Create: `src/domains/offer/offer.repository.ts`
- Modify: `tests/fixtures/factory.ts`

- [ ] **Step 1: Write the failing repository test first**

Create `src/domains/offer/__tests__/offer.repository.test.ts`:

```typescript
// src/domains/offer/__tests__/offer.repository.test.ts
import { factory } from '../../../tests/fixtures/factory';
import { testPrisma } from '../../../tests/helpers/prisma';
import * as offerRepo from '../offer.repository';
import { createId } from '@paralleldrive/cuid2';

describe('offer.repository', () => {
  let agentId: string;
  let sellerId: string;
  let propertyId: string;

  beforeEach(async () => {
    await testPrisma.offer.deleteMany();
    await testPrisma.property.deleteMany();
    await testPrisma.seller.deleteMany();
    await testPrisma.agent.deleteMany();

    const agent = await factory.agent();
    agentId = agent.id;
    const seller = await factory.seller({ agentId });
    sellerId = seller.id;
    const property = await factory.property({ sellerId });
    propertyId = property.id;
  });

  describe('create', () => {
    it('creates an offer record', async () => {
      const id = createId();
      const offer = await offerRepo.create({
        id,
        propertyId,
        buyerName: 'John Doe',
        buyerPhone: '91234567',
        isCoBroke: false,
        offerAmount: 600000,
      });
      expect(offer.id).toBe(id);
      expect(offer.status).toBe('pending');
      expect(offer.propertyId).toBe(propertyId);
    });
  });

  describe('findById', () => {
    it('returns offer by id', async () => {
      const created = await factory.offer({ propertyId });
      const found = await offerRepo.findById(created.id);
      expect(found?.id).toBe(created.id);
    });

    it('returns null for unknown id', async () => {
      const found = await offerRepo.findById('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findByPropertyId', () => {
    it('returns all offers for a property including counter-offer chain', async () => {
      const offer1 = await factory.offer({ propertyId });
      const offer2 = await factory.offer({ propertyId });
      const results = await offerRepo.findByPropertyId(propertyId);
      expect(results.length).toBeGreaterThanOrEqual(2);
      const ids = results.map((o) => o.id);
      expect(ids).toContain(offer1.id);
      expect(ids).toContain(offer2.id);
    });

    it('returns empty array for property with no offers', async () => {
      const results = await offerRepo.findByPropertyId(propertyId);
      expect(results).toEqual([]);
    });
  });

  describe('updateStatus', () => {
    it('updates offer status', async () => {
      const offer = await factory.offer({ propertyId });
      const updated = await offerRepo.updateStatus(offer.id, 'accepted');
      expect(updated.status).toBe('accepted');
    });
  });

  describe('updateAiAnalysis', () => {
    it('stores AI analysis data on offer', async () => {
      const offer = await factory.offer({ propertyId });
      const updated = await offerRepo.updateAiAnalysis(offer.id, {
        aiAnalysis: 'This offer is below market median.',
        aiAnalysisProvider: 'anthropic',
        aiAnalysisModel: 'claude-sonnet-4-20250514',
        aiAnalysisStatus: 'generated',
      });
      expect(updated.aiAnalysis).toBe('This offer is below market median.');
      expect(updated.aiAnalysisStatus).toBe('generated');
    });
  });

  describe('expirePendingAndCounteredSiblings', () => {
    it('sets all pending and countered siblings to expired', async () => {
      const pending1 = await factory.offer({ propertyId, status: 'pending' });
      const pending2 = await factory.offer({ propertyId, status: 'pending' });
      const countered = await factory.offer({ propertyId, status: 'countered' });
      const rejected = await factory.offer({ propertyId, status: 'rejected' });

      await offerRepo.expirePendingAndCounteredSiblings(propertyId, pending1.id);

      const updated2 = await offerRepo.findById(pending2.id);
      const updatedCountered = await offerRepo.findById(countered.id);
      const updatedRejected = await offerRepo.findById(rejected.id);

      expect(updated2?.status).toBe('expired');
      expect(updatedCountered?.status).toBe('expired');
      expect(updatedRejected?.status).toBe('rejected'); // not changed
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test:integration -- --testPathPattern="offer.repository" --runInBand
```

Expected: FAIL — module `offer.repository` not found, factory.offer missing.

- [ ] **Step 3: Add factory.offer to test fixtures**

In `tests/fixtures/factory.ts`, add after the `listing` factory method:

```typescript
  async offer(overrides: {
    propertyId: string;
    buyerName?: string;
    buyerPhone?: string;
    buyerAgentName?: string;
    buyerAgentCeaReg?: string;
    isCoBroke?: boolean;
    offerAmount?: number;
    status?: 'pending' | 'countered' | 'accepted' | 'rejected' | 'expired';
    notes?: string;
    parentOfferId?: string;
    counterAmount?: number;
  }) {
    return testPrisma.offer.create({
      data: {
        id: createId(),
        propertyId: overrides.propertyId,
        buyerName: overrides.buyerName ?? 'Test Buyer',
        buyerPhone: overrides.buyerPhone ?? '91234567',
        buyerAgentName: overrides.buyerAgentName ?? null,
        buyerAgentCeaReg: overrides.buyerAgentCeaReg ?? null,
        isCoBroke: overrides.isCoBroke ?? false,
        offerAmount: overrides.offerAmount ?? 600000,
        status: overrides.status ?? 'pending',
        notes: overrides.notes ?? null,
        parentOfferId: overrides.parentOfferId ?? null,
        counterAmount: overrides.counterAmount ?? null,
      },
    });
  },
```

- [ ] **Step 4: Create the offer repository**

Create `src/domains/offer/offer.repository.ts`:

```typescript
// src/domains/offer/offer.repository.ts
import { prisma } from '@/infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';
import type { OfferStatus } from '@prisma/client';

interface CreateOfferData {
  id?: string;
  propertyId: string;
  buyerName: string;
  buyerPhone: string;
  buyerAgentName?: string | null;
  buyerAgentCeaReg?: string | null;
  isCoBroke?: boolean;
  offerAmount: number;
  notes?: string | null;
  parentOfferId?: string | null;
  counterAmount?: number | null;
}

interface UpdateAiAnalysisData {
  aiAnalysis: string;
  aiAnalysisProvider: string;
  aiAnalysisModel: string;
  aiAnalysisStatus: string;
}

export async function create(data: CreateOfferData) {
  return prisma.offer.create({
    data: {
      id: data.id ?? createId(),
      propertyId: data.propertyId,
      buyerName: data.buyerName,
      buyerPhone: data.buyerPhone,
      buyerAgentName: data.buyerAgentName ?? null,
      buyerAgentCeaReg: data.buyerAgentCeaReg ?? null,
      isCoBroke: data.isCoBroke ?? false,
      offerAmount: data.offerAmount,
      notes: data.notes ?? null,
      parentOfferId: data.parentOfferId ?? null,
      counterAmount: data.counterAmount ?? null,
    },
  });
}

export async function findById(id: string) {
  return prisma.offer.findUnique({ where: { id } });
}

export async function findByPropertyId(propertyId: string) {
  return prisma.offer.findMany({
    where: { propertyId },
    orderBy: { createdAt: 'asc' },
    include: {
      counterOffers: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function updateStatus(id: string, status: OfferStatus) {
  return prisma.offer.update({ where: { id }, data: { status } });
}

export async function updateAiAnalysis(id: string, data: UpdateAiAnalysisData) {
  return prisma.offer.update({
    where: { id },
    data: {
      aiAnalysis: data.aiAnalysis,
      aiAnalysisProvider: data.aiAnalysisProvider,
      aiAnalysisModel: data.aiAnalysisModel,
      aiAnalysisStatus: data.aiAnalysisStatus,
    },
  });
}

/**
 * Expires all pending and countered offers for a property, except the accepted one.
 * Called when an offer is accepted — closes all other open negotiation threads.
 */
export async function expirePendingAndCounteredSiblings(propertyId: string, exceptOfferId: string) {
  return prisma.offer.updateMany({
    where: {
      propertyId,
      id: { not: exceptOfferId },
      status: { in: ['pending', 'countered'] },
    },
    data: { status: 'expired' },
  });
}
```

- [ ] **Step 5: Run the repository test**

```bash
npm run test:integration -- --testPathPattern="offer.repository" --runInBand
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/domains/offer/offer.repository.ts src/domains/offer/__tests__/offer.repository.test.ts tests/fixtures/factory.ts
git commit -m "feat(offer): add offer repository with CRUD and sibling expiry"
```

---

## Chunk 2: Offer Service — Core Logic and AI Analysis

### Task 5: Offer service — core negotiation logic (no AI)

**Files:**
- Create: `src/domains/offer/offer.service.ts`
- Create: `src/domains/offer/__tests__/offer.service.test.ts`

- [ ] **Step 1: Write failing unit tests for core offer service**

Create `src/domains/offer/__tests__/offer.service.test.ts`:

```typescript
// src/domains/offer/__tests__/offer.service.test.ts
import * as offerService from '../offer.service';
import * as offerRepo from '../offer.repository';
import * as hdbRepo from '@/domains/hdb/repository';
import * as aiFacade from '@/domains/shared/ai/ai.facade';
import * as settingsService from '@/domains/shared/settings.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as auditService from '@/domains/shared/audit.service';
import { ValidationError, NotFoundError } from '@/domains/shared/errors';

// Mock all dependencies
jest.mock('../offer.repository');
jest.mock('@/domains/hdb/repository');
jest.mock('@/domains/shared/ai/ai.facade');
jest.mock('@/domains/shared/settings.service');
jest.mock('@/domains/notification/notification.service');
jest.mock('@/domains/shared/audit.service');

const mockOfferRepo = jest.mocked(offerRepo);
const mockHdbRepo = jest.mocked(hdbRepo);
const mockAiFacade = jest.mocked(aiFacade);
const mockSettings = jest.mocked(settingsService);
const mockNotification = jest.mocked(notificationService);
const mockAudit = jest.mocked(auditService);

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    propertyId: 'property-1',
    buyerName: 'Test Buyer',
    buyerPhone: '91234567',
    buyerAgentName: null,
    buyerAgentCeaReg: null,
    isCoBroke: false,
    offerAmount: '600000',
    counterAmount: null,
    status: 'pending' as const,
    notes: null,
    parentOfferId: null,
    aiAnalysis: null,
    aiAnalysisProvider: null,
    aiAnalysisModel: null,
    aiAnalysisStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('offer.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.getBoolean.mockResolvedValue(false); // AI disabled by default in tests
    mockSettings.get.mockResolvedValue('anthropic');
    mockAudit.log.mockResolvedValue(undefined as never);
    mockNotification.send.mockResolvedValue(undefined as never);
    mockHdbRepo.findRecentByTownAndFlatType.mockResolvedValue([]);
  });

  describe('createOffer', () => {
    it('creates an offer and notifies the seller', async () => {
      const newOffer = makeOffer();
      mockOfferRepo.create.mockResolvedValue(newOffer as never);
      mockOfferRepo.findById.mockResolvedValue(newOffer as never);

      const result = await offerService.createOffer({
        propertyId: 'property-1',
        sellerId: 'seller-1',
        buyerName: 'Test Buyer',
        buyerPhone: '91234567',
        isCoBroke: false,
        offerAmount: 600000,
        agentId: 'agent-1',
        town: 'TAMPINES',
        flatType: '4 ROOM',
      });

      expect(mockOfferRepo.create).toHaveBeenCalledTimes(1);
      expect(mockNotification.send).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('offer-1');
    });

    it('does not generate AI analysis when offer_ai_analysis_enabled is false', async () => {
      mockSettings.getBoolean.mockResolvedValue(false);
      const newOffer = makeOffer();
      mockOfferRepo.create.mockResolvedValue(newOffer as never);
      mockOfferRepo.findById.mockResolvedValue(newOffer as never);

      await offerService.createOffer({
        propertyId: 'property-1',
        sellerId: 'seller-1',
        buyerName: 'Test Buyer',
        buyerPhone: '91234567',
        isCoBroke: false,
        offerAmount: 600000,
        agentId: 'agent-1',
        town: 'TAMPINES',
        flatType: '4 ROOM',
      });

      expect(mockAiFacade.generateText).not.toHaveBeenCalled();
    });

    it('generates AI analysis when offer_ai_analysis_enabled is true', async () => {
      mockSettings.getBoolean.mockResolvedValue(true);
      const newOffer = makeOffer();
      mockOfferRepo.create.mockResolvedValue(newOffer as never);
      mockOfferRepo.findById.mockResolvedValue(newOffer as never);
      mockHdbRepo.findRecentByTownAndFlatType.mockResolvedValue([
        { resalePrice: 580000 } as never,
        { resalePrice: 620000 } as never,
      ]);
      mockAiFacade.generateText.mockResolvedValue({
        text: 'This offer is below market median.',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      });
      mockOfferRepo.updateAiAnalysis.mockResolvedValue(makeOffer({ aiAnalysisStatus: 'generated' }) as never);

      await offerService.createOffer({
        propertyId: 'property-1',
        sellerId: 'seller-1',
        buyerName: 'Test Buyer',
        buyerPhone: '91234567',
        isCoBroke: false,
        offerAmount: 600000,
        agentId: 'agent-1',
        town: 'TAMPINES',
        flatType: '4 ROOM',
      });

      expect(mockAiFacade.generateText).toHaveBeenCalledTimes(1);
      expect(mockOfferRepo.updateAiAnalysis).toHaveBeenCalledWith(
        'offer-1',
        expect.objectContaining({ aiAnalysisStatus: 'generated' }),
      );
    });
  });

  describe('counterOffer', () => {
    it('creates a child offer and sets parent status to countered', async () => {
      const parent = makeOffer({ id: 'offer-1', status: 'pending' });
      const child = makeOffer({ id: 'offer-2', parentOfferId: 'offer-1', counterAmount: '650000' });
      mockOfferRepo.findById.mockResolvedValue(parent as never);
      mockOfferRepo.create.mockResolvedValue(child as never);
      mockOfferRepo.updateStatus.mockResolvedValue({ ...parent, status: 'countered' } as never);

      await offerService.counterOffer({
        parentOfferId: 'offer-1',
        counterAmount: 650000,
        agentId: 'agent-1',
      });

      expect(mockOfferRepo.updateStatus).toHaveBeenCalledWith('offer-1', 'countered');
      expect(mockOfferRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ parentOfferId: 'offer-1', counterAmount: 650000 }),
      );
    });

    it('throws ValidationError when trying to counter a non-pending offer', async () => {
      const accepted = makeOffer({ status: 'accepted' });
      mockOfferRepo.findById.mockResolvedValue(accepted as never);

      await expect(
        offerService.counterOffer({ parentOfferId: 'offer-1', counterAmount: 650000, agentId: 'agent-1' }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws NotFoundError for unknown offer id', async () => {
      mockOfferRepo.findById.mockResolvedValue(null);

      await expect(
        offerService.counterOffer({ parentOfferId: 'bad-id', counterAmount: 650000, agentId: 'agent-1' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('acceptOffer', () => {
    it('accepts offer and expires pending/countered siblings', async () => {
      const offer = makeOffer({ status: 'pending' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockOfferRepo.updateStatus.mockResolvedValue({ ...offer, status: 'accepted' } as never);
      mockOfferRepo.expirePendingAndCounteredSiblings.mockResolvedValue({ count: 2 } as never);

      await offerService.acceptOffer({ offerId: 'offer-1', agentId: 'agent-1' });

      expect(mockOfferRepo.updateStatus).toHaveBeenCalledWith('offer-1', 'accepted');
      expect(mockOfferRepo.expirePendingAndCounteredSiblings).toHaveBeenCalledWith('property-1', 'offer-1');
    });

    it('throws ValidationError when trying to accept a non-pending offer', async () => {
      const rejected = makeOffer({ status: 'rejected' });
      mockOfferRepo.findById.mockResolvedValue(rejected as never);

      await expect(
        offerService.acceptOffer({ offerId: 'offer-1', agentId: 'agent-1' }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('rejectOffer', () => {
    it('rejects a pending offer', async () => {
      const offer = makeOffer({ status: 'pending' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockOfferRepo.updateStatus.mockResolvedValue({ ...offer, status: 'rejected' } as never);

      await offerService.rejectOffer({ offerId: 'offer-1', agentId: 'agent-1' });

      expect(mockOfferRepo.updateStatus).toHaveBeenCalledWith('offer-1', 'rejected');
    });
  });

  describe('reviewAiAnalysis', () => {
    it('sets aiAnalysisStatus to reviewed', async () => {
      const offer = makeOffer({ aiAnalysis: 'some analysis', aiAnalysisStatus: 'generated' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockOfferRepo.updateAiAnalysis.mockResolvedValue({ ...offer, aiAnalysisStatus: 'reviewed' } as never);

      await offerService.reviewAiAnalysis({ offerId: 'offer-1', agentId: 'agent-1' });

      expect(mockOfferRepo.updateAiAnalysis).toHaveBeenCalledWith(
        'offer-1',
        expect.objectContaining({ aiAnalysisStatus: 'reviewed' }),
      );
    });

    it('throws ValidationError if no AI analysis to review', async () => {
      const offer = makeOffer({ aiAnalysis: null, aiAnalysisStatus: null });
      mockOfferRepo.findById.mockResolvedValue(offer as never);

      await expect(
        offerService.reviewAiAnalysis({ offerId: 'offer-1', agentId: 'agent-1' }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('shareAiAnalysis', () => {
    it('shares analysis after it has been reviewed', async () => {
      const offer = makeOffer({ aiAnalysis: 'some analysis', aiAnalysisStatus: 'reviewed' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockOfferRepo.updateAiAnalysis.mockResolvedValue({ ...offer, aiAnalysisStatus: 'shared' } as never);

      await offerService.shareAiAnalysis({ offerId: 'offer-1', agentId: 'agent-1', sellerId: 'seller-1' });

      expect(mockOfferRepo.updateAiAnalysis).toHaveBeenCalledWith(
        'offer-1',
        expect.objectContaining({ aiAnalysisStatus: 'shared' }),
      );
      expect(mockNotification.send).toHaveBeenCalledTimes(1);
    });

    it('throws ValidationError if analysis is not yet reviewed', async () => {
      const offer = makeOffer({ aiAnalysis: 'some analysis', aiAnalysisStatus: 'generated' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);

      await expect(
        offerService.shareAiAnalysis({ offerId: 'offer-1', agentId: 'agent-1', sellerId: 'seller-1' }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError if no analysis exists', async () => {
      const offer = makeOffer({ aiAnalysis: null });
      mockOfferRepo.findById.mockResolvedValue(offer as never);

      await expect(
        offerService.shareAiAnalysis({ offerId: 'offer-1', agentId: 'agent-1', sellerId: 'seller-1' }),
      ).rejects.toThrow(ValidationError);
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern="offer.service"
```

Expected: FAIL — `offer.service` module not found.

- [ ] **Step 3: Create offer service**

Also need to check what HDB repo method exists for fetching recent transactions. Look at `src/domains/hdb/repository.ts` — the method is likely `findRecentByTownAndFlatType`. If the name differs, use the actual name.

Create `src/domains/offer/offer.service.ts`:

```typescript
// src/domains/offer/offer.service.ts
import { createId } from '@paralleldrive/cuid2';
import * as offerRepo from './offer.repository';
import * as hdbRepo from '@/domains/hdb/repository';
import * as aiFacade from '@/domains/shared/ai/ai.facade';
import * as settingsService from '@/domains/shared/settings.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as auditService from '@/domains/shared/audit.service';
import { NotFoundError, ValidationError } from '@/domains/shared/errors';
import { OFFER_TRANSITIONS, AI_ANALYSIS_STATUS } from './offer.types';
import type { CreateOfferInput, CounterOfferInput } from './offer.types';

export interface CreateOfferServiceInput extends CreateOfferInput {
  sellerId: string;
  town: string;
  flatType: string;
}

function buildOfferAnalysisPrompt(params: {
  offerAmount: number;
  town: string;
  flatType: string;
  recentPrices: number[];
}): string {
  const { offerAmount, town, flatType, recentPrices } = params;
  const sorted = [...recentPrices].sort((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  return [
    `You are a Singapore HDB real estate assistant for SellMyHouse.sg.`,
    `Analyse this offer for context, focusing on market positioning.`,
    ``,
    `Property: ${flatType} flat in ${town}`,
    `Offer amount: $${offerAmount.toLocaleString()}`,
    `Recent 12-month transactions (${sorted.length} records): ` +
      (median
        ? `median $${median.toLocaleString()}, range $${min?.toLocaleString()}–$${max?.toLocaleString()}`
        : 'insufficient data'),
    ``,
    `Write 2–3 concise sentences explaining how this offer compares to the market.`,
    `Use a neutral, professional tone. Do not provide financial advice.`,
    `End with: "This is indicative only based on public HDB data. It does not constitute financial or legal advice."`,
  ].join('\n');
}

export async function createOffer(input: CreateOfferServiceInput) {
  const offerId = createId();

  const offer = await offerRepo.create({
    id: offerId,
    propertyId: input.propertyId,
    buyerName: input.buyerName,
    buyerPhone: input.buyerPhone,
    buyerAgentName: input.buyerAgentName ?? null,
    buyerAgentCeaReg: input.buyerAgentCeaReg ?? null,
    isCoBroke: input.isCoBroke,
    offerAmount: input.offerAmount,
    notes: input.notes ?? null,
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'offer.created',
    entityType: 'offer',
    entityId: offerId,
    details: { propertyId: input.propertyId, offerAmount: input.offerAmount },
  });

  // Notify seller of new offer
  // Second argument is agentId — required by notificationService.send signature
  await notificationService.send({
    recipientType: 'seller',
    recipientId: input.sellerId,
    templateName: 'offer_received',
    templateData: {
      buyerName: input.buyerName,
      offerAmount: input.offerAmount,
    },
  }, input.agentId);

  // Attempt AI analysis if enabled
  const aiEnabled = await settingsService.getBoolean('offer_ai_analysis_enabled', false);
  if (aiEnabled) {
    try {
      const recentTransactions = await hdbRepo.findRecentByTownAndFlatType(input.town, input.flatType);
      const recentPrices = recentTransactions.map((t) => Number(t.resalePrice));
      const prompt = buildOfferAnalysisPrompt({
        offerAmount: input.offerAmount,
        town: input.town,
        flatType: input.flatType,
        recentPrices,
      });
      const result = await aiFacade.generateText(prompt);
      await offerRepo.updateAiAnalysis(offerId, {
        aiAnalysis: result.text,
        aiAnalysisProvider: result.provider,
        aiAnalysisModel: result.model,
        aiAnalysisStatus: AI_ANALYSIS_STATUS.GENERATED,
      });
    } catch {
      // AI analysis failure is non-fatal — offer is still recorded
    }
  }

  return offer;
}

export async function counterOffer(input: CounterOfferInput) {
  const parent = await offerRepo.findById(input.parentOfferId);
  if (!parent) throw new NotFoundError('Offer', input.parentOfferId);

  const allowed = OFFER_TRANSITIONS[parent.status];
  if (!allowed.includes('countered')) {
    throw new ValidationError(`Cannot counter an offer with status '${parent.status}'`);
  }

  const childId = createId();
  const [child] = await Promise.all([
    offerRepo.create({
      id: childId,
      propertyId: parent.propertyId,
      buyerName: parent.buyerName,
      buyerPhone: parent.buyerPhone,
      buyerAgentName: parent.buyerAgentName,
      buyerAgentCeaReg: parent.buyerAgentCeaReg,
      isCoBroke: parent.isCoBroke,
      offerAmount: Number(parent.offerAmount),
      counterAmount: input.counterAmount,
      notes: input.notes ?? null,
      parentOfferId: input.parentOfferId,
    }),
    offerRepo.updateStatus(input.parentOfferId, 'countered'),
  ]);

  await auditService.log({
    agentId: input.agentId,
    action: 'offer.countered',
    entityType: 'offer',
    entityId: childId,
    details: { parentOfferId: input.parentOfferId, counterAmount: input.counterAmount },
  });

  return child;
}

export async function acceptOffer(input: { offerId: string; agentId: string }) {
  const offer = await offerRepo.findById(input.offerId);
  if (!offer) throw new NotFoundError('Offer', input.offerId);

  const allowed = OFFER_TRANSITIONS[offer.status];
  if (!allowed.includes('accepted')) {
    throw new ValidationError(`Cannot accept an offer with status '${offer.status}'`);
  }

  const [updated] = await Promise.all([
    offerRepo.updateStatus(input.offerId, 'accepted'),
    offerRepo.expirePendingAndCounteredSiblings(offer.propertyId, input.offerId),
  ]);

  await auditService.log({
    agentId: input.agentId,
    action: 'offer.accepted',
    entityType: 'offer',
    entityId: input.offerId,
    details: { propertyId: offer.propertyId },
  });

  return updated;
}

export async function rejectOffer(input: { offerId: string; agentId: string }) {
  const offer = await offerRepo.findById(input.offerId);
  if (!offer) throw new NotFoundError('Offer', input.offerId);

  const allowed = OFFER_TRANSITIONS[offer.status];
  if (!allowed.includes('rejected')) {
    throw new ValidationError(`Cannot reject an offer with status '${offer.status}'`);
  }

  const updated = await offerRepo.updateStatus(input.offerId, 'rejected');

  await auditService.log({
    agentId: input.agentId,
    action: 'offer.rejected',
    entityType: 'offer',
    entityId: input.offerId,
    details: {},
  });

  return updated;
}

export async function getOffersForProperty(propertyId: string) {
  return offerRepo.findByPropertyId(propertyId);
}

export async function reviewAiAnalysis(input: { offerId: string; agentId: string }) {
  const offer = await offerRepo.findById(input.offerId);
  if (!offer) throw new NotFoundError('Offer', input.offerId);

  if (!offer.aiAnalysis) {
    throw new ValidationError('No AI analysis exists for this offer');
  }

  const updated = await offerRepo.updateAiAnalysis(input.offerId, {
    aiAnalysis: offer.aiAnalysis,
    aiAnalysisProvider: offer.aiAnalysisProvider ?? '',
    aiAnalysisModel: offer.aiAnalysisModel ?? '',
    aiAnalysisStatus: AI_ANALYSIS_STATUS.REVIEWED,
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'offer.analysis_reviewed',
    entityType: 'offer',
    entityId: input.offerId,
    details: {},
  });

  return updated;
}

export async function shareAiAnalysis(input: {
  offerId: string;
  agentId: string;
  sellerId: string;
}) {
  const offer = await offerRepo.findById(input.offerId);
  if (!offer) throw new NotFoundError('Offer', input.offerId);

  if (!offer.aiAnalysis) {
    throw new ValidationError('No AI analysis exists for this offer');
  }
  if (offer.aiAnalysisStatus !== AI_ANALYSIS_STATUS.REVIEWED) {
    throw new ValidationError('AI analysis must be reviewed before sharing');
  }

  const updated = await offerRepo.updateAiAnalysis(input.offerId, {
    aiAnalysis: offer.aiAnalysis,
    aiAnalysisProvider: offer.aiAnalysisProvider ?? '',
    aiAnalysisModel: offer.aiAnalysisModel ?? '',
    aiAnalysisStatus: AI_ANALYSIS_STATUS.SHARED,
  });

  await notificationService.send({
    recipientType: 'seller',
    recipientId: input.sellerId,
    templateName: 'offer_analysis_shared',
    templateData: { analysis: offer.aiAnalysis },
  }, input.agentId);

  await auditService.log({
    agentId: input.agentId,
    action: 'offer.analysis_shared',
    entityType: 'offer',
    entityId: input.offerId,
    details: {},
  });

  return updated;
}
```

- [ ] **Step 4: Add `findRecentByTownAndFlatType` to HDB repository**

**Important:** `src/domains/hdb/repository.ts` exports a class `HdbRepository` — the existing methods are class instance methods. The offer service needs a standalone exported function (not a class method) so it can be imported as `import * as hdbRepo from '@/domains/hdb/repository'` and mocked cleanly with `jest.mock`.

Check if the function already exists at module level:
```bash
grep -n "export async function findRecentByTownAndFlatType" src/domains/hdb/repository.ts
```

If it does not exist, add this standalone exported function at the **bottom** of `src/domains/hdb/repository.ts` (after the class definition, not inside it):

```typescript
/**
 * Standalone export for use by other domains (not part of HdbRepository class).
 * Returns HDB transactions from the last 12 months for market comparison.
 */
export async function findRecentByTownAndFlatType(town: string, flatType: string) {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const cutoffMonth = twelveMonthsAgo.toISOString().slice(0, 7); // 'YYYY-MM'

  return prisma.hdbTransaction.findMany({
    where: {
      town: town.toUpperCase(),
      flatType: flatType.toUpperCase(),
      month: { gte: cutoffMonth },
    },
    orderBy: { month: 'desc' },
    take: 50,
  });
}
```

- [ ] **Step 5: Run tests to confirm they now pass**

```bash
npm test -- --testPathPattern="offer.service"
```

Expected: all offer service tests pass (AI analysis path now resolves `findRecentByTownAndFlatType`).

- [ ] **Step 6: Run full unit test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/domains/offer/offer.service.ts src/domains/offer/__tests__/offer.service.test.ts src/domains/hdb/repository.ts
git commit -m "feat(offer): add offer service with negotiation chain and AI analysis"
```

---

### Task 6: Offer validator and router

**Files:**
- Create: `src/domains/offer/offer.validator.ts`
- Create: `src/domains/offer/offer.router.ts`
- Create: `src/domains/offer/__tests__/offer.router.test.ts`

- [ ] **Step 1: Write the failing router test**

**Pattern note:** Router tests in this codebase use a local `createTestApp()` function that injects `req.user` directly via middleware — they do NOT use the full `createApp()` (which calls `validateEnv()`) or session cookies. See `src/domains/viewing/__tests__/viewing.router.test.ts` for the established pattern.

Create `src/domains/offer/__tests__/offer.router.test.ts`:

```typescript
// src/domains/offer/__tests__/offer.router.test.ts
import express from 'express';
import request from 'supertest';
import { offerRouter } from '../offer.router';
import * as offerService from '../offer.service';

jest.mock('../offer.service');
jest.mock('express-rate-limit', () => () => (_req: unknown, _res: unknown, next: () => void) => next());

const mockOfferService = jest.mocked(offerService);

// Minimal app with injected agent auth — standard pattern for router tests in this codebase
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    Object.assign(req, {
      isAuthenticated: () => true,
      user: {
        id: 'agent-1',
        role: 'agent',
        name: 'Test Agent',
        email: 'agent@test.com',
        twoFactorEnabled: true,
        twoFactorVerified: true,
      },
    });
    next();
  });
  // Mock Nunjucks render — router tests don't need real template rendering
  app.use((_req, res, next) => {
    res.render = ((_view: string, _data?: unknown) => {
      res.json({ rendered: true });
    }) as never;
    next();
  });
  app.use(offerRouter);
  return app;
}

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    propertyId: 'property-1',
    buyerName: 'Test Buyer',
    buyerPhone: '91234567',
    isCoBroke: false,
    offerAmount: '600000',
    status: 'pending',
    ...overrides,
  };
}

describe('offer.router', () => {
  let app: express.Application;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /agent/properties/:propertyId/offers', () => {
    it('returns 200 with offer chain', async () => {
      mockOfferService.getOffersForProperty.mockResolvedValue([makeOffer()] as never);

      const res = await request(app)
        .get('/agent/properties/property-1/offers')
        .set('HX-Request', 'true');

      expect(res.status).toBe(200);
      expect(mockOfferService.getOffersForProperty).toHaveBeenCalledWith('property-1');
    });
  });

  describe('POST /agent/offers', () => {
    it('creates an offer and returns 201', async () => {
      mockOfferService.createOffer.mockResolvedValue(makeOffer() as never);

      const res = await request(app)
        .post('/agent/offers')
        .send({
          propertyId: 'property-1',
          sellerId: 'seller-1',
          town: 'TAMPINES',
          flatType: '4 ROOM',
          buyerName: 'John Doe',
          buyerPhone: '91234567',
          isCoBroke: false,
          offerAmount: '600000',
        });

      expect(res.status).toBe(201);
    });

    it('returns 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/agent/offers')
        .send({ propertyId: 'property-1' }); // missing buyerName, buyerPhone, etc.

      expect(res.status).toBe(400);
    });
  });

  describe('POST /agent/offers/:id/counter', () => {
    it('records counter-offer and returns 200', async () => {
      mockOfferService.counterOffer.mockResolvedValue(makeOffer({ id: 'offer-2' }) as never);

      const res = await request(app)
        .post('/agent/offers/offer-1/counter')
        .send({ counterAmount: '650000' });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /agent/offers/:id/accept', () => {
    it('accepts offer and returns 200', async () => {
      mockOfferService.acceptOffer.mockResolvedValue(makeOffer({ status: 'accepted' }) as never);

      const res = await request(app).post('/agent/offers/offer-1/accept');

      expect(res.status).toBe(200);
    });
  });

  describe('POST /agent/offers/:id/reject', () => {
    it('rejects offer and returns 200', async () => {
      mockOfferService.rejectOffer.mockResolvedValue(makeOffer({ status: 'rejected' }) as never);

      const res = await request(app).post('/agent/offers/offer-1/reject');

      expect(res.status).toBe(200);
    });
  });

  describe('POST /agent/offers/:id/analysis/review', () => {
    it('marks AI analysis as reviewed', async () => {
      mockOfferService.reviewAiAnalysis.mockResolvedValue(makeOffer() as never);

      const res = await request(app).post('/agent/offers/offer-1/analysis/review');

      expect(res.status).toBe(200);
    });
  });

  describe('POST /agent/offers/:id/analysis/share', () => {
    it('shares AI analysis with seller', async () => {
      mockOfferService.shareAiAnalysis.mockResolvedValue(makeOffer() as never);

      const res = await request(app)
        .post('/agent/offers/offer-1/analysis/share')
        .send({ sellerId: 'seller-1' });

      expect(res.status).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- --testPathPattern="offer.router"
```

Expected: FAIL — router not mounted.

- [ ] **Step 3: Create offer validator**

Create `src/domains/offer/offer.validator.ts`:

```typescript
// src/domains/offer/offer.validator.ts
import { body, param } from 'express-validator';

export const validateCreateOffer = [
  body('propertyId').notEmpty().withMessage('propertyId is required'),
  body('sellerId').notEmpty().withMessage('sellerId is required'),
  body('town').notEmpty().withMessage('town is required'),
  body('flatType').notEmpty().withMessage('flatType is required'),
  body('buyerName').notEmpty().trim().withMessage('buyerName is required'),
  body('buyerPhone').notEmpty().trim().withMessage('buyerPhone is required'),
  body('isCoBroke').isBoolean().withMessage('isCoBroke must be a boolean'),
  body('offerAmount')
    .notEmpty()
    .isNumeric()
    .withMessage('offerAmount must be a number'),
];

export const validateCounterOffer = [
  param('id').notEmpty().withMessage('offerId is required'),
  body('counterAmount')
    .notEmpty()
    .isNumeric()
    .withMessage('counterAmount must be a number'),
];

export const validateShareAnalysis = [
  param('id').notEmpty().withMessage('offerId is required'),
  body('sellerId').notEmpty().withMessage('sellerId is required'),
];
```

- [ ] **Step 4: Create offer router**

Create `src/domains/offer/offer.router.ts`:

```typescript
// src/domains/offer/offer.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as offerService from './offer.service';
import { validateCreateOffer, validateCounterOffer, validateShareAnalysis } from './offer.validator';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

export const offerRouter = Router();

const agentAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];

// GET /agent/properties/:propertyId/offers — offer chain for a property
offerRouter.get(
  '/agent/properties/:propertyId/offers',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { propertyId } = req.params;
      const offers = await offerService.getOffersForProperty(propertyId as string);

      if (req.headers['hx-request']) {
        return res.render('partials/agent/offer-chain', { offers, propertyId });
      }
      res.render('pages/agent/offers', { offers, propertyId });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/offers — record new offer
offerRouter.post(
  '/agent/offers',
  ...agentAuth,
  ...validateCreateOffer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const offer = await offerService.createOffer({
        propertyId: req.body.propertyId as string,
        sellerId: req.body.sellerId as string,
        town: req.body.town as string,
        flatType: req.body.flatType as string,
        buyerName: req.body.buyerName as string,
        buyerPhone: req.body.buyerPhone as string,
        buyerAgentName: req.body.buyerAgentName as string | undefined,
        buyerAgentCeaReg: req.body.buyerAgentCeaReg as string | undefined,
        isCoBroke: req.body.isCoBroke === true || req.body.isCoBroke === 'true',
        offerAmount: parseFloat(req.body.offerAmount as string),
        notes: req.body.notes as string | undefined,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.status(201).render('partials/agent/offer-row', { offer });
      }
      res.status(201).json({ offer });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/offers/:id/counter
offerRouter.post(
  '/agent/offers/:id/counter',
  ...agentAuth,
  ...validateCounterOffer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const child = await offerService.counterOffer({
        parentOfferId: req.params['id'] as string,
        counterAmount: parseFloat(req.body.counterAmount as string),
        notes: req.body.notes as string | undefined,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/offer-row', { offer: child });
      }
      res.json({ offer: child });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/offers/:id/accept
offerRouter.post(
  '/agent/offers/:id/accept',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const offer = await offerService.acceptOffer({
        offerId: req.params['id'] as string,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/offer-row', { offer });
      }
      res.json({ offer });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/offers/:id/reject
offerRouter.post(
  '/agent/offers/:id/reject',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const offer = await offerService.rejectOffer({
        offerId: req.params['id'] as string,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/offer-row', { offer });
      }
      res.json({ offer });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/offers/:id/analysis/review
offerRouter.post(
  '/agent/offers/:id/analysis/review',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const offer = await offerService.reviewAiAnalysis({
        offerId: req.params['id'] as string,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/offer-analysis', { offer });
      }
      res.json({ offer });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/offers/:id/analysis/share
offerRouter.post(
  '/agent/offers/:id/analysis/share',
  ...agentAuth,
  ...validateShareAnalysis,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const offer = await offerService.shareAiAnalysis({
        offerId: req.params['id'] as string,
        agentId: user.id,
        sellerId: req.body.sellerId as string,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/offer-analysis', { offer });
      }
      res.json({ offer });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 5: Mount offer router in app**

In `src/infra/http/app.ts`, add the import and mount:

```typescript
import { offerRouter } from '../../domains/offer/offer.router';
```

And inside `createApp()` alongside the other routers:

```typescript
app.use(offerRouter);
```

- [ ] **Step 6: Create minimal Nunjucks view stubs** (enough for router tests to pass)

Create `src/views/partials/agent/offer-chain.njk`:
```njk
{# partials/agent/offer-chain.njk #}
<div class="offer-chain" data-property-id="{{ propertyId }}">
  {% for offer in offers %}
    {% include "partials/agent/offer-row.njk" %}
  {% endfor %}
</div>
```

Create `src/views/partials/agent/offer-row.njk`:
```njk
{# partials/agent/offer-row.njk #}
<div class="offer-row" data-offer-id="{{ offer.id }}">
  <span>{{ offer.buyerName }} — ${{ offer.offerAmount }}</span>
  <span class="status">{{ offer.status }}</span>
</div>
```

Create `src/views/partials/agent/offer-analysis.njk`:
```njk
{# partials/agent/offer-analysis.njk #}
<div class="offer-analysis" data-offer-id="{{ offer.id }}">
  {% if offer.aiAnalysis %}
    <p>{{ offer.aiAnalysis }}</p>
    <p class="status">Status: {{ offer.aiAnalysisStatus }}</p>
  {% endif %}
</div>
```

Create `src/views/pages/agent/offers.njk`:
```njk
{# pages/agent/offers.njk #}
{% extends "layouts/agent.njk" %}
{% block content %}
<h1>{{ "Offers" | t }}</h1>
{% include "partials/agent/offer-chain.njk" %}
{% endblock %}
```

- [ ] **Step 7: Run the router tests**

```bash
npm test -- --testPathPattern="offer.router"
```

Expected: all tests pass.

- [ ] **Step 8: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/domains/offer/ src/views/partials/agent/offer-chain.njk src/views/partials/agent/offer-row.njk src/views/partials/agent/offer-analysis.njk src/views/pages/agent/offers.njk src/infra/http/app.ts
git commit -m "feat(offer): add offer validator, router, and views"
```

---

## Chunk 3: Portal Formatter and Service

### Task 7: Portal formatter — pure function

**Files:**
- Create: `src/domains/property/portal.formatter.ts`
- Create: `src/domains/property/__tests__/portal.formatter.test.ts`

The formatter takes listing + property + agent + agency settings and returns structured portal content. It is a pure function — no DB, no async.

- [ ] **Step 1: Write the failing formatter tests**

Create `src/domains/property/__tests__/portal.formatter.test.ts`:

```typescript
// src/domains/property/__tests__/portal.formatter.test.ts
import { formatForPortal } from '../portal.formatter';
import type { PortalFormatterInput } from '../portal.formatter';

function makeInput(overrides: Partial<PortalFormatterInput> = {}): PortalFormatterInput {
  return {
    portal: 'propertyguru',
    listing: {
      id: 'listing-1',
      title: '4-Room HDB for Sale in Tampines',
      description: 'Well-maintained flat with great amenities.',
      photos: JSON.stringify(['/uploads/photos/seller-1/prop-1/optimized/photo1.jpg']),
    } as never,
    property: {
      id: 'property-1',
      town: 'TAMPINES',
      flatType: '4 ROOM',
      storeyRange: '07 TO 09',
      floorAreaSqm: 93,
      flatModel: 'Model A',
      leaseCommenceDate: 1995,
      askingPrice: 650000,
      remainingLease: '68 years 03 months',
      block: '123',
      street: 'TAMPINES ST 21',
    } as never,
    agent: {
      id: 'agent-1',
      name: 'Jane Tan',
      ceaRegNo: 'R012345A',
      phone: '91234567',
    } as never,
    agencyName: 'Huttons Asia Pte Ltd',
    agencyLicence: 'L3008899K',
    ...overrides,
  };
}

describe('portal.formatter', () => {
  describe('formatForPortal', () => {
    it('includes CEA compliance fields for all portals', () => {
      for (const portal of ['propertyguru', 'ninety_nine_co', 'srx'] as const) {
        const result = formatForPortal(makeInput({ portal }));
        expect(result.ceaDetails.agentName).toBe('Jane Tan');
        expect(result.ceaDetails.ceaRegNo).toBe('R012345A');
        expect(result.ceaDetails.agencyName).toBe('Huttons Asia Pte Ltd');
        expect(result.ceaDetails.agencyLicence).toBe('L3008899K');
        expect(result.ceaDetails.agentPhone).toBe('91234567');
      }
    });

    it('includes flat details', () => {
      const result = formatForPortal(makeInput());
      expect(result.flatDetails.town).toBe('TAMPINES');
      expect(result.flatDetails.flatType).toBe('4 ROOM');
      expect(result.flatDetails.floorAreaSqm).toBe(93);
      expect(result.flatDetails.askingPrice).toBe(650000);
    });

    it('includes listing title and description', () => {
      const result = formatForPortal(makeInput());
      expect(result.title).toBe('4-Room HDB for Sale in Tampines');
      expect(result.description).toBe('Well-maintained flat with great amenities.');
    });

    it('includes parsed photos array', () => {
      const result = formatForPortal(makeInput());
      expect(result.photos).toEqual(['/uploads/photos/seller-1/prop-1/optimized/photo1.jpg']);
    });

    it('returns empty photos array when listing has no photos', () => {
      const input = makeInput();
      (input.listing as never as { photos: string }).photos = '[]';
      const result = formatForPortal(input);
      expect(result.photos).toEqual([]);
    });

    it('includes the portal name in the result', () => {
      const result = formatForPortal(makeInput({ portal: 'ninety_nine_co' }));
      expect(result.portal).toBe('ninety_nine_co');
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npm test -- --testPathPattern="portal.formatter"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the portal formatter**

Create `src/domains/property/portal.formatter.ts`:

```typescript
// src/domains/property/portal.formatter.ts
import type { PortalName } from '@prisma/client';
import type { Agent, Listing, Property } from '@prisma/client';

export interface PortalContent {
  portal: PortalName;
  title: string;
  description: string;
  flatDetails: {
    town: string;
    flatType: string;
    floorAreaSqm: number;
    storeyRange: string;
    remainingLease: string | null;
    askingPrice: number;
    block: string;
    street: string;
  };
  photos: string[];
  ceaDetails: {
    agentName: string;
    ceaRegNo: string;
    agencyName: string;    // from SystemSetting 'agency_name' — passed in by caller
    agencyLicence: string; // from SystemSetting 'agency_licence' — passed in by caller
    agentPhone: string;
  };
}

export interface PortalFormatterInput {
  portal: PortalName;
  listing: Listing;
  property: Property;
  agent: Pick<Agent, 'id' | 'name' | 'ceaRegNo' | 'phone'>;
  agencyName: string;
  agencyLicence: string;
}

/**
 * Pure function — no DB access, no async.
 * Transforms listing + property + agent data into portal-ready structured content.
 * CEA fields are always present and populated (compliance requirement).
 * agencyName and agencyLicence are passed in from SystemSetting by the caller.
 */
export function formatForPortal(input: PortalFormatterInput): PortalContent {
  const { portal, listing, property, agent, agencyName, agencyLicence } = input;

  let photos: string[] = [];
  try {
    photos = JSON.parse(listing.photos as string) as string[];
  } catch {
    photos = [];
  }

  return {
    portal,
    title: listing.title ?? `${property.flatType} HDB Flat for Sale in ${property.town}`,
    description: listing.description ?? '',
    flatDetails: {
      town: property.town,
      flatType: property.flatType,
      floorAreaSqm: property.floorAreaSqm,
      storeyRange: property.storeyRange,
      remainingLease: property.remainingLease ?? null,
      askingPrice: property.askingPrice ? Number(property.askingPrice) : 0,
      block: property.block,
      street: property.street,
    },
    photos,
    ceaDetails: {
      agentName: agent.name,
      ceaRegNo: agent.ceaRegNo,
      agencyName,
      agencyLicence,
      agentPhone: agent.phone,
    },
  };
}
```

- [ ] **Step 4: Run the formatter tests**

```bash
npm test -- --testPathPattern="portal.formatter"
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/domains/property/portal.formatter.ts src/domains/property/__tests__/portal.formatter.test.ts
git commit -m "feat(portal): add portal formatter — pure function for CEA-compliant portal content"
```

---

### Task 8: Portal repository, service + factory

**Files:**
- Create: `src/domains/property/portal.repository.ts`
- Create: `src/domains/property/portal.service.ts`
- Create: `src/domains/property/__tests__/portal.service.test.ts`
- Modify: `tests/fixtures/factory.ts` (add portalListing factory)

**Architecture note:** Per CLAUDE.md, services never call Prisma directly — all DB access goes through the repository layer. `portal.service.ts` must go through `portal.repository.ts`.

- [ ] **Step 1: Write the failing portal service tests**

Create `src/domains/property/__tests__/portal.service.test.ts`:

```typescript
// src/domains/property/__tests__/portal.service.test.ts
import * as portalService from '../portal.service';
import * as portalRepo from '../portal.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as auditService from '@/domains/shared/audit.service';
import { NotFoundError } from '@/domains/shared/errors';

jest.mock('../portal.repository');
jest.mock('@/domains/shared/settings.service');
jest.mock('@/domains/shared/audit.service');

const mockPortalRepo = jest.mocked(portalRepo);
const mockSettings = jest.mocked(settingsService);
const mockAudit = jest.mocked(auditService);

function makeListingWithRelations(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    propertyId: 'property-1',
    title: '4-Room Flat in Tampines',
    description: 'Great flat',
    photos: '[]',
    status: 'approved',
    property: {
      id: 'property-1',
      sellerId: 'seller-1',
      town: 'TAMPINES',
      flatType: '4 ROOM',
      storeyRange: '07 TO 09',
      floorAreaSqm: 93,
      flatModel: 'Model A',
      block: '123',
      street: 'TAMPINES ST 21',
      leaseCommenceDate: 1995,
      askingPrice: '650000',
      seller: {
        agent: {
          id: 'agent-1',
          name: 'Jane Tan',
          ceaRegNo: 'R012345A',
          phone: '91234567',
        },
      },
    },
    ...overrides,
  };
}

describe('portal.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'agency_name') return 'Huttons Asia Pte Ltd';
      if (key === 'agency_licence') return 'L3008899K';
      return '';
    });
    mockAudit.log.mockResolvedValue(undefined as never);
  });

  describe('generatePortalListings', () => {
    it('creates PortalListing records for all three portals', async () => {
      mockPortalRepo.findListingWithAgent.mockResolvedValue(makeListingWithRelations() as never);
      mockPortalRepo.upsertPortalListing.mockResolvedValue({} as never);

      await portalService.generatePortalListings('listing-1');

      expect(mockPortalRepo.upsertPortalListing).toHaveBeenCalledTimes(3);
      const portalsUsed = mockPortalRepo.upsertPortalListing.mock.calls.map(
        (call) => (call[0] as { portalName: string }).portalName,
      );
      expect(portalsUsed).toContain('propertyguru');
      expect(portalsUsed).toContain('ninety_nine_co');
      expect(portalsUsed).toContain('srx');
    });

    it('throws NotFoundError if listing not found', async () => {
      mockPortalRepo.findListingWithAgent.mockResolvedValue(null);

      await expect(portalService.generatePortalListings('bad-id')).rejects.toThrow(NotFoundError);
    });
  });

  describe('markAsPosted', () => {
    it('sets status to posted and records URL and timestamp', async () => {
      mockPortalRepo.updatePortalListing.mockResolvedValue({
        id: 'pl-1',
        status: 'posted',
        portalListingUrl: 'https://www.propertyguru.com.sg/listing/123',
      } as never);

      const result = await portalService.markAsPosted('pl-1', 'https://www.propertyguru.com.sg/listing/123');
      expect(result.status).toBe('posted');
    });
  });

  describe('getPortalListings', () => {
    it('returns all portal listings for a listing', async () => {
      mockPortalRepo.findPortalListingsByListingId.mockResolvedValue([
        { id: 'pl-1', portalName: 'propertyguru' },
        { id: 'pl-2', portalName: 'ninety_nine_co' },
      ] as never);

      const results = await portalService.getPortalListings('listing-1');
      expect(results).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- --testPathPattern="portal.service"
```

Expected: FAIL — `portal.repository` module not found.

- [ ] **Step 3: Create portal repository**

Create `src/domains/property/portal.repository.ts`:

```typescript
// src/domains/property/portal.repository.ts
import { prisma } from '@/infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';

export async function findListingWithAgent(listingId: string) {
  return prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      property: {
        include: {
          seller: {
            include: { agent: true },
          },
        },
      },
    },
  });
}

export async function upsertPortalListing(data: {
  listingId: string;
  portalName: string;
  portalReadyContent: Record<string, unknown>;
}) {
  return prisma.portalListing.upsert({
    where: {
      listingId_portalName: { listingId: data.listingId, portalName: data.portalName },
    },
    create: {
      id: createId(),
      listingId: data.listingId,
      portalName: data.portalName,
      portalReadyContent: data.portalReadyContent as never,
      status: 'ready',
    },
    update: {
      portalReadyContent: data.portalReadyContent as never,
      status: 'ready',
      postedManuallyAt: null,
      portalListingUrl: null,
    },
  });
}

export async function updatePortalListing(id: string, data: { status: string; portalListingUrl: string; postedManuallyAt: Date }) {
  return prisma.portalListing.update({
    where: { id },
    data: {
      status: data.status as never,
      portalListingUrl: data.portalListingUrl,
      postedManuallyAt: data.postedManuallyAt,
    },
  });
}

export async function findPortalListingsByListingId(listingId: string) {
  return prisma.portalListing.findMany({
    where: { listingId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function expirePortalListingsByListingId(listingId: string) {
  return prisma.portalListing.updateMany({
    where: {
      listingId,
      status: { in: ['ready', 'posted'] },
    },
    data: { status: 'expired' },
  });
}
```

- [ ] **Step 4: Create the portal service**

Create `src/domains/property/portal.service.ts`:

```typescript
// src/domains/property/portal.service.ts
import * as portalRepo from './portal.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as auditService from '@/domains/shared/audit.service';
import { formatForPortal } from './portal.formatter';
import { NotFoundError } from '@/domains/shared/errors';

const PORTALS = ['propertyguru', 'ninety_nine_co', 'srx'] as const;

export async function generatePortalListings(listingId: string): Promise<void> {
  const listing = await portalRepo.findListingWithAgent(listingId);

  if (!listing) throw new NotFoundError('Listing', listingId);
  if (!listing.property?.seller?.agent) {
    throw new NotFoundError('Agent for listing', listingId);
  }

  const [agencyName, agencyLicence] = await Promise.all([
    settingsService.get('agency_name', 'Huttons Asia Pte Ltd'),
    settingsService.get('agency_licence', 'L3008899K'),
  ]);

  const agent = listing.property.seller.agent;

  for (const portal of PORTALS) {
    const content = formatForPortal({
      portal,
      listing: listing as never,
      property: listing.property as never,
      agent: { id: agent.id, name: agent.name, ceaRegNo: agent.ceaRegNo, phone: agent.phone },
      agencyName,
      agencyLicence,
    });

    await portalRepo.upsertPortalListing({
      listingId,
      portalName: portal,
      portalReadyContent: content as Record<string, unknown>,
    });
  }

  await auditService.log({
    action: 'portal.listings_generated',
    entityType: 'listing',
    entityId: listingId,
    details: { portals: PORTALS },
  });
}

export async function markAsPosted(portalListingId: string, url: string) {
  return portalRepo.updatePortalListing(portalListingId, {
    status: 'posted',
    portalListingUrl: url,
    postedManuallyAt: new Date(),
  });
}

export async function getPortalListings(listingId: string) {
  return portalRepo.findPortalListingsByListingId(listingId);
}

export async function expirePortalListings(listingId: string) {
  return portalRepo.expirePortalListingsByListingId(listingId);
}
```

- [ ] **Step 5: Check if `PortalListing` has a unique compound index**

```bash
grep -A 5 "@@map.*portal_listings" prisma/schema.prisma
```

The `portalListing` upsert uses `listingId_portalName` composite unique key. Add it to the schema if missing:

In `prisma/schema.prisma`, inside the `PortalListing` model, add before `@@map`:
```prisma
  @@unique([listingId, portalName])
```

If it already exists, skip this step. Then run:
```bash
npm run db:migrate
```
Name the migration: `add_portal_listing_unique_constraint`

- [ ] **Step 6: Add portalListing factory**

In `tests/fixtures/factory.ts`, add:

```typescript
  async portalListing(overrides: {
    listingId: string;
    portalName?: 'propertyguru' | 'ninety_nine_co' | 'srx' | 'other';
    status?: 'ready' | 'posted' | 'expired';
    portalListingUrl?: string;
  }) {
    return testPrisma.portalListing.create({
      data: {
        id: createId(),
        listingId: overrides.listingId,
        portalName: overrides.portalName ?? 'propertyguru',
        portalReadyContent: {},
        status: overrides.status ?? 'ready',
        portalListingUrl: overrides.portalListingUrl ?? null,
      },
    });
  },
```

- [ ] **Step 7: Run portal service tests**

```bash
npm test -- --testPathPattern="portal.service"
```

Expected: all tests pass.

- [ ] **Step 8: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/domains/property/portal.repository.ts src/domains/property/portal.service.ts src/domains/property/__tests__/portal.service.test.ts tests/fixtures/factory.ts prisma/schema.prisma prisma/migrations/
git commit -m "feat(portal): add portal repository, service with listing generation, mark-as-posted, and expire"
```

---

## Chunk 4: Portal Router, Views, Review Hook

### Task 9: Portal router

**Files:**
- Create: `src/domains/property/portal.router.ts`
- Create: `src/domains/property/__tests__/portal.router.test.ts`

- [ ] **Step 1: Write the failing router test**

Create `src/domains/property/__tests__/portal.router.test.ts`:

**Pattern note:** Router tests use a local `createTestApp()` that injects `req.user` directly via middleware — do NOT use `createApp()` (which calls `validateEnv()`) or cookies/sessions. See `src/domains/viewing/__tests__/viewing.router.test.ts` and `src/domains/offer/__tests__/offer.router.test.ts` for the established pattern.

```typescript
// src/domains/property/__tests__/portal.router.test.ts
import express from 'express';
import request from 'supertest';
import { portalRouter } from '../portal.router';
import * as portalService from '../portal.service';

jest.mock('../portal.service');
jest.mock('express-rate-limit', () => () => (_req: unknown, _res: unknown, next: () => void) => next());

const mockPortalService = jest.mocked(portalService);

// Minimal app with injected agent auth — standard pattern for router tests in this codebase
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    Object.assign(req, {
      isAuthenticated: () => true,
      user: {
        id: 'agent-1',
        role: 'agent',
        name: 'Test Agent',
        email: 'agent@test.com',
        twoFactorEnabled: true,
        twoFactorVerified: true,
      },
    });
    next();
  });
  // Mock Nunjucks render — router tests don't need real template rendering
  app.use((_req, res, next) => {
    res.render = ((_view: string, _data?: unknown) => {
      res.json({ rendered: true });
    }) as never;
    next();
  });
  app.use(portalRouter);
  return app;
}

describe('portal.router', () => {
  let app: express.Application;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /agent/listings/:listingId/portals', () => {
    it('returns 200 with portal listings', async () => {
      mockPortalService.getPortalListings.mockResolvedValue([
        { id: 'pl-1', portalName: 'propertyguru', status: 'ready' } as never,
        { id: 'pl-2', portalName: 'ninety_nine_co', status: 'ready' } as never,
        { id: 'pl-3', portalName: 'srx', status: 'ready' } as never,
      ]);

      const res = await request(app)
        .get('/agent/listings/listing-1/portals')
        .set('HX-Request', 'true');

      expect(res.status).toBe(200);
      expect(mockPortalService.getPortalListings).toHaveBeenCalledWith('listing-1');
    });
  });

  describe('POST /agent/portal-listings/:id/mark-posted', () => {
    it('marks portal listing as posted and returns 200', async () => {
      mockPortalService.markAsPosted.mockResolvedValue({
        id: 'pl-1',
        status: 'posted',
        portalListingUrl: 'https://www.propertyguru.com.sg/listing/123',
      } as never);

      const res = await request(app)
        .post('/agent/portal-listings/pl-1/mark-posted')
        .send({ url: 'https://www.propertyguru.com.sg/listing/123' });

      expect(res.status).toBe(200);
    });

    it('returns 400 when url is missing', async () => {
      const res = await request(app)
        .post('/agent/portal-listings/pl-1/mark-posted')
        .send({});

      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- --testPathPattern="portal.router"
```

Expected: FAIL.

- [ ] **Step 3: Create the portal router**

Create `src/domains/property/portal.router.ts`:

```typescript
// src/domains/property/portal.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import * as portalService from './portal.service';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';

export const portalRouter = Router();

const agentAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];

// GET /agent/listings/:listingId/portals — dedicated portal page
portalRouter.get(
  '/agent/listings/:listingId/portals',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { listingId } = req.params;
      const portalListings = await portalService.getPortalListings(listingId as string);

      if (req.headers['hx-request']) {
        return res.render('partials/agent/portal-panels', { portalListings, listingId });
      }
      res.render('pages/agent/portals', { portalListings, listingId });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/portal-listings/:id/mark-posted — agent marks listing as posted + provides URL
portalRouter.post(
  '/agent/portal-listings/:id/mark-posted',
  ...agentAuth,
  [body('url').notEmpty().isURL().withMessage('A valid portal URL is required')],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const portalListing = await portalService.markAsPosted(
        req.params['id'] as string,
        req.body.url as string,
      );

      if (req.headers['hx-request']) {
        return res.render('partials/agent/portal-panel', { portalListing });
      }
      res.json({ portalListing });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 4: Create portal views**

Create `src/views/pages/agent/portals.njk`:
```njk
{# pages/agent/portals.njk #}
{% extends "layouts/agent.njk" %}
{% block content %}
<div class="portals-page">
  <h1>{{ "Portal Listings" | t }}</h1>
  <p class="text-sm text-gray-500">
    {{ "Copy content for each portal below. Post manually, then paste the live URL back." | t }}
  </p>
  {% for portalListing in portalListings %}
    {% include "partials/agent/portal-panel.njk" %}
  {% endfor %}
</div>
{% endblock %}
```

Create `src/views/partials/agent/portal-panel.njk`:
```njk
{# partials/agent/portal-panel.njk #}
{% set content = portalListing.portalReadyContent %}
{% set portalLabels = { propertyguru: "PropertyGuru", ninety_nine_co: "99.co", srx: "SRX" } %}
<div class="portal-panel border rounded p-4 mb-4" id="portal-{{ portalListing.id }}">
  <div class="flex items-center justify-between mb-3">
    <h2 class="font-semibold">{{ portalLabels[portalListing.portalName] or portalListing.portalName }}</h2>
    <span class="badge badge-{{ portalListing.status }}">{{ portalListing.status | t }}</span>
  </div>

  {% if content %}
    <div class="mb-2">
      <label class="text-xs text-gray-500">{{ "Title" | t }}</label>
      <div class="flex gap-2">
        <p class="flex-1 bg-gray-50 p-2 text-sm rounded">{{ content.title }}</p>
        <button
          class="btn btn-xs"
          onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent)">
          {{ "Copy" | t }}
        </button>
      </div>
    </div>

    <div class="mb-2">
      <label class="text-xs text-gray-500">{{ "Description" | t }}</label>
      <div class="flex gap-2">
        <p class="flex-1 bg-gray-50 p-2 text-sm rounded whitespace-pre-wrap">{{ content.description }}</p>
        <button
          class="btn btn-xs"
          onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent)">
          {{ "Copy" | t }}
        </button>
      </div>
    </div>

    <div class="mb-3 grid grid-cols-2 gap-2 text-sm">
      <div><span class="text-gray-500">{{ "Town:" | t }}</span> {{ content.flatDetails.town }}</div>
      <div><span class="text-gray-500">{{ "Type:" | t }}</span> {{ content.flatDetails.flatType }}</div>
      <div><span class="text-gray-500">{{ "Area:" | t }}</span> {{ content.flatDetails.floorAreaSqm }} sqm</div>
      <div><span class="text-gray-500">{{ "Price:" | t }}</span> {{ content.flatDetails.askingPrice | formatPrice }}</div>
    </div>

    <div class="mb-3 text-xs text-gray-500 border-t pt-2">
      <strong>{{ "CEA Details:" | t }}</strong>
      {{ content.ceaDetails.agentName }} ({{ content.ceaDetails.ceaRegNo }}) |
      {{ content.ceaDetails.agencyName }} ({{ content.ceaDetails.agencyLicence }}) |
      {{ content.ceaDetails.agentPhone }}
    </div>
  {% endif %}

  {% if portalListing.status != 'posted' %}
    <form
      hx-post="/agent/portal-listings/{{ portalListing.id }}/mark-posted"
      hx-target="#portal-{{ portalListing.id }}"
      hx-swap="outerHTML"
      class="flex gap-2 mt-3">
      <input
        type="url"
        name="url"
        placeholder="{{ 'Paste live portal URL here' | t }}"
        class="input input-sm flex-1"
        required />
      <button type="submit" class="btn btn-sm btn-primary">{{ "Mark as Posted" | t }}</button>
    </form>
  {% else %}
    <div class="mt-3 text-sm text-green-600">
      ✓ {{ "Posted" | t }}: <a href="{{ portalListing.portalListingUrl }}" target="_blank" rel="noopener">{{ portalListing.portalListingUrl }}</a>
    </div>
  {% endif %}
</div>
```

Create `src/views/partials/agent/portal-panels.njk`:
```njk
{# partials/agent/portal-panels.njk #}
{% for portalListing in portalListings %}
  {% include "partials/agent/portal-panel.njk" %}
{% endfor %}
```

- [ ] **Step 5: Mount portal router in app**

In `src/infra/http/app.ts`, add the import alongside other domain router imports:
```typescript
import { portalRouter } from '../../domains/property/portal.router';
```

Inside `createApp()`, mount it **after `app.use(adminRouter)` and before `app.use(errorHandler)`** (or alongside the other domain routers in that block):
```typescript
app.use(portalRouter);
```

- [ ] **Step 6: Run portal router tests**

```bash
npm test -- --testPathPattern="portal.router"
```

Expected: all tests pass.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/domains/property/portal.router.ts src/domains/property/__tests__/portal.router.test.ts src/views/pages/agent/portals.njk src/views/partials/agent/ src/infra/http/app.ts
git commit -m "feat(portal): add portal router with dedicated portal page and mark-as-posted action"
```

---

### Task 10: Hook portal generation into review service on listing approval

**Files:**
- Modify: `src/domains/review/review.service.ts`
- Modify: `src/domains/review/review.repository.ts`

When an agent approves `listing_description` or `listing_photos`, check if both are now approved. If so, set listing status to `approved` and generate portal content.

- [ ] **Step 1: Write failing test for the hook**

**Important context:** The existing `src/domains/review/__tests__/review.service.test.ts` only tests `validateTransition` and `checkComplianceGate`. It does NOT have an `approveItem` describe block. You need to add new imports, mocks, and a new describe block at the **end** of the file.

Add the following to `src/domains/review/__tests__/review.service.test.ts`:

At the top of the file, add these imports alongside the existing ones:
```typescript
import { approveItem } from '../review.service';
import * as portalService from '@/domains/property/portal.service';
import * as auditService from '@/domains/shared/audit.service';
```

After the existing `jest.mock('../review.repository')` line, add:
```typescript
jest.mock('@/domains/property/portal.service');
jest.mock('@/domains/shared/audit.service');
const mockPortalService = portalService as jest.Mocked<typeof portalService>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;
```

Then add this new describe block at the **end** of the file (after all existing describe blocks):

```typescript
describe('approveItem — listing portal generation hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo.approveListingDescription.mockResolvedValue({} as never);
    mockRepo.approveListingPhotos.mockResolvedValue({} as never);
    mockRepo.checkListingFullyApproved.mockResolvedValue(false);
    mockRepo.setListingStatus.mockResolvedValue({} as never);
    mockPortalService.generatePortalListings.mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined as never);
  });

  it('generates portal listings when listing_description approval makes listing fully approved', async () => {
    mockRepo.checkListingFullyApproved.mockResolvedValue(true);

    await approveItem({
      entityType: 'listing_description',
      entityId: 'listing-1',
      agentId: 'agent-1',
    });

    expect(mockPortalService.generatePortalListings).toHaveBeenCalledWith('listing-1');
    expect(mockRepo.setListingStatus).toHaveBeenCalledWith('listing-1', 'approved');
  });

  it('does NOT generate portal listings when only description approved (photos pending)', async () => {
    mockRepo.checkListingFullyApproved.mockResolvedValue(false);

    await approveItem({
      entityType: 'listing_description',
      entityId: 'listing-1',
      agentId: 'agent-1',
    });

    expect(mockPortalService.generatePortalListings).not.toHaveBeenCalled();
  });

  it('generates portal listings when listing_photos approval makes listing fully approved', async () => {
    mockRepo.checkListingFullyApproved.mockResolvedValue(true);

    await approveItem({
      entityType: 'listing_photos',
      entityId: 'listing-1',
      agentId: 'agent-1',
    });

    expect(mockPortalService.generatePortalListings).toHaveBeenCalledWith('listing-1');
    expect(mockRepo.setListingStatus).toHaveBeenCalledWith('listing-1', 'approved');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- --testPathPattern="review.service"
```

Expected: FAIL — `checkListingFullyApproved` and `setListingStatus` do not exist yet.

- [ ] **Step 3: Add methods to review repository**

In `src/domains/review/review.repository.ts`, add:

```typescript
export async function checkListingFullyApproved(listingId: string): Promise<boolean> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { descriptionApprovedAt: true, photosApprovedAt: true },
  });
  if (!listing) return false;
  return !!(listing.descriptionApprovedAt && listing.photosApprovedAt);
}

export async function setListingStatus(listingId: string, status: string) {
  return prisma.listing.update({
    where: { id: listingId },
    data: { status: status as never },
  });
}
```

- [ ] **Step 4: Update review service to call portal generation**

In `src/domains/review/review.service.ts`, add import at top:

```typescript
import * as portalService from '@/domains/property/portal.service';
```

Then in `approveItem`, update the `listing_description` and `listing_photos` cases:

```typescript
    case 'listing_description':
      await reviewRepo.approveListingDescription(entityId, agentId);
      break;
```

Replace with:

```typescript
    case 'listing_description': {
      await reviewRepo.approveListingDescription(entityId, agentId);
      const isFullyApproved = await reviewRepo.checkListingFullyApproved(entityId);
      if (isFullyApproved) {
        await reviewRepo.setListingStatus(entityId, 'approved');
        await portalService.generatePortalListings(entityId);
      }
      break;
    }
```

And `listing_photos` case:

```typescript
    case 'listing_photos': {
      await reviewRepo.approveListingPhotos(entityId, agentId);
      const isFullyApproved = await reviewRepo.checkListingFullyApproved(entityId);
      if (isFullyApproved) {
        await reviewRepo.setListingStatus(entityId, 'approved');
        await portalService.generatePortalListings(entityId);
      }
      break;
    }
```

- [ ] **Step 5: Run review service tests**

```bash
npm test -- --testPathPattern="review.service"
```

Expected: all tests pass.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/domains/review/review.service.ts src/domains/review/review.repository.ts src/domains/review/__tests__/
git commit -m "feat(portal): hook portal generation into listing approval in review service"
```

---

## Chunk 5: Integration Tests and Final Verification

### Task 11: Integration tests

**Files:**
- Create: `tests/integration/offer.test.ts`
- Create: `tests/integration/portal.test.ts`

**Prerequisite:** `factory.offer()` must be added to `tests/fixtures/factory.ts` (done in Chunk 2, Task 4, Step 3) and `factory.portalListing()` must be added (done in Chunk 3, Task 8, Step 5). Complete those tasks before running these tests.

- [ ] **Step 1: Create offer integration test**

Create `tests/integration/offer.test.ts`:

```typescript
// tests/integration/offer.test.ts
import { factory } from '../fixtures/factory';
import { testPrisma } from '../helpers/prisma';
import * as offerService from '../../src/domains/offer/offer.service';
import * as aiFacade from '../../src/domains/shared/ai/ai.facade';
import * as notificationService from '../../src/domains/notification/notification.service';

jest.mock('../../src/domains/shared/ai/ai.facade');
jest.mock('../../src/domains/notification/notification.service');

const mockAiFacade = jest.mocked(aiFacade);
const mockNotification = jest.mocked(notificationService);

describe('offer integration', () => {
  let agentId: string;
  let sellerId: string;
  let propertyId: string;

  beforeEach(async () => {
    await testPrisma.offer.deleteMany();
    await testPrisma.property.deleteMany();
    await testPrisma.seller.deleteMany();
    await testPrisma.agent.deleteMany();
    await testPrisma.systemSetting.deleteMany();

    mockNotification.send.mockResolvedValue(undefined as never);

    const agent = await factory.agent();
    agentId = agent.id;
    const seller = await factory.seller({ agentId });
    sellerId = seller.id;
    const property = await factory.property({ sellerId, town: 'TAMPINES', flatType: '4 ROOM' });
    propertyId = property.id;

    await factory.systemSetting({ key: 'offer_ai_analysis_enabled', value: 'false' });
  });

  it('records an offer and notifies seller', async () => {
    const offer = await offerService.createOffer({
      propertyId,
      sellerId,
      town: 'TAMPINES',
      flatType: '4 ROOM',
      buyerName: 'John Buyer',
      buyerPhone: '91234567',
      isCoBroke: false,
      offerAmount: 600000,
      agentId,
    });

    expect(offer.id).toBeDefined();
    expect(offer.status).toBe('pending');
    expect(mockNotification.send).toHaveBeenCalledTimes(1);
  });

  it('creates counter-offer chain and sets parent to countered', async () => {
    const original = await factory.offer({ propertyId, offerAmount: 600000 });

    await offerService.counterOffer({
      parentOfferId: original.id,
      counterAmount: 650000,
      agentId,
    });

    const updatedParent = await testPrisma.offer.findUnique({ where: { id: original.id } });
    const children = await testPrisma.offer.findMany({ where: { parentOfferId: original.id } });

    expect(updatedParent?.status).toBe('countered');
    expect(children).toHaveLength(1);
    expect(Number(children[0]?.counterAmount)).toBe(650000);
  });

  it('accepts offer and expires all pending/countered siblings', async () => {
    const accepted = await factory.offer({ propertyId, status: 'pending' });
    const sibling1 = await factory.offer({ propertyId, status: 'pending' });
    const sibling2 = await factory.offer({ propertyId, status: 'countered' });
    const rejected = await factory.offer({ propertyId, status: 'rejected' });

    await offerService.acceptOffer({ offerId: accepted.id, agentId });

    const [updatedAccepted, updatedSibling1, updatedSibling2, updatedRejected] = await Promise.all([
      testPrisma.offer.findUnique({ where: { id: accepted.id } }),
      testPrisma.offer.findUnique({ where: { id: sibling1.id } }),
      testPrisma.offer.findUnique({ where: { id: sibling2.id } }),
      testPrisma.offer.findUnique({ where: { id: rejected.id } }),
    ]);

    expect(updatedAccepted?.status).toBe('accepted');
    expect(updatedSibling1?.status).toBe('expired');
    expect(updatedSibling2?.status).toBe('expired');
    expect(updatedRejected?.status).toBe('rejected'); // unchanged
  });

  it('HITL: blocks sharing AI analysis before review', async () => {
    const offer = await factory.offer({ propertyId });
    await testPrisma.offer.update({
      where: { id: offer.id },
      data: { aiAnalysis: 'Test analysis', aiAnalysisStatus: 'generated' },
    });

    await expect(
      offerService.shareAiAnalysis({ offerId: offer.id, agentId, sellerId }),
    ).rejects.toThrow('must be reviewed');
  });

  it('HITL: allows sharing AI analysis after review', async () => {
    const offer = await factory.offer({ propertyId });
    await testPrisma.offer.update({
      where: { id: offer.id },
      data: {
        aiAnalysis: 'Test analysis',
        aiAnalysisProvider: 'anthropic',
        aiAnalysisModel: 'claude-test',
        aiAnalysisStatus: 'reviewed',
      },
    });

    await offerService.shareAiAnalysis({ offerId: offer.id, agentId, sellerId });

    const updated = await testPrisma.offer.findUnique({ where: { id: offer.id } });
    expect(updated?.aiAnalysisStatus).toBe('shared');
    expect(mockNotification.send).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Create portal integration test**

Create `tests/integration/portal.test.ts`:

```typescript
// tests/integration/portal.test.ts
import { factory } from '../fixtures/factory';
import { testPrisma } from '../helpers/prisma';
import * as portalService from '../../src/domains/property/portal.service';

describe('portal integration', () => {
  let agentId: string;
  let sellerId: string;
  let propertyId: string;
  let listingId: string;

  beforeEach(async () => {
    await testPrisma.portalListing.deleteMany();
    await testPrisma.listing.deleteMany();
    await testPrisma.property.deleteMany();
    await testPrisma.seller.deleteMany();
    await testPrisma.agent.deleteMany();
    await testPrisma.systemSetting.deleteMany();

    const agent = await factory.agent({ ceaRegNo: 'R012345A' });
    agentId = agent.id;
    const seller = await factory.seller({ agentId });
    sellerId = seller.id;
    const property = await factory.property({
      sellerId,
      town: 'TAMPINES',
      flatType: '4 ROOM',
      askingPrice: 650000,
    });
    propertyId = property.id;
    const listing = await factory.listing({
      propertyId,
      title: 'Bright 4-Room in Tampines',
      description: 'Well-maintained flat.',
      status: 'approved',
      photos: '[]',
    });
    listingId = listing.id;

    await testPrisma.systemSetting.createMany({
      data: [
        { id: 's1', key: 'agency_name', value: 'Huttons Asia Pte Ltd', description: 'test' },
        { id: 's2', key: 'agency_licence', value: 'L3008899K', description: 'test' },
      ],
    });
  });

  it('generates portal listing records for all three portals', async () => {
    await portalService.generatePortalListings(listingId);

    const portalListings = await testPrisma.portalListing.findMany({
      where: { listingId },
    });

    expect(portalListings).toHaveLength(3);
    const portalNames = portalListings.map((p) => p.portalName);
    expect(portalNames).toContain('propertyguru');
    expect(portalNames).toContain('ninety_nine_co');
    expect(portalNames).toContain('srx');
  });

  it('generated content always includes all CEA fields', async () => {
    await portalService.generatePortalListings(listingId);

    const portalListings = await testPrisma.portalListing.findMany({ where: { listingId } });
    for (const pl of portalListings) {
      const content = pl.portalReadyContent as Record<string, unknown>;
      const ceaDetails = content['ceaDetails'] as Record<string, string>;
      expect(ceaDetails['agencyName']).toBe('Huttons Asia Pte Ltd');
      expect(ceaDetails['agencyLicence']).toBe('L3008899K');
      expect(ceaDetails['ceaRegNo']).toBe('R012345A');
    }
  });

  it('marks a portal listing as posted with URL', async () => {
    await portalService.generatePortalListings(listingId);
    const pl = await testPrisma.portalListing.findFirst({ where: { listingId } });

    const updated = await portalService.markAsPosted(
      pl!.id,
      'https://www.propertyguru.com.sg/listing/12345',
    );

    expect(updated.status).toBe('posted');
    expect(updated.portalListingUrl).toBe('https://www.propertyguru.com.sg/listing/12345');
    expect(updated.postedManuallyAt).not.toBeNull();
  });

  it('regenerates portal content on re-approval (upsert replaces existing)', async () => {
    await portalService.generatePortalListings(listingId);
    await portalService.generatePortalListings(listingId); // second call

    const portalListings = await testPrisma.portalListing.findMany({ where: { listingId } });
    expect(portalListings).toHaveLength(3); // no duplicates
  });
});
```

- [ ] **Step 3: Run integration tests**

```bash
npm run test:integration -- --testPathPattern="offer|portal" --runInBand
```

Expected: all tests pass.

- [ ] **Step 4: Run all tests**

```bash
npm test && npm run test:integration -- --runInBand
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/offer.test.ts tests/integration/portal.test.ts
git commit -m "test(offer,portal): add integration tests for offer lifecycle and portal generation"
```

---

### Task 12: Final check and notification templates

**Files:**
- Modify: `src/domains/notification/notification.types.ts`
- Modify: `src/domains/notification/notification.templates.ts`

The offer service uses two new notification templates: `offer_received` and `offer_analysis_shared`. Check if they exist.

- [ ] **Step 1: Check existing templates**

```bash
grep -n "offer_received\|offer_analysis_shared" src/domains/notification/notification.templates.ts
```

- [ ] **Step 2: Add missing templates**

`offer_received` already exists in both `notification.types.ts` and `notification.templates.ts`. `offer_analysis_shared` does NOT exist and needs to be added to both files.

In `src/domains/notification/notification.types.ts`, add `'offer_analysis_shared'` to the `NotificationTemplateName` union:

```typescript
// Find this line:
  | 'financial_report_ready'
  | 'generic';

// Replace with:
  | 'financial_report_ready'
  | 'offer_analysis_shared'
  | 'generic';
```

In `src/domains/notification/notification.templates.ts`, add the template and WhatsApp status entry:

In the `NOTIFICATION_TEMPLATES` object, add after `offer_accepted`:
```typescript
  offer_analysis_shared: {
    subject: 'Market Analysis for Your Offer — {{address}}',
    body: 'Your agent has shared a market analysis for the offer on {{address}}:\n\n{{analysis}}\n\nThis is indicative only based on public HDB data. It does not constitute financial or legal advice.',
  },
```

In the `WHATSAPP_TEMPLATE_STATUS` object, add after `offer_accepted`:
```typescript
  offer_analysis_shared: 'pending',
```

- [ ] **Step 3: Run full test suite one final time**

```bash
npm test && npm run test:integration -- --runInBand
```

Expected: all tests pass.

- [ ] **Step 4: Final commit**

```bash
git add src/domains/notification/notification.types.ts src/domains/notification/notification.templates.ts
git commit -m "feat(offer,portal): SP1 complete — offer domain + portal formatter ready"
```
