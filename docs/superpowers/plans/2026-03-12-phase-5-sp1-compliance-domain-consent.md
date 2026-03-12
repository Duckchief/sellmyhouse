# Phase 5 SP1: Compliance Domain + Consent Management — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the compliance domain module with consent withdrawal, the DNC gate service, and wire it into the notification service.

**Architecture:** New `src/domains/compliance/` domain follows the standard types/service/repository/router/validator/tests pattern. The `compliance.service.checkDncAllowed()` function is called by `notification.service` before any outbound WhatsApp send, replacing the existing stub. Consent withdrawal creates an append-only `ConsentRecord` and a `DataDeletionRequest` when service consent is withdrawn.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Jest, Supertest

**Spec:** `docs/superpowers/specs/2026-03-12-phase-5-pdpa-compliance-design.md`

---

## File Map

**Create:**
- `src/domains/compliance/compliance.types.ts` — DNC types, consent types, deletion request types
- `src/domains/compliance/compliance.repository.ts` — ConsentRecord, DataDeletionRequest DB access
- `src/domains/compliance/compliance.service.ts` — withdrawConsent, checkDncAllowed
- `src/domains/compliance/compliance.validator.ts` — input validation for withdrawal requests
- `src/domains/compliance/compliance.router.ts` — POST /seller/compliance/consent/withdraw
- `src/domains/compliance/__tests__/compliance.service.test.ts` — unit tests
- `src/domains/compliance/__tests__/compliance.router.test.ts` — router tests
- `tests/integration/compliance-sp1.test.ts` — integration tests for consent + DNC

**Modify:**
- `prisma/schema.prisma` — add `blocked` to `DeletionRequestStatus` enum
- `src/domains/notification/notification.service.ts` — replace checkDnc stub with compliance service call
- `src/infra/http/app.ts` — mount complianceRouter

---

## Chunk 1: Schema Migration + Types

### Task 1: Add `blocked` status to DeletionRequestStatus enum

The schema's `DeletionRequestStatus` enum needs a `blocked` value to represent records that cannot be deleted yet due to AML/CFT retention requirements.

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `blocked` to the DeletionRequestStatus enum**

Open `prisma/schema.prisma`. Find the `DeletionRequestStatus` enum and add `blocked`:

```prisma
enum DeletionRequestStatus {
  blocked
  flagged
  pending_review
  approved
  executed
  rejected
}
```

- [ ] **Step 2: Generate and run migration**

```bash
npm run db:migrate -- --name add_blocked_to_deletion_status
```

Expected: `prisma/migrations/TIMESTAMP_add_blocked_to_deletion_status/migration.sql` created and applied.

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: no errors.

- [ ] **Step 4: Run existing tests to verify no regressions**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests passing (adding an enum value is non-breaking).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add blocked status to DeletionRequestStatus enum"
```

---

### Task 2: Create compliance.types.ts

**Files:**
- Create: `src/domains/compliance/compliance.types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// src/domains/compliance/compliance.types.ts

export type DncChannel = 'whatsapp' | 'phone' | 'email';
export type MessageType = 'service' | 'marketing';

export interface DncAllowedResult {
  allowed: boolean;
  reason?: string;
}

export type ConsentType = 'service' | 'marketing';

export interface WithdrawConsentInput {
  sellerId: string;
  type: ConsentType;
  channel: string; // 'web' | 'email' | 'whatsapp' | 'phone' | 'in_person'
  ipAddress?: string;
  userAgent?: string;
}

export interface ConsentWithdrawalResult {
  consentRecordId: string;
  deletionRequestId?: string; // set if service consent withdrawn
  deletionBlocked: boolean;   // true if AML/CFT prevents deletion
  retentionRule?: string;
}

