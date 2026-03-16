# CDD Status Dropdown Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CDD modal creation form with an inline status dropdown (`not_started` / `pending` / `verified`) that maps directly to the database, reflecting CDD status tracked in Huttons' external system.

**Architecture:** A new `PATCH /agent/sellers/:sellerId/cdd/status` endpoint upserts or deletes a stub `CddRecord` based on the selected status. The existing `POST` creation endpoint and modal GET endpoint are removed. Only seller CDD changes — counterparty CDD (Gate 3) is untouched.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, express-validator

---

## Files Modified / Created

| File | Change |
|---|---|
| `src/domains/compliance/compliance.types.ts` | Add `UpdateCddStatusInput` type |
| `src/domains/compliance/compliance.validator.ts` | Add `updateCddStatusValidator`; keep `createCddValidator` (counterparty CDD still uses it) |
| `src/domains/compliance/compliance.repository.ts` | Add `upsertCddStatus`, `deleteCddRecord` |
| `src/domains/compliance/compliance.service.ts` | Add `updateCddStatus` |
| `src/domains/compliance/compliance.router.ts` | Add `PATCH /agent/sellers/:sellerId/cdd/status`; remove `POST /agent/sellers/:sellerId/cdd` and `GET /agent/sellers/:sellerId/cdd/modal` |
| `src/views/partials/agent/compliance-cdd-card.njk` | Rewrite with dropdown |
| `src/views/partials/agent/cdd-modal.njk` | **Delete** |
| `src/domains/compliance/__tests__/compliance.router.test.ts` | Replace POST/modal tests with PATCH tests |
| `src/domains/compliance/__tests__/compliance.repository.test.ts` | Add tests for `upsertCddStatus`, `deleteCddRecord` |

**Do NOT touch:**
- `POST /agent/transactions/:txId/counterparty-cdd` — counterparty CDD is unchanged
- `GET /agent/transactions/:txId/counterparty-cdd/modal` — counterparty CDD modal unchanged
- `#compliance-modal-container` div in `seller-detail.njk` — EAA card still uses it
- `createCddValidator` — still used by counterparty CDD endpoint

---

## Chunk 1: Repository + Types + Validator

### Task 1: Add types and validator

**Files:**
- Modify: `src/domains/compliance/compliance.types.ts`
- Modify: `src/domains/compliance/compliance.validator.ts`

- [ ] **Step 1: Add `UpdateCddStatusInput` to compliance.types.ts**

Open `src/domains/compliance/compliance.types.ts`. After the `CreateCddRecordInput` interface (around line 100), add:

```typescript
export interface UpdateCddStatusInput {
  sellerId: string;
  agentId: string;
  status: 'not_started' | 'pending' | 'verified';
}
```

- [ ] **Step 2: Add `updateCddStatusValidator` to compliance.validator.ts**

Open `src/domains/compliance/compliance.validator.ts`. After the `createCddValidator` export, add:

```typescript
export const updateCddStatusValidator = [
  body('status')
    .isIn(['not_started', 'pending', 'verified'])
    .withMessage('Status must be "not_started", "pending", or "verified"'),
];
```

- [ ] **Step 3: Commit**

```bash
git add src/domains/compliance/compliance.types.ts src/domains/compliance/compliance.validator.ts
git commit -m "feat: add UpdateCddStatusInput type and updateCddStatusValidator"
```

---

### Task 2: Write failing repository tests

**Files:**
- Modify: `src/domains/compliance/__tests__/compliance.repository.test.ts`

- [ ] **Step 1: Extend the Prisma mock to include new methods**

Open `src/domains/compliance/__tests__/compliance.repository.test.ts`. Find the `mockPrisma` definition near the top (where `cddRecord` is defined) and add `findFirst`, `update`, and `delete` to it:

```typescript
cddRecord: {
  create: jest.fn(),
  updateMany: jest.fn(),
  findFirst: jest.fn(),  // add
  update: jest.fn(),     // add
  delete: jest.fn(),     // add
},
```

- [ ] **Step 2: Write failing tests for `upsertCddStatus` and `deleteCddRecord`**

In the same file, add a new describe block after the existing `createCddRecord` describe block:

