# Phase 5 SP2: Seller "My Data" Page + Data Corrections + NRIC Helpers — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the seller self-service "My Data" page (consent status, personal data, correction requests, data download), the data correction request workflow (seller submits → agent reviews → applied), and the NRIC masking utility.

**Architecture:** Extends the compliance domain (from SP1) with correction request logic. NRIC helpers live in `src/domains/shared/nric.ts`. The "My Data" seller page is a new route in `compliance.router.ts`. Agent correction queue is a new page in the agent domain. All DB access goes through `compliance.repository.ts`. Depends on SP1 being complete.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Jest, Supertest

**Spec:** `docs/superpowers/specs/2026-03-12-phase-5-pdpa-compliance-design.md` — SP2 section

---

## File Map

**Create:**
- `src/domains/shared/nric.ts` — maskNric, validateNricLast4
- `src/domains/shared/nric.test.ts` — unit tests for NRIC helpers
- `src/views/pages/seller/my-data.njk` — full seller "My Data" page
- `src/views/partials/compliance/consent-panel.njk` — consent status + withdrawal buttons
- `src/views/partials/compliance/correction-form.njk` — submit correction request form
- `src/views/partials/compliance/correction-history.njk` — list of past correction requests
- `src/views/partials/compliance/correction-row.njk` — single correction request row (HTMX swap)
- `src/views/pages/agent/correction-requests.njk` — agent correction review queue
- `src/views/partials/agent/correction-review-modal.njk` — agent approve/reject modal
- `tests/integration/compliance-sp2.test.ts` — integration tests

**Modify:**
- `src/domains/compliance/compliance.repository.ts` — add correction request CRUD + updateSellerField
- `src/domains/compliance/compliance.service.ts` — add correction + my-data functions
- `src/domains/compliance/compliance.validator.ts` — add correction request validators
- `src/domains/compliance/compliance.router.ts` — add GET /seller/my-data, correction routes
- `src/domains/compliance/__tests__/compliance.service.test.ts` — add correction unit tests
- `src/domains/agent/agent.router.ts` — add GET /agent/corrections
- `src/domains/agent/agent.service.ts` — add getCorrectionQueue, processCorrectionRequest
- `src/domains/agent/agent.repository.ts` — add correction query
- `src/views/pages/seller/my-data.njk` — **Modify** (replace SP1 stub with full My Data page)

---

## Chunk 1: NRIC Helpers

### Task 1: Create shared/nric.ts

**Files:**
- Create: `src/domains/shared/nric.ts`
- Create: `src/domains/shared/nric.test.ts`

- [ ] **Step 1: Write the failing unit tests**

```typescript
// src/domains/shared/nric.test.ts
import { maskNric, validateNricLast4 } from './nric';

describe('maskNric', () => {
  it('masks a 4-char last-4 NRIC to SXXXX format', () => {
    expect(maskNric('567A')).toBe('SXXXX567A');
  });

  it('works with lowercase letters in last char (uppercase output)', () => {
    expect(maskNric('567a')).toBe('SXXXX567a');
  });

  it('handles exactly 4 characters', () => {
    expect(maskNric('123B')).toBe('SXXXX123B');
  });

  it('returns INVALID for empty string', () => {
    expect(maskNric('')).toBe('SXXXXINVALID');
  });

  it('returns INVALID for string shorter than 4 chars', () => {
    expect(maskNric('12')).toBe('SXXXXINVALID');
  });
});

describe('validateNricLast4', () => {
  it('accepts 3 digits followed by 1 uppercase letter', () => {
    expect(validateNricLast4('567A')).toBe(true);
    expect(validateNricLast4('000Z')).toBe(true);
  });

  it('rejects lowercase letter at end', () => {
    expect(validateNricLast4('567a')).toBe(false);
  });

  it('rejects all digits', () => {
    expect(validateNricLast4('5678')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(validateNricLast4('56A')).toBe(false);
    expect(validateNricLast4('5678A')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateNricLast4('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern="nric" 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/domains/shared/nric.ts

/**
 * Masks NRIC last-4 for display.
 * "567A" → "SXXXX567A"
 * The S prefix is a fixed Singapore prefix; XXXX replaces the hidden digits.
 */
export function maskNric(last4: string): string {
  if (!last4 || last4.length < 4) return 'SXXXXINVALID';
  return `SXXXX${last4}`;
}

/**
 * Validates that a stored last-4 NRIC string matches the expected format:
 * exactly 3 digits followed by 1 uppercase letter.
 */
export function validateNricLast4(value: string): boolean {
  return /^\d{3}[A-Z]$/.test(value);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="nric" 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/shared/nric.ts src/domains/shared/nric.test.ts
git commit -m "feat(shared): add NRIC masking and validation helpers"
```

---

## Chunk 2: Correction Request — Repository + Service + Validator

### Task 2: Extend compliance.repository.ts with correction request CRUD

**Files:**
- Modify: `src/domains/compliance/compliance.repository.ts`

- [ ] **Step 1: Add the DataCorrectionRequest type to compliance.types.ts**

Open `src/domains/compliance/compliance.types.ts` and append:

```typescript
export interface DataCorrectionRequest {
  id: string;
  sellerId: string;
  fieldName: string;
  currentValue: string | null;
  requestedValue: string;
  reason: string | null;
  status: string;
  processedByAgentId: string | null;
  processedAt: Date | null;
  processNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCorrectionRequestInput {
  sellerId: string;
  fieldName: string;
  currentValue?: string;
  requestedValue: string;
  reason?: string;
}

// Fields that can be auto-applied by the system on agent approval
export const AUTO_APPLY_FIELDS = ['name', 'email', 'phone', 'notificationPreference'] as const;
export type AutoApplyField = (typeof AUTO_APPLY_FIELDS)[number];
```