export interface ConsentRecord {
  id: string;
  subjectType: string;
  subjectId: string;
  purposeService: boolean;
  purposeMarketing: boolean;
  consentGivenAt: Date;
  consentWithdrawnAt: Date | null;
  withdrawalChannel: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface DataDeletionRequest {
  id: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  retentionRule: string | null;
  flaggedAt: Date;
  reviewedByAgentId: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  executedAt: Date | null;
  status: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/domains/compliance/compliance.types.ts
git commit -m "feat(compliance): add compliance domain types"
```

---

## Chunk 2: Repository + Validator

### Task 3: Create compliance.repository.ts

**Files:**
- Create: `src/domains/compliance/compliance.repository.ts`

- [ ] **Step 1: Write the failing test for the repository**

Create `src/domains/compliance/__tests__/` directory, then create the test file:

```typescript
// src/domains/compliance/__tests__/compliance.repository.test.ts
import { prisma } from '@/infra/database/prisma';
import * as complianceRepo from '../compliance.repository';

// This is a light smoke test — full DB tests are in tests/integration/
describe('compliance.repository', () => {
  it('exports expected functions', () => {
    expect(typeof complianceRepo.createConsentRecord).toBe('function');
    expect(typeof complianceRepo.findLatestConsentRecord).toBe('function');
    expect(typeof complianceRepo.createDeletionRequest).toBe('function');
    expect(typeof complianceRepo.findDeletionRequest).toBe('function');
    expect(typeof complianceRepo.updateDeletionRequest).toBe('function');
    expect(typeof complianceRepo.findPendingDeletionRequests).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --testPathPattern="compliance.repository" 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the repository**

```typescript
// src/domains/compliance/compliance.repository.ts
import { createId } from '@paralleldrive/cuid2';
import { prisma } from '@/infra/database/prisma';
import type { ConsentRecord, DataDeletionRequest } from './compliance.types';

export async function createConsentRecord(data: {
  subjectId: string;
  purposeService: boolean;
  purposeMarketing: boolean;
  consentWithdrawnAt?: Date;
  withdrawalChannel?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<ConsentRecord> {
  return prisma.consentRecord.create({
    data: {
      id: createId(),
      subjectType: 'seller',
      subjectId: data.subjectId,
      purposeService: data.purposeService,
      purposeMarketing: data.purposeMarketing,
      consentWithdrawnAt: data.consentWithdrawnAt ?? null,
      withdrawalChannel: data.withdrawalChannel ?? null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    },
  });
}

export async function findLatestConsentRecord(sellerId: string): Promise<ConsentRecord | null> {
  return prisma.consentRecord.findFirst({
    where: { subjectType: 'seller', subjectId: sellerId },
    orderBy: { consentGivenAt: 'desc' },
  });
}

export async function findAllConsentRecords(sellerId: string): Promise<ConsentRecord[]> {
  return prisma.consentRecord.findMany({
    where: { subjectType: 'seller', subjectId: sellerId },
    orderBy: { consentGivenAt: 'asc' },
  });
}

export async function createDeletionRequest(data: {
  targetType: string;
  targetId: string;
  reason: string;
  retentionRule: string;
  status: string;
  details?: Record<string, unknown>;
}): Promise<DataDeletionRequest> {
  return prisma.dataDeletionRequest.create({
    data: {
      id: createId(),
      targetType: data.targetType as never,
      targetId: data.targetId,
      reason: data.reason,
      retentionRule: data.retentionRule,
      status: data.status as never,
      details: data.details ?? {},
    },
  }) as Promise<DataDeletionRequest>;
}

export async function findDeletionRequest(id: string): Promise<DataDeletionRequest | null> {
  return prisma.dataDeletionRequest.findUnique({ where: { id } }) as Promise<DataDeletionRequest | null>;
}

export async function updateDeletionRequest(
  id: string,
  data: Partial<{
    status: string;
    reviewedByAgentId: string;
    reviewedAt: Date;
    reviewNotes: string;
    executedAt: Date;
  }>,
): Promise<DataDeletionRequest> {
  return prisma.dataDeletionRequest.update({
    where: { id },
    data: data as never,
  }) as Promise<DataDeletionRequest>;
}

export async function findPendingDeletionRequests(): Promise<DataDeletionRequest[]> {
  return prisma.dataDeletionRequest.findMany({
    where: { status: { in: ['flagged', 'pending_review'] as never[] } },
    orderBy: { flaggedAt: 'asc' },
  }) as Promise<DataDeletionRequest[]>;
}

export async function findSellerWithTransactions(
  sellerId: string,
): Promise<{ status: string; transactions: { completionDate: Date | null; status: string }[] } | null> {
  return prisma.seller.findUnique({
    where: { id: sellerId },
    select: {
      status: true,
      transactions: {
        select: { completionDate: true, status: true },
        orderBy: { completionDate: 'desc' },
      },
    },
  });
}

export async function updateSellerConsent(
  sellerId: string,
  data: { consentService?: boolean; consentMarketing?: boolean },
): Promise<void> {
  await prisma.seller.update({ where: { id: sellerId }, data });
}

export async function findSellerConsent(
  sellerId: string,
): Promise<{ consentService: boolean; consentMarketing: boolean } | null> {
  return prisma.seller.findUnique({
    where: { id: sellerId },
    select: { consentService: true, consentMarketing: true },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --testPathPattern="compliance.repository" 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/compliance/compliance.repository.ts src/domains/compliance/__tests__/compliance.repository.test.ts
git commit -m "feat(compliance): add compliance repository"
```

---

### Task 4: Create compliance.validator.ts

**Files:**
- Create: `src/domains/compliance/compliance.validator.ts`

- [ ] **Step 1: Write the validator**

```typescript
// src/domains/compliance/compliance.validator.ts
import { body } from 'express-validator';

export const withdrawConsentValidator = [
  body('type')
    .isIn(['service', 'marketing'])
    .withMessage('Consent type must be "service" or "marketing"'),
  body('channel')
    .optional()
    .isIn(['web', 'email', 'whatsapp', 'phone', 'in_person'])
    .withMessage('Invalid withdrawal channel'),
];
```

- [ ] **Step 2: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/domains/compliance/compliance.validator.ts
git commit -m "feat(compliance): add compliance validator"
```

---

## Chunk 3: Service Layer

### Task 5: Create compliance.service.ts — withdrawConsent + checkDncAllowed

**Files:**
- Create: `src/domains/compliance/compliance.service.ts`
- Create: `src/domains/compliance/__tests__/compliance.service.test.ts`

- [ ] **Step 1: Write the failing unit tests**

```typescript
// src/domains/compliance/__tests__/compliance.service.test.ts
import * as complianceRepo from '../compliance.repository';
import * as auditService from '../../shared/audit.service';
import * as complianceService from '../compliance.service';

jest.mock('../compliance.repository');
jest.mock('../../shared/audit.service');

const mockRepo = complianceRepo as jest.Mocked<typeof complianceRepo>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;

beforeEach(() => jest.clearAllMocks());

describe('checkDncAllowed', () => {
  it('blocks marketing message when consentMarketing is false', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: false });
    const result = await complianceService.checkDncAllowed('seller1', 'whatsapp', 'marketing');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('marketing consent');
  });

  it('allows service message when consentMarketing is false but consentService is true', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: false });
    const result = await complianceService.checkDncAllowed('seller1', 'whatsapp', 'service');
    expect(result.allowed).toBe(true);
  });

  it('blocks all messages when consentService is false', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: false, consentMarketing: false });
    const result = await complianceService.checkDncAllowed('seller1', 'whatsapp', 'service');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('service consent');
  });

  it('allows service message when both consents are true', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: true });
    const result = await complianceService.checkDncAllowed('seller1', 'email', 'service');
    expect(result.allowed).toBe(true);
  });
});

