# CDD Verification Modal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an agent selects "Verified" for a seller's CDD status, intercept with a confirmation modal requiring them to type "I confirm"; once confirmed the CDD record is locked for agents (admins can revert).

**Architecture:** Three layers — service (lock enforcement + new `verifyCdd` fn), router (two new endpoints + PATCH guard), UI (modal partial + updated CDD card). No schema changes needed; `identityVerified` and `verifiedAt` already exist on `CddRecord`. HTMX handles all partial swaps. Note: `compliance.cdd.status === 'verified'` is derived directly from `identityVerified === true` in `agentRepo.getComplianceStatus`, so the template can safely branch on `status`.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Jest, Supertest

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/domains/compliance/compliance.repository.ts` | Add `findSellerCddRecord(sellerId)` |
| Modify | `src/domains/compliance/compliance.service.ts` | Add `verifyCdd`; guard `updateCddStatus` with `isAdmin` param |
| Modify | `src/domains/compliance/compliance.router.ts` | Two new endpoints; PATCH passes `isAdmin`; render calls pass `isAdmin` |
| Modify | `src/domains/agent/agent.router.ts` | Pass `isAdmin` in seller-detail render context |
| Create | `src/views/partials/agent/cdd-verify-modal.njk` | Confirmation modal partial |
| Modify | `src/views/partials/agent/compliance-cdd-card.njk` | Locked state + select intercept |
| Modify | `src/domains/compliance/__tests__/compliance.service.test.ts` | New service tests |
| Modify | `src/domains/compliance/__tests__/compliance.router.test.ts` | New router tests |

---

## Chunk 1: Repository + Service

### Task 1: Add `findSellerCddRecord` to repository

**Files:**
- Modify: `src/domains/compliance/compliance.repository.ts`

This function lets `updateCddStatus` check `identityVerified` before writing.

- [ ] **Step 1: Add the function** after `upsertCddStatus` (around line 148):

```typescript
export async function findSellerCddRecord(
  sellerId: string,
): Promise<{ id: string; identityVerified: boolean } | null> {
  return prisma.cddRecord.findFirst({
    where: { subjectType: SubjectType.seller, subjectId: sellerId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, identityVerified: true },
  });
}
```

- [ ] **Step 2: Run tests to confirm nothing broken**

```bash
npm test -- --testPathPattern=compliance
```

Expected: all existing compliance tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/domains/compliance/compliance.repository.ts
git commit -m "feat: add findSellerCddRecord to compliance repo"
```

---

### Task 2: Add `verifyCdd` service function + guard `updateCddStatus`

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts`
- Modify: `src/domains/compliance/__tests__/compliance.service.test.ts`

**Context:**
- `updateCddStatus` is at line 682 in `compliance.service.ts`
- Test file mock setup is at lines 1–49; `mockRepo` is the jest mock of the repo module
- `mockRepo.upsertCddStatus` and `mockRepo.deleteCddRecord` are already in the mock type cast; add `findSellerCddRecord` inline with `(mockRepo as any).findSellerCddRecord = jest.fn()`
- The import line in `compliance.service.ts` currently imports: `NotFoundError, ForbiddenError, ValidationError, ComplianceError, ConflictError` — `ConflictError` is already there

- [ ] **Step 1: Write failing tests** — append a new `describe` block to `compliance.service.test.ts`:

```typescript
describe('verifyCdd', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws ValidationError when phrase is wrong', async () => {
    await expect(
      complianceService.verifyCdd('seller-1', 'agent-1', 'wrong phrase'),
    ).rejects.toThrow('Invalid confirmation phrase');
  });

  it('throws ConflictError when record is already identityVerified', async () => {
    (mockRepo as any).findSellerCddRecord = jest.fn().mockResolvedValue({
      id: 'cdd-1',
      identityVerified: true,
    });

    await expect(
      complianceService.verifyCdd('seller-1', 'agent-1', 'I confirm'),
    ).rejects.toThrow('CDD is already verified and locked');
  });

  it('calls upsertCddStatus("verified") and logs audit on success', async () => {
    // upsertCddStatus with 'verified' sets identityVerified=true and verifiedAt=now in the repo;
    // testing that it's called with 'verified' is sufficient to verify those fields are written.
    (mockRepo as any).findSellerCddRecord = jest.fn().mockResolvedValue(null);
    mockRepo.upsertCddStatus.mockResolvedValue(undefined);

    await complianceService.verifyCdd('seller-1', 'agent-1', 'I confirm');

    expect(mockRepo.upsertCddStatus).toHaveBeenCalledWith('seller-1', 'agent-1', 'verified');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.identity_verified', entityId: 'seller-1' }),
    );
  });
});