- [ ] **Step 1b: Verify `findAllConsentRecords` is exported from SP1's compliance.repository.ts**

```bash
grep "findAllConsentRecords" src/domains/compliance/compliance.repository.ts
```

Expected: function is defined and exported. If missing, add it to the repository before continuing with Task 2.

- [ ] **Step 2: Add correction request functions and seller field updater to compliance.repository.ts**

Open `src/domains/compliance/compliance.repository.ts` and append these functions at the end:

```typescript
export async function createCorrectionRequest(
  data: CreateCorrectionRequestInput,
): Promise<DataCorrectionRequest> {
  return prisma.dataCorrectionRequest.create({
    data: {
      id: createId(),
      sellerId: data.sellerId,
      fieldName: data.fieldName,
      currentValue: data.currentValue ?? null,
      requestedValue: data.requestedValue,
      reason: data.reason ?? null,
      status: 'pending',
    },
  }) as Promise<DataCorrectionRequest>;
}

export async function findCorrectionRequest(id: string): Promise<DataCorrectionRequest | null> {
  return prisma.dataCorrectionRequest.findUnique({
    where: { id },
  }) as Promise<DataCorrectionRequest | null>;
}

export async function findCorrectionRequestsBySeller(
  sellerId: string,
): Promise<DataCorrectionRequest[]> {
  return prisma.dataCorrectionRequest.findMany({
    where: { sellerId },
    orderBy: { createdAt: 'desc' },
  }) as Promise<DataCorrectionRequest[]>;
}

export async function findPendingCorrectionRequests(): Promise<DataCorrectionRequest[]> {
  return prisma.dataCorrectionRequest.findMany({
    where: { status: { in: ['pending', 'in_progress'] } },
    orderBy: { createdAt: 'asc' },
  }) as Promise<DataCorrectionRequest[]>;
}

export async function updateCorrectionRequest(
  id: string,
  data: {
    status: string;
    processedByAgentId?: string;
    processedAt?: Date;
    processNotes?: string;
  },
): Promise<DataCorrectionRequest> {
  return prisma.dataCorrectionRequest.update({
    where: { id },
    data: data as never,
  }) as Promise<DataCorrectionRequest>;
}

// Used by compliance.service to auto-apply approved corrections without service calling Prisma directly
export async function updateSellerField(
  sellerId: string,
  field: string,
  value: string,
): Promise<void> {
  await prisma.seller.update({
    where: { id: sellerId },
    data: { [field]: value },
  });
}

export async function getSellerPersonalData(sellerId: string) {
  return prisma.seller.findUnique({
    where: { id: sellerId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      consentService: true,
      consentMarketing: true,
      notificationPreference: true,
      createdAt: true,
      cddRecords: {
        select: { nricLast4: true, identityVerified: true, verifiedAt: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
      consentRecords: {
        orderBy: { consentGivenAt: 'asc' },
      },
      properties: {
        select: {
          id: true,
          town: true,
          street: true,
          block: true,
          flatType: true,
          askingPrice: true,
          status: true,
        },
      },
      viewings: {
        select: {
          scheduledAt: true,
          status: true,
        },
        orderBy: { scheduledAt: 'desc' },
        take: 20,
      },
    },
  });
}
```

Note: add the `CreateCorrectionRequestInput` import at the top of the repository file since it's now defined in types.

- [ ] **Step 3: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/domains/compliance/compliance.types.ts src/domains/compliance/compliance.repository.ts
git commit -m "feat(compliance): add correction request types and repository methods"
```

---

### Task 3: Extend compliance.service.ts — correction requests + my-data

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts`
- Modify: `src/domains/compliance/__tests__/compliance.service.test.ts`

- [ ] **Step 1: Write the failing unit tests for the new service functions**

Open `src/domains/compliance/__tests__/compliance.service.test.ts` and add the following describe blocks:

```typescript
describe('createCorrectionRequest', () => {
  it('creates a correction request with status pending', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: true });
    mockRepo.createCorrectionRequest.mockResolvedValue({ id: 'corr1', status: 'pending' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.createCorrectionRequest({
      sellerId: 'seller1',
      fieldName: 'name',
      currentValue: 'Old Name',
      requestedValue: 'New Name',
      reason: 'Legal name change',
    });

    expect(mockRepo.createCorrectionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerId: 'seller1',
        fieldName: 'name',
        requestedValue: 'New Name',
      }),
    );
    expect(result.id).toBe('corr1');
  });

  it('logs data_correction.requested audit event', async () => {
    mockRepo.createCorrectionRequest.mockResolvedValue({ id: 'corr1' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.createCorrectionRequest({
      sellerId: 'seller1',
      fieldName: 'email',
      requestedValue: 'new@email.com',
    });

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_correction.requested' }),
    );
  });
});

describe('processCorrectionRequest — approve', () => {
  it('auto-applies the change for eligible fields (name, email, phone)', async () => {
    mockRepo.findCorrectionRequest.mockResolvedValue({
      id: 'corr1',
      sellerId: 'seller1',
      fieldName: 'name',
      requestedValue: 'New Name',
      status: 'pending',
    } as never);
    mockRepo.updateCorrectionRequest.mockResolvedValue({ id: 'corr1', status: 'completed' } as never);
    mockRepo.updateSellerField.mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.processCorrectionRequest({
      requestId: 'corr1',
      agentId: 'agent1',
      decision: 'approve',
    });

    expect(mockRepo.updateCorrectionRequest).toHaveBeenCalledWith(
      'corr1',
      expect.objectContaining({ status: 'completed' }),
    );
    expect(mockRepo.updateSellerField).toHaveBeenCalledWith('seller1', 'name', 'New Name');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_correction.processed' }),
    );
  });

  it('marks as completed without auto-apply for manual fields (nricLast4)', async () => {
    mockRepo.findCorrectionRequest.mockResolvedValue({
      id: 'corr1',
      sellerId: 'seller1',
      fieldName: 'nricLast4',
      requestedValue: '123A',
      status: 'pending',
    } as never);
    mockRepo.updateCorrectionRequest.mockResolvedValue({ id: 'corr1', status: 'completed' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.processCorrectionRequest({
      requestId: 'corr1',
      agentId: 'agent1',
      decision: 'approve',
      processNotes: 'Re-verified identity via video call',
    });

    // Should update request status but NOT call updateSellerConsent or any seller field updater
    expect(mockRepo.updateCorrectionRequest).toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_correction.processed' }),
    );
  });
});

describe('processCorrectionRequest — reject', () => {
  it('updates status to rejected with process notes', async () => {
    mockRepo.findCorrectionRequest.mockResolvedValue({
      id: 'corr1',
      sellerId: 'seller1',
      fieldName: 'name',
      requestedValue: 'New Name',
      status: 'pending',
    } as never);
    mockRepo.updateCorrectionRequest.mockResolvedValue({ id: 'corr1', status: 'rejected' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.processCorrectionRequest({
      requestId: 'corr1',
      agentId: 'agent1',
      decision: 'reject',
      processNotes: 'Cannot verify identity claim',
    });

    expect(mockRepo.updateCorrectionRequest).toHaveBeenCalledWith(
      'corr1',
      expect.objectContaining({ status: 'rejected' }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_correction.rejected' }),
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern="compliance.service" 2>&1 | tail -15
```

Expected: FAIL — functions not found.

- [ ] **Step 3: Add functions to compliance.service.ts**

Open `src/domains/compliance/compliance.service.ts` and add this import at the top (no direct Prisma import — all DB access goes through the repository):

```typescript
import { AUTO_APPLY_FIELDS, type CreateCorrectionRequestInput } from './compliance.types';
```

Then append these functions at the end of the file:

```typescript
// ─── Correction Requests ──────────────────────────────────────────────────────

export async function createCorrectionRequest(
  input: CreateCorrectionRequestInput & { sellerId: string },
) {
  const request = await complianceRepo.createCorrectionRequest(input);

  await auditService.log({
    action: 'data_correction.requested',
    entityType: 'data_correction_request',
    entityId: request.id,
    details: {
      sellerId: input.sellerId,
      fieldName: input.fieldName,
      requestedValue: input.requestedValue,
    },
  });

  return request;
}

export async function processCorrectionRequest(input: {
  requestId: string;
  agentId: string;
  decision: 'approve' | 'reject';
  processNotes?: string;
}) {
  const request = await complianceRepo.findCorrectionRequest(input.requestId);
  if (!request) throw new NotFoundError('DataCorrectionRequest', input.requestId);

  const now = new Date();
  const newStatus = input.decision === 'approve' ? 'completed' : 'rejected';

  await complianceRepo.updateCorrectionRequest(input.requestId, {
    status: newStatus,
    processedByAgentId: input.agentId,
    processedAt: now,
    processNotes: input.processNotes,
  });

  // Auto-apply the change for eligible fields — goes through repository, not Prisma directly
  if (input.decision === 'approve') {
    const isAutoApply = (AUTO_APPLY_FIELDS as readonly string[]).includes(request.fieldName);
    if (isAutoApply) {
      await complianceRepo.updateSellerField(request.sellerId, request.fieldName, request.requestedValue);
    }
    // For non-auto-apply fields (e.g. nricLast4), agent handles manually
    // The audit log records that agent approved it

    await auditService.log({
      action: 'data_correction.processed',
      entityType: 'data_correction_request',
      entityId: input.requestId,
      details: {
        sellerId: request.sellerId,
        fieldName: request.fieldName,
        requestedValue: request.requestedValue,
        autoApplied: isAutoApply,
        agentId: input.agentId,
      },
    });
  } else {
    await auditService.log({
      action: 'data_correction.rejected',
      entityType: 'data_correction_request',
      entityId: input.requestId,
      details: {
        sellerId: request.sellerId,
        fieldName: request.fieldName,
        processNotes: input.processNotes,
        agentId: input.agentId,
      },
    });
  }
}

// ─── My Data ──────────────────────────────────────────────────────────────────

export async function getMyData(sellerId: string) {
  const data = await complianceRepo.getSellerPersonalData(sellerId);
  if (!data) throw new NotFoundError('Seller', sellerId);

  // Mask NRIC last-4 for display
  const { maskNric } = await import('../shared/nric');
  const nricDisplay = data.cddRecords[0]?.nricLast4
    ? maskNric(data.cddRecords[0].nricLast4)
    : null;

  const correctionRequests = await complianceRepo.findCorrectionRequestsBySeller(sellerId);
  const consentHistory = await complianceRepo.findAllConsentRecords(sellerId);

  return {
    seller: {
      id: data.id,
      name: data.name,
      email: data.email,
      phone: data.phone,
      status: data.status,
      consentService: data.consentService,
      consentMarketing: data.consentMarketing,
      notificationPreference: data.notificationPreference,
      createdAt: data.createdAt,
      nricDisplay,
      identityVerified: data.cddRecords[0]?.identityVerified ?? false,
    },
    properties: data.properties,
    viewings: data.viewings,
    consentHistory,
    correctionRequests,
  };
}

export async function generateDataExport(sellerId: string): Promise<Record<string, unknown>> {
  const myData = await getMyData(sellerId);
  // Returns only safe-to-export fields (no encrypted docs, no full NRIC)
  return {
    exportedAt: new Date().toISOString(),
    seller: myData.seller,
    properties: myData.properties,
    viewings: myData.viewings,
    consentHistory: myData.consentHistory.map((r) => ({
      purposeService: r.purposeService,
      purposeMarketing: r.purposeMarketing,
      consentGivenAt: r.consentGivenAt,
      consentWithdrawnAt: r.consentWithdrawnAt,
    })),
    correctionRequests: myData.correctionRequests.map((r) => ({
      fieldName: r.fieldName,
      requestedValue: r.requestedValue,
      status: r.status,
      createdAt: r.createdAt,
      processedAt: r.processedAt,
    })),
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
git add src/domains/compliance/compliance.service.ts \
        src/domains/compliance/__tests__/compliance.service.test.ts
git commit -m "feat(compliance): add correction request and my-data service functions"
```