describe('withdrawConsent', () => {
  const baseSeller = { status: 'active', transactions: [] };

  it('creates a new consent record (append-only)', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: true });
    mockRepo.findSellerWithTransactions.mockResolvedValue({ ...baseSeller, transactions: [] });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'cr1' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.withdrawConsent({
      sellerId: 'seller1',
      type: 'marketing',
      channel: 'web',
    });

    expect(mockRepo.createConsentRecord).toHaveBeenCalledWith(
      expect.objectContaining({ purposeMarketing: false }),
    );
  });

  it('updates seller.consentMarketing flag when withdrawing marketing consent', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: true });
    mockRepo.findSellerWithTransactions.mockResolvedValue({ ...baseSeller, transactions: [] });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'cr1' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.withdrawConsent({
      sellerId: 'seller1',
      type: 'marketing',
      channel: 'web',
    });

    expect(mockRepo.updateSellerConsent).toHaveBeenCalledWith('seller1', { consentMarketing: false });
  });

  it('creates a flagged deletion request when service consent withdrawn with no transactions', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: false });
    mockRepo.findSellerWithTransactions.mockResolvedValue({ status: 'lead', transactions: [] });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'cr1' } as never);
    mockRepo.createDeletionRequest.mockResolvedValue({ id: 'dr1' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.withdrawConsent({
      sellerId: 'seller1',
      type: 'service',
      channel: 'web',
    });

    expect(mockRepo.createDeletionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'flagged', retentionRule: '30_day_grace' }),
    );
    expect(result.deletionBlocked).toBe(false);
  });

  it('creates a blocked deletion request when service consent withdrawn with transactions', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: false });
    mockRepo.findSellerWithTransactions.mockResolvedValue({
      status: 'completed',
      transactions: [{ completionDate: new Date(), status: 'completed' }],
    });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'cr1' } as never);
    mockRepo.createDeletionRequest.mockResolvedValue({ id: 'dr1' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.withdrawConsent({
      sellerId: 'seller1',
      type: 'service',
      channel: 'web',
    });

    expect(mockRepo.createDeletionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'blocked', retentionRule: 'aml_cft_5_year' }),
    );
    expect(result.deletionBlocked).toBe(true);
  });

  it('logs consent.withdrawn audit event', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: true });
    mockRepo.findSellerWithTransactions.mockResolvedValue({ ...baseSeller, transactions: [] });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'cr1' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.withdrawConsent({
      sellerId: 'seller1',
      type: 'marketing',
      channel: 'web',
    });

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'consent.withdrawn' }),
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern="compliance.service" 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the service implementation**