describe('updateCddStatus — lock guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockRepo as any).findSellerCddRecord = jest.fn();
  });

  it('throws ForbiddenError when agent tries to set status=verified directly', async () => {
    await expect(
      complianceService.updateCddStatus('seller-1', 'verified', 'agent-1', false),
    ).rejects.toThrow('Agents must use the verification modal to set CDD to Verified');
  });

  it('throws ForbiddenError when agent tries to change status on a locked record', async () => {
    (mockRepo as any).findSellerCddRecord.mockResolvedValue({
      id: 'cdd-1',
      identityVerified: true,
    });

    await expect(
      complianceService.updateCddStatus('seller-1', 'pending', 'agent-1', false),
    ).rejects.toThrow('CDD is locked. Contact an admin to revert.');
  });

  it('allows admin to revert a locked record (skips lock check)', async () => {
    // identityVerified: true — proves admin bypasses the lock
    (mockRepo as any).findSellerCddRecord.mockResolvedValue({
      id: 'cdd-1',
      identityVerified: true,
    });
    mockRepo.deleteCddRecord.mockResolvedValue(undefined);

    await complianceService.updateCddStatus('seller-1', 'not_started', 'agent-1', true);

    expect(mockRepo.deleteCddRecord).toHaveBeenCalledWith('seller-1');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern=compliance.service
```

Expected: new tests FAIL (functions not yet implemented / wrong signatures).

- [ ] **Step 3: Implement `verifyCdd`** — add after the existing `updateCddStatus` function (around line 718):

```typescript
export async function verifyCdd(
  sellerId: string,
  agentId: string,
  phrase: string,
): Promise<void> {
  if (phrase !== 'I confirm') {
    throw new ValidationError('Invalid confirmation phrase');
  }

  const existing = await complianceRepo.findSellerCddRecord(sellerId);
  if (existing?.identityVerified) {
    throw new ConflictError('CDD is already verified and locked');
  }

  await complianceRepo.upsertCddStatus(sellerId, agentId, 'verified');

  await auditService.log({
    agentId,
    action: 'cdd.identity_verified',
    entityType: 'seller',
    entityId: sellerId,
    details: { sellerId },
  });
}
```

- [ ] **Step 4: Modify `updateCddStatus`** — add `isAdmin` parameter and lock guards.

Replace the existing function signature and body (lines 682–718) with:

```typescript
export async function updateCddStatus(
  sellerId: string,
  status: 'not_started' | 'pending' | 'verified',
  agentId: string,
  isAdmin = false,
): Promise<void> {
  // Agents cannot set verified directly — must use verifyCdd (modal flow)
  if (status === 'verified' && !isAdmin) {
    throw new ForbiddenError('Agents must use the verification modal to set CDD to Verified');
  }

  // If record is locked, only admins can change it
  if (!isAdmin) {
    const existing = await complianceRepo.findSellerCddRecord(sellerId);
    if (existing?.identityVerified) {
      throw new ForbiddenError('CDD is locked. Contact an admin to revert.');
    }
  }

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

- [ ] **Step 5: Update existing `updateCddStatus` tests** — the three existing tests in `describe('updateCddStatus')` must mock `findSellerCddRecord` and use the new signature. Replace the entire existing `describe('updateCddStatus')` block:

```typescript
describe('updateCddStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: record is not locked
    (mockRepo as any).findSellerCddRecord = jest.fn().mockResolvedValue(null);
  });

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

  it('allows admin to set verified directly', async () => {
    mockRepo.upsertCddStatus.mockResolvedValue(undefined);

    await complianceService.updateCddStatus('seller-1', 'verified', 'agent-1', true);

    expect(mockRepo.upsertCddStatus).toHaveBeenCalledWith('seller-1', 'agent-1', 'verified');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.identity_verified', entityId: 'seller-1' }),
    );
  });
});
```

- [ ] **Step 6: Run all compliance service tests**

```bash
npm test -- --testPathPattern=compliance.service
```

Expected: ALL pass.

- [ ] **Step 7: Commit**

```bash
git add src/domains/compliance/compliance.service.ts \
        src/domains/compliance/__tests__/compliance.service.test.ts
git commit -m "feat: add verifyCdd service fn and lock guard on updateCddStatus"
```

---

## Chunk 2: Router

### Task 3: Two new router endpoints + PATCH guard

**Files:**
- Modify: `src/domains/compliance/compliance.router.ts`
- Modify: `src/domains/compliance/__tests__/compliance.router.test.ts`

**Context:**
- Existing modal GET endpoints are at lines 687–748 of `compliance.router.ts`
- Existing PATCH for CDD status is at lines 483–502
- Test helpers: `createTestApp`, `createAgentApp` defined at lines 39–81; you need to add `createAdminApp` too
- `mockComplianceStatus` fixture is at lines 17–37 with `cdd.status: 'not_started'`

- [ ] **Step 1: Write failing router tests** — add to `compliance.router.test.ts`.

First, add `createAdminApp` alongside the existing helpers:

```typescript
function createAdminApp() {
  return createTestApp({ id: 'admin-1', role: 'admin' });
}
```

Also check whether `createTestApp` already has an error handler. Look for `app.use((err` in the test file. If none exists, add one after `app.use(complianceRouter)`:

```typescript
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status =
    err.name === 'ValidationError' ? 400 :
    err.name === 'UnauthorizedError' ? 401 :
    err.name === 'ForbiddenError' ? 403 :
    err.name === 'NotFoundError' ? 404 :
    err.name === 'ConflictError' ? 409 : 500;
  res.status(status).json({ error: err.message });
});
```

Also create a verified compliance status fixture for use in the POST verify 200 test:

```typescript
const mockVerifiedComplianceStatus = {
  ...mockComplianceStatus,
  cdd: {
    ...mockComplianceStatus.cdd,
    status: 'verified' as const,
    verifiedAt: new Date('2026-03-17'),
  },
} as unknown as Awaited<ReturnType<typeof agentRepo.getComplianceStatus>>;
```

Now add the new describe blocks:

```typescript
describe('GET /agent/sellers/:sellerId/cdd/verify-modal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when unauthenticated', async () => {
    const app = createTestApp();
    const res = await request(app).get('/agent/sellers/seller-1/cdd/verify-modal');
    expect(res.status).toBe(401);
  });

  it('returns 200 with modal HTML when authenticated as agent', async () => {
    const app = createAgentApp();
    const res = await request(app).get('/agent/sellers/seller-1/cdd/verify-modal');
    expect(res.status).toBe(200);
    expect(res.text).toContain('I confirm');
  });
});

describe('POST /agent/sellers/:sellerId/cdd/verify', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 when phrase is wrong', async () => {
    mockService.verifyCdd = jest.fn().mockRejectedValue(
      Object.assign(new Error('Invalid confirmation phrase'), {
        name: 'ValidationError',
        statusCode: 400,
      }),
    );
    const app = createAgentApp();
    const res = await request(app)
      .post('/agent/sellers/seller-1/cdd/verify')
      .send({ phrase: 'wrong' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when already verified', async () => {
    mockService.verifyCdd = jest.fn().mockRejectedValue(
      Object.assign(new Error('CDD is already verified and locked'), {
        name: 'ConflictError',
        statusCode: 409,
      }),
    );
    const app = createAgentApp();
    const res = await request(app)
      .post('/agent/sellers/seller-1/cdd/verify')
      .send({ phrase: 'I confirm' });
    expect(res.status).toBe(409);
  });

  it('returns 200 with refreshed locked CDD card on correct phrase', async () => {
    mockService.verifyCdd = jest.fn().mockResolvedValue(undefined);
    // Return verified status so the card renders the locked state
    mockAgentRepo.getComplianceStatus.mockResolvedValue(mockVerifiedComplianceStatus);
    const app = createAgentApp();
    const res = await request(app)
      .post('/agent/sellers/seller-1/cdd/verify')
      .send({ phrase: 'I confirm' });
    expect(res.status).toBe(200);
    expect(mockService.verifyCdd).toHaveBeenCalledWith('seller-1', 'agent-1', 'I confirm');
    // Card should include locked messaging
    expect(res.text).toContain('Locked');
  });
});

describe('PATCH /agent/sellers/:sellerId/cdd/status — lock guards', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 403 when agent tries to set status=verified', async () => {
    mockService.updateCddStatus = jest.fn().mockRejectedValue(
      Object.assign(new Error('Agents must use the verification modal'), {
        name: 'ForbiddenError',
        statusCode: 403,
      }),
    );
    const app = createAgentApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'verified' });
    expect(res.status).toBe(403);
  });

  it('returns 403 when agent tries to change a locked record', async () => {
    mockService.updateCddStatus = jest.fn().mockRejectedValue(
      Object.assign(new Error('CDD is locked'), { name: 'ForbiddenError', statusCode: 403 }),
    );
    const app = createAgentApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'not_started' });
    expect(res.status).toBe(403);
  });

  it('returns 200 and calls updateCddStatus with isAdmin=true when admin patches', async () => {
    mockService.updateCddStatus = jest.fn().mockResolvedValue(undefined);
    mockAgentRepo.getComplianceStatus.mockResolvedValue(mockComplianceStatus);
    const app = createAdminApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'not_started' });
    expect(res.status).toBe(200);
    expect(mockService.updateCddStatus).toHaveBeenCalledWith(
      'seller-1', 'not_started', 'admin-1', true,
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern=compliance.router
```

Expected: new tests FAIL (endpoints don't exist yet, PATCH doesn't pass isAdmin).

- [ ] **Step 3: Add the two new router endpoints** — append to `compliance.router.ts` after line 748:

```typescript
// GET /agent/sellers/:sellerId/cdd/verify-modal — Returns confirmation modal partial
complianceRouter.get(
  '/agent/sellers/:sellerId/cdd/verify-modal',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.params['sellerId'] as string;
      return res.render('partials/agent/cdd-verify-modal', { sellerId });
    } catch (err) {
      return next(err);
    }
  },
);

// POST /agent/sellers/:sellerId/cdd/verify — Validates phrase, writes verified, returns refreshed card
complianceRouter.post(
  '/agent/sellers/:sellerId/cdd/verify',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.params['sellerId'] as string;
      const agentId = getAgentId(req);
      const { phrase } = req.body as { phrase?: string };

      await complianceService.verifyCdd(sellerId, agentId, phrase ?? '');

      const isAdmin = (req.user as { role: string }).role === 'admin';
      const compliance = await agentRepo.getComplianceStatus(sellerId, agentId);
      return res.render('partials/agent/compliance-cdd-card', { compliance, sellerId, isAdmin });
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 4: Update the existing PATCH handler** — in the PATCH `/agent/sellers/:sellerId/cdd/status` handler (lines 483–502), replace:

```typescript
await complianceService.updateCddStatus(sellerId, status, agentId);

const compliance = await agentRepo.getComplianceStatus(sellerId, agentId);
return res.render('partials/agent/compliance-cdd-card', { compliance, sellerId });
```

With:

```typescript
const isAdmin = (req.user as { role: string }).role === 'admin';
await complianceService.updateCddStatus(sellerId, status, agentId, isAdmin);

const compliance = await agentRepo.getComplianceStatus(sellerId, agentId);
return res.render('partials/agent/compliance-cdd-card', { compliance, sellerId, isAdmin });
```

- [ ] **Step 5: Run all compliance tests**

```bash
npm test -- --testPathPattern=compliance
```

Expected: ALL compliance tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/domains/compliance/compliance.router.ts \
        src/domains/compliance/__tests__/compliance.router.test.ts
git commit -m "feat: add CDD verify-modal and verify endpoints, PATCH isAdmin guard"
```

---

## Chunk 3: UI

### Task 4: Pass `isAdmin` to seller-detail page in agent router

**Files:**
- Modify: `src/domains/agent/agent.router.ts`

The seller-detail page includes `compliance-cdd-card.njk` via Nunjucks `{% include %}`. This means `isAdmin` must be in the top-level template context — it does not get passed through from the partial render. If it is missing, the locked badge will never appear on initial page load for agents.

- [ ] **Step 1: Update `res.render` in the seller detail GET handler** (line 141 in `agent.router.ts`):

Replace:
```typescript
res.render('pages/agent/seller-detail', {
  seller,
  compliance,
  notifications,
  milestones,
  sellerId: seller.id,
});
```

With:
```typescript
const isAdmin = user.role === 'admin';
res.render('pages/agent/seller-detail', {
  seller,
  compliance,
  notifications,
  milestones,
  sellerId: seller.id,
  isAdmin,
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- --testPathPattern=agent.router
```

Expected: existing agent router tests pass (no breakage).

- [ ] **Step 3: Commit**

```bash
git add src/domains/agent/agent.router.ts
git commit -m "feat: pass isAdmin to seller-detail template context for CDD lock display"
```

---

### Task 5: Create the confirmation modal partial

**Files:**
- Create: `src/views/partials/agent/cdd-verify-modal.njk`

The modal is rendered into `#compliance-modal-container`. Check that this div exists in the seller detail page:

```bash
grep -n "compliance-modal-container" src/views/pages/agent/seller-detail.njk
```

If missing, add `<div id="compliance-modal-container"></div>` near the CDD card section in `seller-detail.njk`.

- [ ] **Step 1: Create the modal partial** at `src/views/partials/agent/cdd-verify-modal.njk`:

```nunjucks
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" id="cdd-verify-modal-backdrop">
  <div class="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
    <h2 class="text-lg font-semibold text-gray-900 mb-3">{{ "Confirm CDD Completion" | t }}</h2>
    <p class="text-sm text-gray-600 mb-4">
      {{ "You are about to mark this seller's CDD as Verified. This action cannot be undone by you. Type" | t }}
      <strong>I confirm</strong>
      {{ "below to proceed." | t }}
    </p>

    <input
      type="text"
      id="cdd-confirm-phrase"
      name="phrase"
      class="w-full border rounded px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      placeholder="{{ 'Type: I confirm' | t }}"
      autocomplete="off">

    <div class="flex gap-3 justify-end">
      <button
        type="button"
        class="px-4 py-2 text-sm border rounded text-gray-700 hover:bg-gray-50"
        onclick="document.getElementById('compliance-modal-container').innerHTML = ''">
        {{ "Cancel" | t }}
      </button>
      <button
        id="cdd-confirm-btn"
        type="button"
        disabled
        class="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
        hx-post="/agent/sellers/{{ sellerId }}/cdd/verify"
        hx-include="#cdd-confirm-phrase"
        hx-target="#compliance-cdd-card"
        hx-swap="outerHTML">
        {{ "Confirm Verification" | t }}
      </button>
    </div>
  </div>
</div>

<script nonce="{{ cspNonce }}">
(function () {
  var input = document.getElementById('cdd-confirm-phrase');
  var btn = document.getElementById('cdd-confirm-btn');
  input.addEventListener('input', function () {
    btn.disabled = input.value !== 'I confirm';
  });
})();
</script>
```

**Note:** The Confirm button uses `hx-include="#cdd-confirm-phrase"` which posts the input's `name="phrase"` value. No `hx-vals` is needed — HTMX reads the input value at submit time. The inline JS only enables/disables the button.

- [ ] **Step 2: Commit**

```bash
git add src/views/partials/agent/cdd-verify-modal.njk
git commit -m "feat: add CDD verification confirmation modal partial"
```

---

### Task 6: Update the CDD card — locked state + select intercept

**Files:**
- Modify: `src/views/partials/agent/compliance-cdd-card.njk`

**Context:**
- Current card is 38 lines
- `compliance.cdd.status === 'verified'` means `identityVerified === true` (derived in `agentRepo.getComplianceStatus`)
- `isAdmin` is passed from the router render call and the page template context

- [ ] **Step 1: Replace `compliance-cdd-card.njk`** with the new version:

```nunjucks
<div id="compliance-cdd-card">
  {% if compliance.cdd.status == 'verified' and not isAdmin %}
  {# ── Locked state — agent view ── #}
  <div class="flex items-center gap-3">
    <span class="px-3 py-1.5 text-sm font-medium rounded-full bg-green-100 text-green-800">
      {{ "Verified ✓" | t }}
    </span>
    {% if compliance.cdd.verifiedAt %}
    <span class="text-xs text-gray-500">{{ compliance.cdd.verifiedAt | date('DD/MM/YYYY') }}</span>
    {% endif %}
  </div>
  <p class="text-xs text-gray-400 mt-2 italic">{{ "Locked — contact admin to revert." | t }}</p>

  {% else %}
  {# ── Editable state — agent (unlocked) or admin ── #}
  <div class="flex items-center gap-3">
    <label class="text-sm font-medium text-gray-700" for="cdd-status-select">{{ "Status" | t }}</label>
    <div class="relative">
      <select
        id="cdd-status-select"
        name="status"
        hx-patch="/agent/sellers/{{ sellerId }}/cdd/status"
        hx-trigger="change[this.value !== 'verified']"
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
  {% endif %}
</div>

<script nonce="{{ cspNonce }}">
(function () {
  var select = document.getElementById('cdd-status-select');
  if (!select) return;
  select.addEventListener('change', function () {
    if (select.value === 'verified') {
      // Intercept: fire modal instead of HTMX PATCH
      htmx.ajax('GET', '/agent/sellers/{{ sellerId }}/cdd/verify-modal', {
        target: '#compliance-modal-container',
        swap: 'innerHTML',
      });
      // Reset select so UI stays consistent until modal confirms
      select.value = '{{ compliance.cdd.status }}';
    }
  });
})();
</script>
```

**Key design decisions:**
- `hx-trigger="change[this.value !== 'verified']"` — HTMX PATCH only fires for `not_started`/`pending` selections; the inline JS intercepts `verified`
- The inline script resets the select to the current status after opening the modal
- Agent with `identityVerified=true` sees the locked badge (no select) because the outer `{% if %}` branch applies

- [ ] **Step 2: Run full test suite**

```bash
npm test && npm run test:integration
```

Expected: ALL tests pass.

- [ ] **Step 3: Manual end-to-end check**

1. `npm run dev`
2. Log in as Michael Ng (agent): `michael@sellmyhouse.sg` / `password123`
3. Open a seller detail page
4. CDD Status → pick "Pending" → card refreshes to Pending state ✓
5. CDD Status → pick "Verified" → modal appears, select resets to previous value ✓
6. Type anything other than "I confirm" → button stays disabled ✓
7. Type "I confirm" exactly → Confirm button enables ✓
8. Click Cancel → modal closes, select stays at Pending ✓
9. Open modal again → type "I confirm" → click Confirm → card refreshes to locked badge + date + "Locked — contact admin to revert." ✓
10. Log out, log in as admin
11. Navigate to same seller → CDD card shows select with all three options (not locked badge) ✓
12. Admin can pick "Not Started" → card refreshes to Not Started ✓

- [ ] **Step 4: Commit**

```bash
git add src/views/partials/agent/compliance-cdd-card.njk
git commit -m "feat: CDD card locked state and select intercept for verify modal"
```

---

## Final: Full test run + cleanup

- [ ] **Run all tests**

```bash
npm test && npm run test:integration
```

Expected: all suites pass.