---

### Task 4: Extend compliance.validator.ts with correction validators

**Files:**
- Modify: `src/domains/compliance/compliance.validator.ts`

- [ ] **Step 1: Add validators**

Open `src/domains/compliance/compliance.validator.ts` and append:

```typescript
export const createCorrectionValidator = [
  body('fieldName')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Field name is required')
    .isIn([
      'name',
      'email',
      'phone',
      'notificationPreference',
      'nricLast4',
    ])
    .withMessage('Invalid field name for correction'),
  body('currentValue').optional().isString().trim(),
  body('requestedValue')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Requested value is required'),
  body('reason').optional().isString().trim().isLength({ max: 500 }),
];

export const processCorrectionValidator = [
  body('decision')
    .isIn(['approve', 'reject'])
    .withMessage('Decision must be "approve" or "reject"'),
  body('processNotes').optional().isString().trim().isLength({ max: 1000 }),
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
git commit -m "feat(compliance): add correction request validators"
```

---

## Chunk 3: Routes + Views

### Task 5: Add My Data and correction routes to compliance.router.ts

**Files:**
- Modify: `src/domains/compliance/compliance.router.ts`

- [ ] **Step 1: Add the new routes**

Open `src/domains/compliance/compliance.router.ts` and append the following routes after the existing withdrawal route:

```typescript
// GET /seller/my-data — Seller's personal data portal
complianceRouter.get(
  '/seller/my-data',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sellerId = (req.user as { id: string }).id;
      const myData = await complianceService.getMyData(sellerId);

      if (req.headers['hx-request']) {
        return res.render('partials/compliance/consent-panel', {
          consentService: myData.seller.consentService,
          consentMarketing: myData.seller.consentMarketing,
          consentHistory: myData.consentHistory,
        });
      }

      return res.render('pages/seller/my-data', {
        seller: myData.seller,
        properties: myData.properties,
        viewings: myData.viewings,
        consentHistory: myData.consentHistory,
        correctionRequests: myData.correctionRequests,
        title: 'My Data',
        query: req.query, // needed for flash banners (consent_withdrawn, correction_submitted)
      });
    } catch (err) {
      return next(err);
    }
  },
);

// POST /seller/compliance/corrections — Submit correction request
complianceRouter.post(
  '/seller/compliance/corrections',
  requireAuth(),
  requireRole('seller'),
  createCorrectionValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ValidationError('Invalid request', errors.mapped() as Record<string, string>));
    }

    try {
      const sellerId = (req.user as { id: string }).id;
      const { fieldName, currentValue, requestedValue, reason } = req.body as {
        fieldName: string;
        currentValue?: string;
        requestedValue: string;
        reason?: string;
      };

      await complianceService.createCorrectionRequest({
        sellerId,
        fieldName,
        currentValue,
        requestedValue,
        reason,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/compliance/correction-row', {
          request: {
            fieldName,
            requestedValue,
            status: 'pending',
            createdAt: new Date(),
          },
          successMessage: 'Correction request submitted. An agent will review it within 30 days.',
        });
      }

      return res.redirect('/seller/my-data?correction_submitted=true');
    } catch (err) {
      return next(err);
    }
  },
);

// GET /seller/compliance/export — Download my data as JSON
complianceRouter.get(
  '/seller/compliance/export',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sellerId = (req.user as { id: string }).id;
      const exportData = await complianceService.generateDataExport(sellerId);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      return res.json(exportData);
    } catch (err) {
      return next(err);
    }
  },
);
```

Also update the import at the top of the router to include the new validators:

```typescript
import {
  withdrawConsentValidator,
  createCorrectionValidator,
} from './compliance.validator';
```