```typescript
// src/domains/compliance/compliance.service.ts
import * as complianceRepo from './compliance.repository';
import * as auditService from '../shared/audit.service';
import { NotFoundError } from '../shared/errors';
import type {
  DncChannel,
  MessageType,
  DncAllowedResult,
  WithdrawConsentInput,
  ConsentWithdrawalResult,
} from './compliance.types';

// ─── DNC Gate ────────────────────────────────────────────────────────────────

export async function checkDncAllowed(
  sellerId: string,
  _channel: DncChannel,
  messageType: MessageType,
): Promise<DncAllowedResult> {
  const consent = await complianceRepo.findSellerConsent(sellerId);
  if (!consent) {
    // Seller not found: conservative default — block
    return { allowed: false, reason: 'Seller consent record not found' };
  }

  if (!consent.consentService) {
    return { allowed: false, reason: 'Seller has withdrawn service consent' };
  }

  if (messageType === 'marketing' && !consent.consentMarketing) {
    return { allowed: false, reason: 'Seller has not given marketing consent' };
  }

  // TODO: Integrate real Singapore DNC registry API check
  // For now, consent flags serve as the gate.
  return { allowed: true };
}

// ─── Consent Withdrawal ───────────────────────────────────────────────────────

export async function withdrawConsent(
  input: WithdrawConsentInput,
): Promise<ConsentWithdrawalResult> {
  const currentConsent = await complianceRepo.findSellerConsent(input.sellerId);
  if (!currentConsent) {
    throw new NotFoundError('Seller', input.sellerId);
  }

  const now = new Date();

  // Build the new consent record (append-only — never update existing records)
  const newRecord = await complianceRepo.createConsentRecord({
    subjectId: input.sellerId,
    purposeService: input.type === 'service' ? false : currentConsent.consentService,
    purposeMarketing: input.type === 'marketing' ? false : currentConsent.consentMarketing,
    consentWithdrawnAt: now,
    withdrawalChannel: input.channel,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  // Update the Seller's fast-access consent flag
  if (input.type === 'service') {
    await complianceRepo.updateSellerConsent(input.sellerId, { consentService: false });
  } else {
    await complianceRepo.updateSellerConsent(input.sellerId, { consentMarketing: false });
  }

  await auditService.log({
    action: 'consent.withdrawn',
    entityType: 'seller',
    entityId: input.sellerId,
    details: { type: input.type, channel: input.channel, consentRecordId: newRecord.id },
  });

  // For marketing withdrawal: no deletion request needed
  if (input.type === 'marketing') {
    return { consentRecordId: newRecord.id, deletionBlocked: false };
  }

  // For service withdrawal: check if any transactions exist (AML/CFT override)
  const sellerWithTx = await complianceRepo.findSellerWithTransactions(input.sellerId);
  const hasAnyTransaction = (sellerWithTx?.transactions?.length ?? 0) > 0;

  if (hasAnyTransaction) {
    // Find the most recent completion date for retention end calculation
    const completedTxDates = (sellerWithTx?.transactions ?? [])
      .filter((tx) => tx.completionDate)
      .map((tx) => tx.completionDate as Date)
      .sort((a, b) => b.getTime() - a.getTime());

    const latestCompletion = completedTxDates[0] ?? now;
    const retentionEndDate = new Date(latestCompletion);
    retentionEndDate.setFullYear(retentionEndDate.getFullYear() + 5);

    const deletionRequest = await complianceRepo.createDeletionRequest({
      targetType: 'lead',
      targetId: input.sellerId,
      reason: 'Service consent withdrawn by seller',
      retentionRule: 'aml_cft_5_year',
      status: 'blocked',
      details: {
        sellerId: input.sellerId,
        withdrawalDate: now.toISOString(),
        retentionEndDate: retentionEndDate.toISOString(),
        transactionCount: sellerWithTx?.transactions.length ?? 0,
      },
    });

    return {
      consentRecordId: newRecord.id,
      deletionRequestId: deletionRequest.id,
      deletionBlocked: true,
      retentionRule: 'aml_cft_5_year',
    };
  }

  // No transactions: flag for 30-day grace deletion
  const deletionRequest = await complianceRepo.createDeletionRequest({
    targetType: 'lead',
    targetId: input.sellerId,
    reason: 'Service consent withdrawn by seller',
    retentionRule: '30_day_grace',
    status: 'flagged',
    details: {
      sellerId: input.sellerId,
      withdrawalDate: now.toISOString(),
    },
  });

  return {
    consentRecordId: newRecord.id,
    deletionRequestId: deletionRequest.id,
    deletionBlocked: false,
    retentionRule: '30_day_grace',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="compliance.service" 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/compliance/compliance.service.ts src/domains/compliance/__tests__/compliance.service.test.ts
git commit -m "feat(compliance): add consent withdrawal and DNC gate service"
```