```typescript
// ─── upsertCddStatus ───────────────────────────────────────────────────────────

describe('upsertCddStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a new stub record when none exists (pending)', async () => {
    mockPrisma.cddRecord.findFirst.mockResolvedValue(null);
    mockPrisma.cddRecord.create.mockResolvedValue({ id: 'cdd-1', identityVerified: false } as never);

    await complianceRepo.upsertCddStatus('seller-1', 'agent-1', 'pending');

    expect(mockPrisma.cddRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subjectType: 'seller',
          subjectId: 'seller-1',
          identityVerified: false,
          verifiedByAgentId: 'agent-1',
        }),
      }),
    );
  });

  it('creates a new stub record when none exists (verified)', async () => {
    mockPrisma.cddRecord.findFirst.mockResolvedValue(null);
    mockPrisma.cddRecord.create.mockResolvedValue({ id: 'cdd-1', identityVerified: true } as never);

    await complianceRepo.upsertCddStatus('seller-1', 'agent-1', 'verified');

    expect(mockPrisma.cddRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identityVerified: true,
          verifiedByAgentId: 'agent-1',
        }),
      }),
    );
    // verifiedAt should be set (a Date)
    const call = mockPrisma.cddRecord.create.mock.calls[0][0];
    expect(call.data.verifiedAt).toBeInstanceOf(Date);
  });

  it('updates existing record in-place', async () => {
    mockPrisma.cddRecord.findFirst.mockResolvedValue({ id: 'existing-cdd' } as never);
    mockPrisma.cddRecord.update.mockResolvedValue({} as never);

    await complianceRepo.upsertCddStatus('seller-1', 'agent-1', 'verified');

    expect(mockPrisma.cddRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-cdd' },
        data: expect.objectContaining({ identityVerified: true }),
      }),
    );
    expect(mockPrisma.cddRecord.create).not.toHaveBeenCalled();
  });
});

// ─── deleteCddRecord ───────────────────────────────────────────────────────────

describe('deleteCddRecord', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes the seller CDD record if one exists', async () => {
    mockPrisma.cddRecord.findFirst.mockResolvedValue({ id: 'cdd-1' } as never);
    mockPrisma.cddRecord.delete.mockResolvedValue({} as never);

    await complianceRepo.deleteCddRecord('seller-1');

    expect(mockPrisma.cddRecord.delete).toHaveBeenCalledWith({ where: { id: 'cdd-1' } });
  });

  it('is a no-op when no record exists', async () => {
    mockPrisma.cddRecord.findFirst.mockResolvedValue(null);

    await complianceRepo.deleteCddRecord('seller-1');

    expect(mockPrisma.cddRecord.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=compliance.repository --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `upsertCddStatus is not a function` (or similar)

---

### Task 3: Implement `upsertCddStatus` and `deleteCddRecord` in repository

**Files:**
- Modify: `src/domains/compliance/compliance.repository.ts`

- [ ] **Step 1: Add `upsertCddStatus` and `deleteCddRecord` after `createCddRecord`**

Open `src/domains/compliance/compliance.repository.ts`. After the `createCddRecord` function (around line 110), add:

```typescript
export async function upsertCddStatus(
  sellerId: string,
  agentId: string,
  status: 'pending' | 'verified',
): Promise<void> {
  const identityVerified = status === 'verified';
  const verifiedAt = status === 'verified' ? new Date() : null;

  const existing = await prisma.cddRecord.findFirst({
    where: { subjectType: SubjectType.seller, subjectId: sellerId },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    await prisma.cddRecord.update({
      where: { id: existing.id },
      data: { identityVerified, verifiedAt, verifiedByAgentId: agentId },
    });
  } else {
    const retentionExpiresAt = new Date();
    retentionExpiresAt.setFullYear(retentionExpiresAt.getFullYear() + 5);
    await prisma.cddRecord.create({
      data: {
        id: createId(),
        subjectType: SubjectType.seller,
        subjectId: sellerId,
        fullName: '–',
        nricLast4: '0000',
        verifiedByAgentId: agentId,
        identityVerified,
        verifiedAt,
        retentionExpiresAt,
      },
    });
  }
}

export async function deleteCddRecord(sellerId: string): Promise<void> {
  const existing = await prisma.cddRecord.findFirst({
    where: { subjectType: SubjectType.seller, subjectId: sellerId },
    orderBy: { createdAt: 'desc' },
  });
  if (!existing) return;
  await prisma.cddRecord.delete({ where: { id: existing.id } });
}
```

- [ ] **Step 2: Run repository tests**

```bash
npm test -- --testPathPattern=compliance.repository --no-coverage 2>&1 | tail -20
```

Expected: All compliance.repository tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/domains/compliance/compliance.repository.ts src/domains/compliance/__tests__/compliance.repository.test.ts
git commit -m "feat: add upsertCddStatus and deleteCddRecord to compliance repository"
```

---

## Chunk 2: Service + Router

### Task 4: Write failing service test and implement `updateCddStatus`

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts`
- Modify: `src/domains/compliance/__tests__/compliance.service.test.ts` (if it exists; otherwise add to repository test)

- [ ] **Step 1: Write failing test for `updateCddStatus` in compliance.service.test.ts**

Open `src/domains/compliance/__tests__/compliance.service.test.ts`. Add a new describe block (mock `complianceRepo.upsertCddStatus`, `complianceRepo.deleteCddRecord`, and `auditService.log`):

```typescript
describe('updateCddStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls deleteCddRecord and logs cdd.record_deleted for not_started', async () => {
    mockRepo.deleteCddRecord.mockResolvedValue(undefined);

    await complianceService.updateCddStatus('seller-1', 'not_started', 'agent-1');

    expect(mockRepo.deleteCddRecord).toHaveBeenCalledWith('seller-1');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.record_deleted', entityId: 'seller-1' }),
    );
  });

  it('calls upsertCddStatus and logs cdd.status_set_pending for pending', async () => {
    mockRepo.upsertCddStatus.mockResolvedValue(undefined);

    await complianceService.updateCddStatus('seller-1', 'pending', 'agent-1');

    expect(mockRepo.upsertCddStatus).toHaveBeenCalledWith('seller-1', 'agent-1', 'pending');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.status_set_pending', entityId: 'seller-1' }),
    );
  });

  it('calls upsertCddStatus and logs cdd.identity_verified for verified', async () => {
    mockRepo.upsertCddStatus.mockResolvedValue(undefined);

    await complianceService.updateCddStatus('seller-1', 'verified', 'agent-1');

    expect(mockRepo.upsertCddStatus).toHaveBeenCalledWith('seller-1', 'agent-1', 'verified');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.identity_verified', entityId: 'seller-1' }),
    );
  });
});
```

Also ensure `mockRepo` has `deleteCddRecord` and `upsertCddStatus` in the mock definition at the top of the file. Add them if missing:

```typescript
deleteCddRecord: jest.fn(),
upsertCddStatus: jest.fn(),
```

- [ ] **Step 2: Run to verify the tests fail**

```bash
npm test -- --testPathPattern=compliance.service --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `updateCddStatus is not a function`