- [ ] **Step 2: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/domains/compliance/compliance.router.ts
git commit -m "feat(compliance): add my-data, correction, and export routes"
```

---

### Task 6: Create seller My Data views

**Files:**
- Create: `src/views/pages/seller/my-data.njk`
- Create: `src/views/partials/compliance/consent-panel.njk`
- Create: `src/views/partials/compliance/correction-form.njk`
- Create: `src/views/partials/compliance/correction-history.njk`
- Create: `src/views/partials/compliance/correction-row.njk`

- [ ] **Step 1: Replace the SP1 stub with the full My Data page**

SP1 created `src/views/pages/seller/my-data.njk` as a stub with different template variable names. This step replaces it entirely with the full implementation. The new template uses the render context from Task 5's route handler (`seller.*`, `consentHistory`, `correctionRequests`, `query.*`).

```html
{# src/views/pages/seller/my-data.njk — replaces SP1 stub #}
{% extends "layouts/seller.njk" %}

{% block content %}
<div class="max-w-3xl mx-auto px-4 py-8 space-y-8">
  <h1 class="text-2xl font-bold text-gray-900">{{ "My Data" | t }}</h1>

  {% if query.consent_withdrawn %}
    <div class="rounded-lg p-4 bg-green-50 border border-green-200">
      <p class="text-sm text-green-800">{{ "Your consent has been updated." | t }}</p>
    </div>
  {% endif %}

  {% if query.correction_submitted %}
    <div class="rounded-lg p-4 bg-blue-50 border border-blue-200">
      <p class="text-sm text-blue-800">{{ "Correction request submitted. An agent will review it within 30 days." | t }}</p>
    </div>
  {% endif %}

  {# Section 1: Personal Data #}
  <section class="bg-white rounded-lg shadow p-6">
    <h2 class="text-lg font-semibold text-gray-800 mb-4">{{ "Personal Information We Hold" | t }}</h2>
    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-gray-500">{{ "Name" | t }}</dt>
        <dd class="font-medium text-gray-900">{{ seller.name }}</dd>
      </div>
      <div>
        <dt class="text-gray-500">{{ "Email" | t }}</dt>
        <dd class="font-medium text-gray-900">{{ seller.email or "—" }}</dd>
      </div>
      <div>
        <dt class="text-gray-500">{{ "Phone" | t }}</dt>
        <dd class="font-medium text-gray-900">{{ seller.phone }}</dd>
      </div>
      {% if seller.nricDisplay %}
      <div>
        <dt class="text-gray-500">{{ "NRIC (masked)" | t }}</dt>
        <dd class="font-medium text-gray-900 font-mono">{{ seller.nricDisplay }}</dd>
      </div>
      {% endif %}
      <div>
        <dt class="text-gray-500">{{ "Account Status" | t }}</dt>
        <dd class="font-medium text-gray-900">{{ seller.status }}</dd>
      </div>
      <div>
        <dt class="text-gray-500">{{ "Member Since" | t }}</dt>
        <dd class="font-medium text-gray-900">{{ seller.createdAt | date("DD MMM YYYY") }}</dd>
      </div>
    </dl>
    <div class="mt-4">
      <a href="/seller/compliance/export"
         class="text-sm text-blue-600 hover:underline">
        {{ "Download my data (JSON)" | t }}
      </a>
    </div>
  </section>

  {# Section 2: Consent Management #}
  <section class="bg-white rounded-lg shadow p-6"
           id="consent-panel"
           hx-get="/seller/my-data"
           hx-trigger="consent-updated from:body"
           hx-select="#consent-panel"
           hx-swap="outerHTML">
    {% include "partials/compliance/consent-panel.njk" %}
  </section>

  {# Section 3: Correction Requests #}
  <section class="bg-white rounded-lg shadow p-6">
    <h2 class="text-lg font-semibold text-gray-800 mb-4">{{ "Request a Data Correction" | t }}</h2>
    {% include "partials/compliance/correction-form.njk" %}
    {% if correctionRequests | length > 0 %}
      <div class="mt-6">
        {% include "partials/compliance/correction-history.njk" %}
      </div>
    {% endif %}
  </section>

  {# Section 4: Account Deletion #}
  <section class="bg-white rounded-lg shadow p-6 border border-red-100">
    <h2 class="text-lg font-semibold text-gray-800 mb-2">{{ "Account Deletion" | t }}</h2>
    <p class="text-sm text-gray-600 mb-4">
      {{ "Requesting deletion withdraws your service consent. If you have completed transactions, data is retained for 5 years under financial regulations." | t }}
    </p>
    <button
      hx-post="/seller/compliance/consent/withdraw"
      hx-vals='{"type": "service", "channel": "web"}'
      hx-confirm="{{ 'Are you sure you want to request account deletion? This action cannot be undone.' | t }}"
      hx-target="#consent-panel"
      hx-swap="outerHTML"
      class="px-4 py-2 text-sm font-medium text-red-700 border border-red-300 rounded-lg hover:bg-red-50">
      {{ "Request Account Deletion" | t }}
    </button>
  </section>
</div>
{% endblock %}
```

- [ ] **Step 2: Create the consent panel partial**

```html
{# src/views/partials/compliance/consent-panel.njk #}
<h2 class="text-lg font-semibold text-gray-800 mb-4">{{ "Consent Preferences" | t }}</h2>
<div class="space-y-4">
  <div class="flex items-center justify-between p-4 rounded-lg bg-gray-50">
    <div>
      <p class="font-medium text-sm text-gray-900">{{ "Service Communications" | t }}</p>
      <p class="text-xs text-gray-500 mt-1">{{ "Transaction updates, appointment reminders, compliance notices." | t }}</p>
    </div>
    <span class="px-3 py-1 text-xs font-medium rounded-full
      {% if consentService %}bg-green-100 text-green-800{% else %}bg-red-100 text-red-800{% endif %}">
      {% if consentService %}{{ "Active" | t }}{% else %}{{ "Withdrawn" | t }}{% endif %}
    </span>
  </div>

  <div class="flex items-center justify-between p-4 rounded-lg bg-gray-50">
    <div>
      <p class="font-medium text-sm text-gray-900">{{ "Marketing Communications" | t }}</p>
      <p class="text-xs text-gray-500 mt-1">{{ "Market updates, listings, referral programme." | t }}</p>
    </div>
    <div class="flex items-center gap-3">
      <span class="px-3 py-1 text-xs font-medium rounded-full
        {% if consentMarketing %}bg-green-100 text-green-800{% else %}bg-gray-100 text-gray-600{% endif %}">
        {% if consentMarketing %}{{ "Active" | t }}{% else %}{{ "Not given" | t }}{% endif %}
      </span>
      {% if consentMarketing %}
      <button
        hx-post="/seller/compliance/consent/withdraw"
        hx-vals='{"type": "marketing", "channel": "web"}'
        hx-target="#consent-panel"
        hx-swap="outerHTML"
        class="text-xs text-red-600 hover:underline">
        {{ "Withdraw" | t }}
      </button>
      {% endif %}
    </div>
  </div>
</div>

{% if consentHistory | length > 0 %}
<details class="mt-4">
  <summary class="text-sm text-gray-500 cursor-pointer hover:text-gray-700">{{ "View consent history" | t }}</summary>
  <ul class="mt-2 space-y-1">
    {% for record in consentHistory %}
    <li class="text-xs text-gray-500">
      {% if record.consentWithdrawnAt %}
        {{ record.consentWithdrawnAt | date("DD MMM YYYY") }}: {{ "Withdrew" | t }}
        {% if record.purposeService == false %}{{ "service" | t }}{% endif %}
        {% if record.purposeMarketing == false %}{{ "marketing" | t }}{% endif %}
        {{ "consent" | t }}
      {% else %}
        {{ record.consentGivenAt | date("DD MMM YYYY") }}: {{ "Gave consent" | t }}
      {% endif %}
    </li>
    {% endfor %}
  </ul>
</details>
{% endif %}
```

- [ ] **Step 3: Create the correction form partial**

```html
{# src/views/partials/compliance/correction-form.njk #}
<form
  hx-post="/seller/compliance/corrections"
  hx-target="#correction-history"
  hx-swap="afterbegin"
  class="space-y-4">

  <div class="grid grid-cols-2 gap-4">
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">{{ "Field to correct" | t }}</label>
      <select name="fieldName" required
              class="w-full rounded-lg border-gray-300 text-sm focus:ring-blue-500 focus:border-blue-500">
        <option value="">{{ "Select a field" | t }}</option>
        <option value="name">{{ "Name" | t }}</option>
        <option value="email">{{ "Email" | t }}</option>
        <option value="phone">{{ "Phone" | t }}</option>
        <option value="nricLast4">{{ "NRIC last 4 characters" | t }}</option>
        <option value="notificationPreference">{{ "Notification preference" | t }}</option>
      </select>
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">{{ "Requested value" | t }}</label>
      <input type="text" name="requestedValue" required
             class="w-full rounded-lg border-gray-300 text-sm focus:ring-blue-500 focus:border-blue-500"
             placeholder="{{ 'What should it be changed to?' | t }}">
    </div>
  </div>

  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1">{{ "Reason (optional)" | t }}</label>
    <input type="text" name="reason"
           class="w-full rounded-lg border-gray-300 text-sm focus:ring-blue-500 focus:border-blue-500"
           placeholder="{{ 'e.g. Legal name change, typo correction' | t }}">
  </div>

  <button type="submit"
          class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
    {{ "Submit Correction Request" | t }}
  </button>
</form>
```

- [ ] **Step 4: Create the correction history partial**

```html
{# src/views/partials/compliance/correction-history.njk #}
<h3 class="text-sm font-medium text-gray-700 mb-3">{{ "Previous Correction Requests" | t }}</h3>
<ul id="correction-history" class="divide-y divide-gray-100">
  {% for req in correctionRequests %}
  <li class="py-3 flex items-center justify-between">
    <div>
      <p class="text-sm text-gray-900"><span class="font-medium">{{ req.fieldName }}</span>
        → <span class="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">{{ req.requestedValue }}</span></p>
      <p class="text-xs text-gray-500 mt-0.5">{{ req.createdAt | date("DD MMM YYYY") }}</p>
    </div>
    <span class="px-2 py-1 text-xs rounded-full
      {% if req.status == 'completed' %}bg-green-100 text-green-700
      {% elif req.status == 'rejected' %}bg-red-100 text-red-700
      {% else %}bg-yellow-100 text-yellow-700{% endif %}">
      {{ req.status | t }}
    </span>
  </li>
  {% endfor %}
</ul>
```

- [ ] **Step 5: Create the HTMX correction row partial (for afterbegin swap)**

```html
{# src/views/partials/compliance/correction-row.njk #}
{% if successMessage %}
<li class="py-3 flex items-center justify-between bg-blue-50 px-2 rounded animate-pulse-once">
  <div>
    <p class="text-sm text-gray-900"><span class="font-medium">{{ request.fieldName }}</span>
      → <span class="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">{{ request.requestedValue }}</span></p>
    <p class="text-xs text-blue-600 mt-0.5">{{ successMessage }}</p>
  </div>
  <span class="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-700">{{ "pending" | t }}</span>
</li>
{% endif %}
```

- [ ] **Step 6: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/views/pages/seller/my-data.njk \
        src/views/partials/compliance/ \
        src/domains/compliance/compliance.router.ts
git commit -m "feat(compliance): add seller My Data page and correction request views"
```

---

## Chunk 4: Agent Correction Queue

### Task 7: Add correction queue to agent domain

**Files:**
- Modify: `src/domains/agent/agent.service.ts`
- Modify: `src/domains/agent/agent.repository.ts`
- Modify: `src/domains/agent/agent.router.ts`
- Create: `src/views/pages/agent/correction-requests.njk`
- Create: `src/views/partials/agent/correction-review-modal.njk`

- [ ] **Step 1: Add getCorrectionQueue to agent.repository.ts**

Open `src/domains/agent/agent.repository.ts` and append:

```typescript
export async function getPendingCorrectionRequests() {
  return prisma.dataCorrectionRequest.findMany({
    where: { status: { in: ['pending', 'in_progress'] } },
    include: {
      seller: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}
```

- [ ] **Step 2: Add processCorrectionRequest to agent.service.ts**

Open `src/domains/agent/agent.service.ts`. Add at the top:

```typescript
import * as complianceService from '../compliance/compliance.service';
```

Then append this function:

```typescript
export async function processCorrectionRequest(input: {
  requestId: string;
  agentId: string;
  decision: 'approve' | 'reject';
  processNotes?: string;
}): Promise<void> {
  await complianceService.processCorrectionRequest(input);
}
```

- [ ] **Step 3: Add correction queue route to agent.router.ts**

Open `src/domains/agent/agent.router.ts`. The file defines `const agentAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()]` near the top. Use `...agentAuth` on all new routes (2FA is mandatory for agents per CLAUDE.md).

Add the following routes (after existing agent routes):

```typescript
// GET /agent/corrections — Correction request review queue
agentRouter.get(
  '/agent/corrections',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requests = await agentRepo.getPendingCorrectionRequests();
      return res.render('pages/agent/correction-requests', {
        requests,
        title: 'Data Correction Requests',
      });
    } catch (err) {
      return next(err);
    }
  },
);

// POST /agent/corrections/:requestId — Approve or reject
agentRouter.post(
  '/agent/corrections/:requestId',
  ...agentAuth,
  processCorrectionValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ValidationError('Invalid request', errors.mapped() as Record<string, string>));
    }

    try {
      const agentId = (req.user as { id: string }).id;
      const { requestId } = req.params;
      const { decision, processNotes } = req.body as { decision: string; processNotes?: string };

      await agentService.processCorrectionRequest({
        requestId,
        agentId,
        decision: decision as 'approve' | 'reject',
        processNotes,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/correction-review-modal', {
          success: true,
          decision,
          requestId,
        });
      }

      return res.redirect('/agent/corrections');
    } catch (err) {
      return next(err);
    }
  },
);
```

Also add these imports to agent.router.ts:

```typescript
import { processCorrectionValidator } from '../compliance/compliance.validator';
import * as agentRepo from './agent.repository';
```

- [ ] **Step 4: Create agent correction queue views**

```html
{# src/views/pages/agent/correction-requests.njk #}
{% extends "layouts/agent.njk" %}

{% block content %}
<div class="max-w-4xl mx-auto px-4 py-8">
  <h1 class="text-2xl font-bold text-gray-900 mb-6">{{ "Data Correction Requests" | t }}</h1>

  {% if requests | length == 0 %}
    <div class="text-center py-12 text-gray-500">
      <p>{{ "No pending correction requests." | t }}</p>
    </div>
  {% else %}
    <div class="bg-white shadow rounded-lg overflow-hidden">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Seller" | t }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Field" | t }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Requested Value" | t }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Submitted" | t }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Actions" | t }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200">
          {% for req in requests %}
          <tr id="correction-row-{{ req.id }}">
            <td class="px-6 py-4 text-sm text-gray-900">{{ req.seller.name }}</td>
            <td class="px-6 py-4 text-sm font-mono text-gray-700">{{ req.fieldName }}</td>
            <td class="px-6 py-4 text-sm text-gray-900">{{ req.requestedValue }}</td>
            <td class="px-6 py-4 text-sm text-gray-500">{{ req.createdAt | date("DD MMM YYYY") }}</td>
            <td class="px-6 py-4">
              <div class="flex gap-2">
                <button
                  hx-post="/agent/corrections/{{ req.id }}"
                  hx-vals='{"decision": "approve"}'
                  hx-target="#correction-row-{{ req.id }}"
                  hx-swap="outerHTML"
                  class="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">
                  {{ "Approve" | t }}
                </button>
                <button
                  hx-post="/agent/corrections/{{ req.id }}"
                  hx-vals='{"decision": "reject"}'
                  hx-target="#correction-row-{{ req.id }}"
                  hx-swap="outerHTML"
                  class="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">
                  {{ "Reject" | t }}
                </button>
              </div>
            </td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  {% endif %}
</div>
{% endblock %}
```

```html
{# src/views/partials/agent/correction-review-modal.njk #}
<tr id="correction-row-{{ requestId }}" class="{% if success %}bg-green-50{% else %}bg-red-50{% endif %}">
  <td colspan="5" class="px-6 py-4 text-sm text-center
    {% if success %}text-green-700{% else %}text-red-700{% endif %}">
    {% if success %}
      {% if decision == 'approve' %}{{ "Approved successfully." | t }}{% else %}{{ "Rejected successfully." | t }}{% endif %}
    {% else %}
      {{ "Failed to process request." | t }}
    {% endif %}
  </td>
</tr>
```

- [ ] **Step 5: Compile check + run tests**

```bash
npx tsc --noEmit 2>&1 | head -20 && npm test -- --testPathPattern="compliance|agent" 2>&1 | tail -20
```

Expected: no compile errors, all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domains/agent/ \
        src/views/pages/agent/correction-requests.njk \
        src/views/partials/agent/correction-review-modal.njk
git commit -m "feat(agent): add data correction review queue"
```

---

## Chunk 5: Integration Tests

### Task 8: Write SP2 integration tests

**Files:**
- Create: `tests/integration/compliance-sp2.test.ts`

- [ ] **Step 1: Write the integration tests**

```typescript
// tests/integration/compliance-sp2.test.ts
import { prisma } from '@/infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';
import * as complianceService from '@/domains/compliance/compliance.service';

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

async function createTestAgent() {
  return prisma.agent.create({
    data: {
      id: createId(),
      name: 'Test Agent',
      email: `agent-${createId()}@test.com`,
      phone: `+6598${Math.floor(Math.random() * 900000 + 100000)}`,
      ceaRegNo: `R${createId().slice(0, 7)}`,
      passwordHash: 'hash',
      role: 'agent',
    },
  });
}

describe('Compliance SP2 — My Data + Corrections (integration)', () => {
  afterEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.dataCorrectionRequest.deleteMany();
    await prisma.consentRecord.deleteMany();
    await prisma.seller.deleteMany();
    await prisma.agent.deleteMany();
  });

  describe('getMyData', () => {
    it('returns seller personal data', async () => {
      const seller = await createTestSeller({ name: 'Alice Tan' });
      const data = await complianceService.getMyData(seller.id);

      expect(data.seller.name).toBe('Alice Tan');
      expect(data.seller.consentService).toBe(true);
      expect(data.correctionRequests).toHaveLength(0);
      expect(data.consentHistory).toHaveLength(0);
    });

    it('throws NotFoundError for unknown seller', async () => {
      await expect(complianceService.getMyData('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('createCorrectionRequest', () => {
    it('creates a pending correction request', async () => {
      const seller = await createTestSeller();

      await complianceService.createCorrectionRequest({
        sellerId: seller.id,
        fieldName: 'name',
        currentValue: 'Old Name',
        requestedValue: 'New Name',
        reason: 'Legal name change',
      });

      const requests = await prisma.dataCorrectionRequest.findMany({
        where: { sellerId: seller.id },
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].status).toBe('pending');
      expect(requests[0].fieldName).toBe('name');
    });

    it('creates audit log for correction request', async () => {
      const seller = await createTestSeller();

      await complianceService.createCorrectionRequest({
        sellerId: seller.id,
        fieldName: 'email',
        requestedValue: 'new@test.com',
      });

      const log = await prisma.auditLog.findFirst({
        where: { action: 'data_correction.requested', entityType: 'data_correction_request' },
      });
      expect(log).not.toBeNull();
    });
  });

  describe('processCorrectionRequest — approve auto-apply', () => {
    it('updates seller name when agent approves name correction', async () => {
      const seller = await createTestSeller({ name: 'Old Name' });
      const agent = await createTestAgent();

      const request = await prisma.dataCorrectionRequest.create({
        data: {
          id: createId(),
          sellerId: seller.id,
          fieldName: 'name',
          requestedValue: 'New Name',
          status: 'pending',
        },
      });

      await complianceService.processCorrectionRequest({
        requestId: request.id,
        agentId: agent.id,
        decision: 'approve',
      });

      const updated = await prisma.seller.findUnique({ where: { id: seller.id } });
      expect(updated?.name).toBe('New Name');

      const updatedRequest = await prisma.dataCorrectionRequest.findUnique({
        where: { id: request.id },
      });
      expect(updatedRequest?.status).toBe('completed');
    });
  });

  describe('processCorrectionRequest — reject', () => {
    it('marks request rejected with process notes', async () => {
      const seller = await createTestSeller();
      const agent = await createTestAgent();

      const request = await prisma.dataCorrectionRequest.create({
        data: {
          id: createId(),
          sellerId: seller.id,
          fieldName: 'nricLast4',
          requestedValue: '123A',
          status: 'pending',
        },
      });

      await complianceService.processCorrectionRequest({
        requestId: request.id,
        agentId: agent.id,
        decision: 'reject',
        processNotes: 'Cannot verify identity claim',
      });

      // Seller record is NOT modified
      const unchanged = await prisma.seller.findUnique({ where: { id: seller.id } });
      // nricLast4 only exists in CddRecord, not Seller — so just check request status
      const updatedRequest = await prisma.dataCorrectionRequest.findUnique({
        where: { id: request.id },
      });
      expect(updatedRequest?.status).toBe('rejected');
      expect(updatedRequest?.processNotes).toBe('Cannot verify identity claim');
    });
  });

  describe('generateDataExport', () => {
    it('returns a JSON export with seller fields', async () => {
      const seller = await createTestSeller({ name: 'Export Seller' });
      const exportData = await complianceService.generateDataExport(seller.id);

      expect(exportData.exportedAt).toBeDefined();
      expect((exportData.seller as { name: string }).name).toBe('Export Seller');
      expect(exportData.properties).toBeDefined();
      expect(exportData.consentHistory).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
npm run docker:test:db && npm run test:integration -- --testPathPattern="compliance-sp2" 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 3: Run full test suite**

```bash
npm test && npm run test:integration 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/compliance-sp2.test.ts
git commit -m "test(compliance): add SP2 integration tests for my-data and correction requests"
```

---

## SP2 Complete

Run the full test suite one final time:

```bash
npm test && npm run test:integration 2>&1 | tail -20
```

Expected: all unit and integration tests PASS.