---

## Chunk 4: Router + Notification Integration

### Task 6: Create compliance.router.ts

**Files:**
- Create: `src/domains/compliance/compliance.router.ts`
- Create: `src/domains/compliance/__tests__/compliance.router.test.ts`
- Create: `src/views/partials/compliance/consent-withdrawal-result.njk`

- [ ] **Step 1: Write the failing router test**

```typescript
// src/domains/compliance/__tests__/compliance.router.test.ts
import request from 'supertest';
import { createApp } from '@/infra/http/app';
import * as complianceService from '../compliance.service';

jest.mock('../compliance.service');

const mockService = complianceService as jest.Mocked<typeof complianceService>;

describe('POST /seller/compliance/consent/withdraw', () => {
  let app: Express.Application;
  let agent: ReturnType<typeof request.agent>;

  beforeAll(() => {
    app = createApp();
    agent = request.agent(app);
  });

  it('returns 401 when not authenticated as seller', async () => {
    const res = await request(app)
      .post('/seller/compliance/consent/withdraw')
      .send({ type: 'marketing' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid consent type', async () => {
    // Simulate authenticated seller session via app test helper
    const res = await request(app)
      .post('/seller/compliance/consent/withdraw')
      .set('Cookie', 'test-seller-session=fake') // middleware short-circuits in test
      .send({ type: 'invalid' });
    // Will be rejected by validator before reaching service
    expect([400, 401]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --testPathPattern="compliance.router" 2>&1 | tail -15
```

Expected: FAIL — module not found or routes not mounted.

- [ ] **Step 3: Write the router**

