# Create EAA CDD Gate Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable the "Create EAA" button when CDD status is not `verified`, and enforce that gate on the server side.

**Architecture:** Frontend uses a conditional `disabled` button with tooltip wrapper in the Nunjucks partial. Backend adds a CDD check at the top of `createEaa` in the compliance service, throwing `ComplianceError` if not verified.

**Tech Stack:** Nunjucks templates, TypeScript, Jest

---

## Chunk 1: Backend Guard

### Task 1: Add CDD guard to `createEaa` service

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts` (function `createEaa`, ~line 781)
- Test: `src/domains/compliance/__tests__/compliance.service.test.ts`

**Context:**
- `createEaa` currently writes directly to the repo with no CDD check
- `complianceRepo.findLatestSellerCddRecord(sellerId)` returns the most recent CDD record for a seller
- The CDD record has `identityVerified: boolean` — this is what maps to `status == 'verified'` in the UI
- Throw `ComplianceError` (already imported) with message `'CDD must be verified before creating an EAA'`
- `mockRepo` is typed as `jest.Mocked<typeof complianceRepo> & { ... }` — add `findLatestSellerCddRecord: jest.Mock;` to that intersection block (just before the closing `};` on line 46, after `findSellerCddRecord: jest.Mock;`)
- `jest.mock('../compliance.repository')` auto-mocks all exports, so call `.mockResolvedValue(...)` directly on `mockRepo.findLatestSellerCddRecord` in each test
- `CreateEaaInput` includes `agentId` (stored on the EAA record); `createEaa` also takes a second `agentId` argument used for audit attribution. Pass the same value for both — this is intentional by design.

- [ ] **Step 1: Add `findLatestSellerCddRecord` to the `mockRepo` type block**

In `compliance.service.test.ts`, find the `& {` type intersection block. Add after `findSellerCddRecord: jest.Mock;` (line 45), before the closing `};`:

```typescript
  findLatestSellerCddRecord: jest.Mock;
```

- [ ] **Step 2: Update the existing `describe('createEaa')` block**

There is already a `describe('createEaa')` block at line 617 with one happy-path test. Do NOT add a new block — update the existing one.

**a)** Add `mockRepo.findLatestSellerCddRecord.mockResolvedValue({ identityVerified: true });` to the existing happy-path test setup (before the `complianceService.createEaa(...)` call) so it continues to pass after the guard is added.

**b)** Add these two new guard tests inside the existing `describe('createEaa')` block, after the existing test:

```typescript
  it('throws ComplianceError when CDD is not verified', async () => {
    mockRepo.findLatestSellerCddRecord.mockResolvedValue({ identityVerified: false });

    await expect(
      complianceService.createEaa({ sellerId: 'seller-1', agentId: 'agent-1' }, 'agent-1'),
    ).rejects.toThrow('CDD must be verified before creating an EAA');
  });

  it('throws ComplianceError when no CDD record exists', async () => {
    mockRepo.findLatestSellerCddRecord.mockResolvedValue(null);

    await expect(
      complianceService.createEaa({ sellerId: 'seller-1', agentId: 'agent-1' }, 'agent-1'),
    ).rejects.toThrow('CDD must be verified before creating an EAA');
  });
```

Also add `expect(mockRepo.findLatestSellerCddRecord).toHaveBeenCalledWith('seller-1');` to the existing happy-path test's assertions.

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest compliance.service --no-coverage
```

Expected: 2 failures — `createEaa` currently has no CDD check so the first two tests resolve instead of rejecting.

- [ ] **Step 4: Implement the guard**

In `src/domains/compliance/compliance.service.ts`, replace the `createEaa` function:

```typescript
export async function createEaa(input: CreateEaaInput, agentId: string): Promise<EaaRecord> {
  const cdd = await complianceRepo.findLatestSellerCddRecord(input.sellerId);
  if (!cdd || !cdd.identityVerified) {
    throw new ComplianceError('CDD must be verified before creating an EAA');
  }

  const record = await complianceRepo.createEaa(input);
  await auditService.log({
    agentId,
    action: 'compliance.eaa_created',
    entityType: 'estate_agency_agreement',
    entityId: record.id,
    details: {
      sellerId: input.sellerId,
      agreementType: input.agreementType ?? 'non_exclusive',
    },
  });
  return record;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest compliance.service --no-coverage
```

Expected: all tests pass including the 3 new ones.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all suites pass.

- [ ] **Step 7: Commit**

```bash
git add src/domains/compliance/compliance.service.ts \
        src/domains/compliance/__tests__/compliance.service.test.ts
git commit -m "feat: guard createEaa behind CDD verified check"
```

---

## Chunk 2: Frontend Disabled Button

### Task 2: Conditionally disable Create EAA button

**Files:**
- Modify: `src/views/partials/agent/compliance-eaa-card.njk`

**Context:**
- The "Create EAA" button renders inside `{% if compliance.eaa.status == 'not_started' %}` (line 10), closing at `{% else %}` (line 20) — only replace lines 11–19 (the `<p>` and `<button>` inside that block); the `{% else %}` branch and outer `{% endif %}` are untouched
- `compliance.cdd.status` is confirmed in template scope — `seller-detail.njk` passes the same `compliance` object (built by `agentRepo.getComplianceStatus`) to all partials including `compliance-eaa-card.njk`; `compliance.cdd.status` maps to `'not_started'`, `'pending'`, or `'verified'`
- `disabled` buttons suppress `title` tooltips in some browsers — wrap in `<span title="...">` to ensure tooltip always shows
- Tailwind classes for disabled state: `bg-gray-300 text-gray-500 cursor-not-allowed`
- Existing enabled button classes: `px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700`

- [ ] **Step 1: Update the template**

The file uses 2-space indentation throughout. In `compliance-eaa-card.njk`, replace only lines 11–19 (the `<p>` tag and `<button>` inside the `{% if compliance.eaa.status == 'not_started' %}` block) with:

```nunjucks
    <p class="text-sm text-gray-500 mb-4">{{ "No EAA has been created for this seller." | t }}</p>
    {% if compliance.cdd.status == 'verified' %}
      <button
        type="button"
        hx-get="/agent/sellers/{{ sellerId }}/eaa/modal"
        hx-target="#compliance-modal-container"
        hx-swap="innerHTML"
        class="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">
        {{ "Create EAA" | t }}
      </button>
    {% else %}
      <span title="{{ 'CDD must be Verified before creating an EAA' | t }}">
        <button
          type="button"
          disabled
          class="px-4 py-2 text-sm bg-gray-300 text-gray-500 rounded cursor-not-allowed">
          {{ "Create EAA" | t }}
        </button>
      </span>
    {% endif %}
```

The outer `{% if compliance.eaa.status == 'not_started' %}`, `{% else %}`, and `{% endif %}` remain unchanged.

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all tests pass (template change has no unit test impact).

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/agent/compliance-eaa-card.njk
git commit -m "feat: disable Create EAA button when CDD not verified"
```