- [ ] **Step 4: Add `updateCddStatus` to compliance.service.ts**

Open `src/domains/compliance/compliance.service.ts`. After the `createCddRecord` function (around line 680), add:

```typescript
export async function updateCddStatus(
  sellerId: string,
  status: 'not_started' | 'pending' | 'verified',
  agentId: string,
): Promise<void> {
  if (status === 'not_started') {
    await complianceRepo.deleteCddRecord(sellerId);
    await auditService.log({
      agentId,
      action: 'cdd.record_deleted',
      entityType: 'seller',
      entityId: sellerId,
      details: { sellerId },
    });
    return;
  }

  await complianceRepo.upsertCddStatus(sellerId, agentId, status);

  if (status === 'verified') {
    await auditService.log({
      agentId,
      action: 'cdd.identity_verified',
      entityType: 'seller',
      entityId: sellerId,
      details: { sellerId },
    });
  } else {
    await auditService.log({
      agentId,
      action: 'cdd.status_set_pending',
      entityType: 'seller',
      entityId: sellerId,
      details: { sellerId },
    });
  }
}
```

- [ ] **Step 5: Run all compliance tests to confirm tests now pass**

```bash
npm test -- --testPathPattern=compliance --no-coverage 2>&1 | tail -20
```

Expected: All passing (new function has no test yet — that's fine, router test covers behaviour)

- [ ] **Step 6: Commit**

```bash
git add src/domains/compliance/compliance.service.ts src/domains/compliance/__tests__/compliance.service.test.ts
git commit -m "feat: add updateCddStatus service function"
```

---

### Task 5: Write failing router tests for PATCH endpoint

**Files:**
- Modify: `src/domains/compliance/__tests__/compliance.router.test.ts`

- [ ] **Step 1: Replace the `POST /agent/sellers/:sellerId/cdd` describe block**

Open `src/domains/compliance/__tests__/compliance.router.test.ts`. Find the `describe('POST /agent/sellers/:sellerId/cdd', ...)` block and replace it entirely with:

```typescript
describe('PATCH /agent/sellers/:sellerId/cdd/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 for unauthenticated requests', async () => {
    const app = createTestApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'verified' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for seller role', async () => {
    const app = createSellerApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'verified' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid status value', async () => {
    const app = createAgentApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('calls updateCddStatus and re-renders cdd card on success', async () => {
    mockService.updateCddStatus.mockResolvedValue(undefined);
    mockAgentRepo.getComplianceStatus.mockResolvedValue({
      ...mockComplianceStatus,
      cdd: {
        status: 'verified' as const,
        verifiedAt: new Date(),
        riskLevel: null,
        fullName: null,
        nricLast4: null,
      },
    } as never);

    const app = createAgentApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'verified' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('compliance-cdd-card');
    expect(mockService.updateCddStatus).toHaveBeenCalledWith('seller-1', 'verified', 'agent-1');
  });

  it('calls updateCddStatus with not_started to delete the record', async () => {
    mockService.updateCddStatus.mockResolvedValue(undefined);
    mockAgentRepo.getComplianceStatus.mockResolvedValue({
      ...mockComplianceStatus,
      cdd: {
        status: 'not_started' as const,
        verifiedAt: null,
        riskLevel: null,
        fullName: null,
        nricLast4: null,
      },
    } as never);

    const app = createAgentApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'not_started' });

    expect(res.status).toBe(200);
    expect(mockService.updateCddStatus).toHaveBeenCalledWith('seller-1', 'not_started', 'agent-1');
  });
});
```

Also remove the `describe('GET /agent/sellers/:sellerId/cdd/modal', ...)` test block entirely.

Make sure `mockService` includes `updateCddStatus` in its mock definition at the top of the test file. Find where `mockService` is defined (look for `jest.mock` of the service) and add:

```typescript
updateCddStatus: jest.fn(),
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npm test -- --testPathPattern=compliance.router --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `PATCH /agent/sellers/:sellerId/cdd/status` returns 404 (route not yet defined)

---

### Task 6: Add PATCH route and remove old routes in router

**Files:**
- Modify: `src/domains/compliance/compliance.router.ts`

- [ ] **Step 1: Add `updateCddStatusValidator` to the import**

Open `src/domains/compliance/compliance.router.ts`. Find the import from `./compliance.validator` (around line 11–18) and add `updateCddStatusValidator` to it:

```typescript
import {
  withdrawConsentValidator,
  createCorrectionValidator,
  createCddValidator,
  updateCddStatusValidator,
  createEaaValidator,
  updateEaaStatusValidator,
  confirmExplanationValidator,
} from './compliance.validator';
```

Also add `updateCddStatus` to the service import if it's a named import, or confirm it's already covered by `* as complianceService`.

- [ ] **Step 2: Replace the seller CDD POST route with a PATCH route**

Find the block starting with `// POST /agent/sellers/:sellerId/cdd — Create seller CDD record (Gate 1)` and replace the entire route (from `complianceRouter.post(` through its closing `);`) with:

```typescript
// PATCH /agent/sellers/:sellerId/cdd/status — Update seller CDD status (Gate 1)
complianceRouter.patch(
  '/agent/sellers/:sellerId/cdd/status',
  ...agentAuth,
  updateCddStatusValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    if (extractValidationErrors(req, next)) return;
    try {
      const sellerId = req.params['sellerId'] as string;
      const agentId = getAgentId(req);
      const { status } = req.body as { status: 'not_started' | 'pending' | 'verified' };

      await complianceService.updateCddStatus(sellerId, status, agentId);

      const compliance = await agentRepo.getComplianceStatus(sellerId, agentId);
      return res.render('partials/agent/compliance-cdd-card', { compliance, sellerId });
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 3: Remove the seller CDD modal GET route**

Find and delete the entire block:

```typescript
// GET /agent/sellers/:sellerId/cdd/modal
complianceRouter.get(
  '/agent/sellers/:sellerId/cdd/modal',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.params['sellerId'] as string;
      return res.render('partials/agent/cdd-modal', {
        sellerId,
        endpoint: `/agent/sellers/${sellerId}/cdd`,
        target: '#compliance-cdd-card',
        title: 'Create CDD Record',
      });
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 4: Run router tests**

```bash
npm test -- --testPathPattern=compliance.router --no-coverage 2>&1 | tail -20
```

Expected: All compliance.router tests PASS

- [ ] **Step 5: Run full test suite**

```bash
npm test --no-coverage 2>&1 | tail -30
```

Expected: All tests PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add src/domains/compliance/compliance.router.ts src/domains/compliance/compliance.validator.ts src/domains/compliance/__tests__/compliance.router.test.ts
git commit -m "feat: add PATCH cdd/status endpoint and remove CDD modal endpoints"
```

---

## Chunk 3: Views

### Task 7: Rewrite compliance-cdd-card.njk

**Files:**
- Modify: `src/views/partials/agent/compliance-cdd-card.njk`

- [ ] **Step 1: Replace the entire file content**

The new card uses an HTMX-powered `<select>` that fires a PATCH on change. Remove all modal button and data display — just status + guidance note.

```nunjucks
<div id="compliance-cdd-card">
  <div class="flex items-center gap-3">
    <label class="text-sm font-medium text-gray-700" for="cdd-status-select">{{ "Status" | t }}</label>
    <div class="relative">
      <select
        id="cdd-status-select"
        name="status"
        hx-patch="/agent/sellers/{{ sellerId }}/cdd/status"
        hx-trigger="change"
        hx-target="#compliance-cdd-card"
        hx-swap="outerHTML"
        hx-include="this"
        hx-indicator="#cdd-status-indicator"
        class="border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-8">
        <option value="not_started" {% if compliance.cdd.status == 'not_started' %}selected{% endif %}>{{ "Not Started" | t }}</option>
        <option value="pending" {% if compliance.cdd.status == 'pending' %}selected{% endif %}>{{ "Pending" | t }}</option>
        <option value="verified" {% if compliance.cdd.status == 'verified' %}selected{% endif %}>{{ "Verified" | t }}</option>
      </select>
      <span id="cdd-status-indicator" class="htmx-indicator absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">↻</span>
    </div>

    {% if compliance.cdd.status == 'verified' %}
    <span class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">{{ "Verified" | t }}</span>
    {% elif compliance.cdd.status == 'pending' %}
    <span class="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">{{ "Pending" | t }}</span>
    {% endif %}
  </div>

  {% if compliance.cdd.status == 'pending' %}
  <p class="text-xs text-yellow-700 mt-2">
    {{ "CDD must be marked Verified in Huttons' system before you can proceed to the Estate Agency Agreement." | t }}
  </p>
  {% endif %}

  {% if compliance.cdd.status == 'verified' and compliance.cdd.verifiedAt %}
  <p class="text-xs text-gray-500 mt-2">{{ "Verified" | t }}: {{ compliance.cdd.verifiedAt | date('DD/MM/YYYY') }}</p>
  {% endif %}
</div>
```

- [ ] **Step 2: Delete cdd-modal.njk**

```bash
rm src/views/partials/agent/cdd-modal.njk
```

> Note: Do NOT remove `#compliance-modal-container` from `seller-detail.njk` — the EAA card and counterparty CDD card still use it.

- [ ] **Step 3: Start dev server and visually verify the CDD card**

```bash
npm run dev
```

Navigate to `/agent/sellers/<any-seller-id>` and confirm:
- CDD Status section shows a dropdown with three options
- Changing the dropdown fires an HTMX PATCH and the card re-renders
- Selecting `verified` shows the verified date and green badge
- Selecting `pending` shows the yellow guidance note
- Selecting `not_started` returns to the clean default state
- No modal button or modal appears anywhere

- [ ] **Step 4: Commit**

```bash
git add src/views/partials/agent/compliance-cdd-card.njk
git rm src/views/partials/agent/cdd-modal.njk
git commit -m "feat: replace CDD modal with inline status dropdown"
```

---

### Task 8: Final regression check

- [ ] **Step 1: Run full test suite**

```bash
npm test --no-coverage 2>&1 | tail -30
```

Expected: All tests PASS

- [ ] **Step 2: Run integration tests**

```bash
npm run test:integration 2>&1 | tail -30
```

Expected: All integration tests PASS

- [ ] **Step 3: Run lint**

```bash
npm run lint 2>&1 | tail -20
```

Expected: No lint errors

- [ ] **Step 4: Final commit if any cleanup needed, then summarise**

```bash
git log --oneline -6
```

Confirm the following commits are in the log:
- `feat: add UpdateCddStatusInput type and updateCddStatusValidator`
- `feat: add upsertCddStatus and deleteCddRecord to compliance repository`
- `feat: add updateCddStatus service function`
- `feat: add PATCH cdd/status endpoint and remove CDD modal endpoints`
- `feat: replace CDD modal with inline status dropdown`