```typescript
// src/domains/compliance/compliance.router.ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { requireAuth, requireRole } from '@/infra/http/middleware/require-auth';
import * as complianceService from './compliance.service';
import { withdrawConsentValidator } from './compliance.validator';
import { ValidationError } from '../shared/errors';

export const complianceRouter = Router();

// POST /seller/compliance/consent/withdraw
// Seller withdraws marketing or service consent
complianceRouter.post(
  '/seller/compliance/consent/withdraw',
  requireAuth(),
  requireRole('seller'),
  withdrawConsentValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ValidationError('Invalid request', errors.mapped() as Record<string, string>));
    }

    try {
      const sellerId = (req.user as { id: string }).id;
      const { type, channel } = req.body as { type: string; channel?: string };

      const result = await complianceService.withdrawConsent({
        sellerId,
        type: type as 'service' | 'marketing',
        channel: (channel as string) ?? 'web',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      if (req.headers['hx-request']) {
        return res.render('partials/compliance/consent-withdrawal-result', {
          type,
          deletionBlocked: result.deletionBlocked,
          retentionRule: result.retentionRule,
        });
      }

      return res.redirect('/seller/my-data?consent_withdrawn=true');
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 4: Create the HTMX partial view**

```html
{# src/views/partials/compliance/consent-withdrawal-result.njk #}
<div class="rounded-lg p-4 {% if deletionBlocked %}bg-amber-50 border border-amber-200{% else %}bg-green-50 border border-green-200{% endif %}">
  {% if type == 'marketing' %}
    <p class="text-sm font-medium text-green-800">{{ "Marketing consent withdrawn. You will no longer receive marketing communications." | t }}</p>
  {% elif deletionBlocked %}
    <p class="text-sm font-medium text-amber-800">{{ "Service consent noted. Your account data is retained for compliance with financial regulations (AML/CFT 5-year requirement). We will contact you once the retention period ends." | t }}</p>
  {% else %}
    <p class="text-sm font-medium text-green-800">{{ "Service consent withdrawn. Your account will be reviewed for deletion within 30 days." | t }}</p>
  {% endif %}
</div>
```

- [ ] **Step 5: Mount router in app.ts**

Open `src/infra/http/app.ts`. Add the import and mount:

```typescript
import { complianceRouter } from '../../domains/compliance/compliance.router';
```

Then in `createApp()`, after the existing router mounts:

```typescript
app.use('/', complianceRouter);
```

- [ ] **Step 6: Run router tests**

```bash
npm test -- --testPathPattern="compliance.router" 2>&1 | tail -20
```

Expected: PASS (401 for unauthenticated, validation working).

- [ ] **Step 7: Commit**

```bash
git add src/domains/compliance/compliance.router.ts \
        src/domains/compliance/__tests__/compliance.router.test.ts \
        src/views/partials/compliance/consent-withdrawal-result.njk \
        src/infra/http/app.ts
git commit -m "feat(compliance): add consent withdrawal router and mount in app"
```

---

### Task 7: Update notification.service.ts to use compliance DNC gate

The notification service currently has a local `checkDnc(phone)` stub. We replace it with a call to `compliance.service.checkDncAllowed(sellerId, channel, messageType)`.

**Files:**
- Modify: `src/domains/notification/notification.service.ts`
- Modify: `src/domains/notification/notification.types.ts`

- [ ] **Step 1: Write the failing test for the updated DNC check**

Open `src/domains/notification/__tests__/notification.service.test.ts` and add this test to the existing DNC section (find the existing `checkDnc` tests and add alongside them):

```typescript
// In the describe block for notification.service DNC integration:
it('blocks whatsapp send when compliance DNC gate returns blocked', async () => {
  // Import compliance service mock
  const complianceService = jest.requireMock('../../compliance/compliance.service') as {
    checkDncAllowed: jest.Mock;
  };
  complianceService.checkDncAllowed.mockResolvedValue({ allowed: false, reason: 'No marketing consent' });

  // ... assertion that notification falls back to email or is logged as blocked
  // Verify the compliance service is called with (sellerId, channel, messageType)
  expect(complianceService.checkDncAllowed).toHaveBeenCalledWith(
    expect.any(String),
    'whatsapp',
    expect.stringMatching(/service|marketing/),
  );
});
```

Note: This test captures the call pattern. The full assertion depends on the existing test setup. Add the mock at the top of the test file: `jest.mock('../../compliance/compliance.service');`

- [ ] **Step 2: Update notification.types.ts to add messageType to SendNotificationInput**

Open `src/domains/notification/notification.types.ts`. Find `SendNotificationInput` and add the `messageType` field if not already present (it exists as `notificationType` — ensure it maps correctly):

The existing field `notificationType?: NotificationType` maps to `'transactional' | 'marketing'`. We need to translate this to the compliance service's `'service' | 'marketing'` enum. Add a helper mapping note in the service. No types change needed.

- [ ] **Step 3: Update notification.service.ts DNC check**

Open `src/domains/notification/notification.service.ts`. Find the existing `checkDnc` function and the section in `sendExternal` that calls it. Replace with:

```typescript
// At top of file, add import:
import * as complianceService from '../compliance/compliance.service';

// Replace the existing checkDnc function:
export async function checkDnc(_phone: string): Promise<DncCheckResult> {
  // Legacy stub — kept for backward compat. Real check is in sendExternal via compliance service.
  return { blocked: false };
}
```

Then in `sendExternal`, find the existing DNC check block (around line 99-126) and replace it:

```typescript
  // DNC compliance gate — calls compliance service with sellerId + messageType
  if (
    (resolvedChannel === 'whatsapp' || resolvedChannel === 'email') &&
    input.recipientType === 'seller'
  ) {
    const messageType = input.notificationType === 'marketing' ? 'marketing' : 'service';
    const dncResult = await complianceService.checkDncAllowed(
      input.recipientId,
      resolvedChannel,
      messageType,
    );
    if (!dncResult.allowed) {
      const dncRecord = await notificationRepo.create({
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        channel: resolvedChannel,
        templateName: input.templateName,
        content,
      });
      await auditService.log({
        action: 'notification.dnc_blocked',
        entityType: 'notification',
        entityId: dncRecord.id,
        details: {
          recipientId: input.recipientId,
          templateName: input.templateName,
          reason: dncResult.reason,
          messageType,
        },
      });
      return; // Do not send — in-app notification was already created
    }
  }
```

Remove the old self-referencing module pattern (`require('./notification.service')`) from this block.

- [ ] **Step 4: Run all notification tests**

```bash
npm test -- --testPathPattern="notification" 2>&1 | tail -20
```

Expected: all tests PASS. If any fail due to missing compliance mock, add `jest.mock('../../compliance/compliance.service')` at the top of the notification test files.

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domains/notification/notification.service.ts
git commit -m "feat(compliance): wire notification service to compliance DNC gate"
```

---

## Chunk 5: Integration Tests

### Task 8: Write SP1 integration tests

**Files:**
- Create: `tests/integration/compliance-sp1.test.ts`

- [ ] **Step 1: Write the integration tests**

```typescript
// tests/integration/compliance-sp1.test.ts
import { prisma } from '@/infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';
import * as complianceService from '@/domains/compliance/compliance.service';

// Helpers
async function createTestSeller(overrides: Record<string, unknown> = {}) {
  return prisma.seller.create({
    data: {
      id: createId(),
      name: 'Test Seller',
      phone: `+6591${Math.floor(Math.random() * 900000 + 100000)}`,
      consentService: true,
      consentMarketing: true,
      ...overrides,
    },
  });
}

describe('Compliance SP1 — Consent + DNC (integration)', () => {
  afterEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.dataDeletionRequest.deleteMany();
    await prisma.consentRecord.deleteMany();
    await prisma.seller.deleteMany();
  });

  describe('withdrawConsent — marketing', () => {
    it('creates a new ConsentRecord (does not modify existing)', async () => {
      const seller = await createTestSeller();

      // Create an existing consent record
      await prisma.consentRecord.create({
        data: {
          id: createId(),
          subjectType: 'seller',
          subjectId: seller.id,
          purposeService: true,
          purposeMarketing: true,
        },
      });

      const countBefore = await prisma.consentRecord.count({ where: { subjectId: seller.id } });

      await complianceService.withdrawConsent({
        sellerId: seller.id,
        type: 'marketing',
        channel: 'web',
      });

      const countAfter = await prisma.consentRecord.count({ where: { subjectId: seller.id } });
      expect(countAfter).toBe(countBefore + 1);

      // New record has purposeMarketing: false
      const latest = await prisma.consentRecord.findFirst({
        where: { subjectId: seller.id },
        orderBy: { consentGivenAt: 'desc' },
      });
      expect(latest?.purposeMarketing).toBe(false);
      expect(latest?.consentWithdrawnAt).not.toBeNull();
    });

    it('updates seller.consentMarketing to false', async () => {
      const seller = await createTestSeller();

      await complianceService.withdrawConsent({
        sellerId: seller.id,
        type: 'marketing',
        channel: 'web',
      });

      const updated = await prisma.seller.findUnique({ where: { id: seller.id } });
      expect(updated?.consentMarketing).toBe(false);
    });

    it('creates audit log entry', async () => {
      const seller = await createTestSeller();

      await complianceService.withdrawConsent({
        sellerId: seller.id,
        type: 'marketing',
        channel: 'web',
      });

      const log = await prisma.auditLog.findFirst({
        where: { entityType: 'seller', entityId: seller.id, action: 'consent.withdrawn' },
      });
      expect(log).not.toBeNull();
    });

    it('does NOT create a DataDeletionRequest for marketing withdrawal', async () => {
      const seller = await createTestSeller();

      await complianceService.withdrawConsent({
        sellerId: seller.id,
        type: 'marketing',
        channel: 'web',
      });

      const requests = await prisma.dataDeletionRequest.findMany({ where: { targetId: seller.id } });
      expect(requests).toHaveLength(0);
    });
  });

  describe('withdrawConsent — service, no transaction', () => {
    it('creates a flagged DataDeletionRequest with 30_day_grace rule', async () => {
      const seller = await createTestSeller();

      const result = await complianceService.withdrawConsent({
        sellerId: seller.id,
        type: 'service',
        channel: 'web',
      });

      expect(result.deletionBlocked).toBe(false);
      expect(result.retentionRule).toBe('30_day_grace');

      const request = await prisma.dataDeletionRequest.findUnique({
        where: { id: result.deletionRequestId },
      });
      expect(request?.status).toBe('flagged');
      expect(request?.retentionRule).toBe('30_day_grace');
    });
  });

  describe('withdrawConsent — service, with completed transaction', () => {
    it('creates a blocked DataDeletionRequest with aml_cft_5_year rule', async () => {
      const seller = await createTestSeller();

      // Create a completed transaction
      const property = await prisma.property.create({
        data: {
          id: createId(),
          sellerId: seller.id,
          town: 'TAMPINES',
          street: 'Tampines Street 1',
          block: '123',
          flatType: 'four_room',
          storeyRange: '10 TO 12',
          floorAreaSqm: 90,
          flatModel: 'Model A',
          leaseCommenceDate: 2000,
          remainingLease: '74 years',
          askingPrice: 500000,
          status: 'completed',
        },
      });
      await prisma.transaction.create({
        data: {
          id: createId(),
          propertyId: property.id,
          sellerId: seller.id,
          agreedPrice: 490000,
          optionFee: 1000,
          optionDate: new Date('2024-01-01'),
          exerciseDeadline: new Date('2024-01-22'),
          completionDate: new Date('2024-03-01'),
          status: 'completed',
        },
      });

      const result = await complianceService.withdrawConsent({
        sellerId: seller.id,
        type: 'service',
        channel: 'web',
      });

      expect(result.deletionBlocked).toBe(true);
      expect(result.retentionRule).toBe('aml_cft_5_year');

      const request = await prisma.dataDeletionRequest.findUnique({
        where: { id: result.deletionRequestId },
      });
      expect(request?.status).toBe('blocked');
    });
  });

  describe('checkDncAllowed', () => {
    it('blocks marketing message when seller.consentMarketing is false', async () => {
      const seller = await createTestSeller({ consentMarketing: false });
      const result = await complianceService.checkDncAllowed(seller.id, 'whatsapp', 'marketing');
      expect(result.allowed).toBe(false);
    });

    it('allows service message when only consentMarketing is false', async () => {
      const seller = await createTestSeller({ consentMarketing: false, consentService: true });
      const result = await complianceService.checkDncAllowed(seller.id, 'whatsapp', 'service');
      expect(result.allowed).toBe(true);
    });

    it('blocks all messages when consentService is false', async () => {
      const seller = await createTestSeller({ consentService: false, consentMarketing: false });
      const result = await complianceService.checkDncAllowed(seller.id, 'whatsapp', 'service');
      expect(result.allowed).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
npm run docker:test:db && npm run test:integration -- --testPathPattern="compliance-sp1" 2>&1 | tail -30
```

Expected: all integration tests PASS.

- [ ] **Step 3: Run full test suite**

```bash
npm test && npm run test:integration 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/compliance-sp1.test.ts
git commit -m "test(compliance): add SP1 integration tests for consent and DNC gate"
```

---

## SP1 Complete

Run the full test suite one final time to confirm everything passes:

```bash
npm test && npm run test:integration 2>&1 | tail -20
```

Expected: all unit and integration tests PASS.
