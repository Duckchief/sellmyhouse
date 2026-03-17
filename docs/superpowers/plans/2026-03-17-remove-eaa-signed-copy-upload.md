# Remove EAA Signed Copy Upload — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "Upload Signed Copy" feature from the EAA workflow; keep "Mark as Signed" status button intact.

**Architecture:** Pure deletion — remove UI, router branches, service functions, repository functions, and tests. No new code. No DB migration (columns stay, will always be null). Note: `multer` import, `upload` variable, the POST `/agent/eaa/:eaaId/signed-copy` route, and the GET `/agent/eaa/:eaaId/signed-copy/modal` route were already removed from `compliance.router.ts` in a prior session.

**Tech Stack:** TypeScript, Express, Nunjucks, Jest, Prisma

---

## Chunk 1: Tests and UI

### Task 1: Remove router test for signed-copy modal

**Files:**
- Modify: `src/domains/compliance/__tests__/compliance.router.test.ts`

- [ ] **Step 1: Remove the describe block for the modal GET route**

In `compliance.router.test.ts`, delete the entire block at the bottom of the file (around lines 406–413):

```typescript
describe('GET /agent/eaa/:eaaId/signed-copy/modal', () => {
  it('returns signed copy upload modal HTML', async () => {
    const app = createAgentApp();
    const res = await request(app).get('/agent/eaa/eaa-1/signed-copy/modal');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Upload Signed EAA Copy');
  });
});
```

- [ ] **Step 2: Run compliance router tests**

```bash
npm test -- --testPathPatterns="compliance.router" --no-coverage 2>&1 | tail -15
```

Expected: all remaining tests pass, total count drops by 1.

- [ ] **Step 3: Commit**

```bash
git add src/domains/compliance/__tests__/compliance.router.test.ts
git commit -m "test: remove signed-copy modal route test"
```

---

### Task 2: Remove service tests for uploadEaaSignedCopy

**Files:**
- Modify: `src/domains/compliance/__tests__/compliance.service.test.ts`

- [ ] **Step 1: Remove `updateEaaSignedCopy` from the mock repo type**

Find the `mockRepo` type definition (around line 41). Remove this line:

```typescript
  updateEaaSignedCopy: jest.Mock;
```

- [ ] **Step 2: Remove the uploadEaaSignedCopy describe block**

Delete the entire block (around lines 680–738):

```typescript
describe('uploadEaaSignedCopy', () => {
  const baseEaa = {
    id: 'eaa-1',
    sellerId: 'seller-1',
    agentId: 'agent-1',
    status: 'draft',
  };

  it('saves file and updates EAA record', async () => { ... });
  it('rejects non-allowed file types', async () => { ... });
  it('rejects files exceeding 10MB', async () => { ... });
});
```

- [ ] **Step 3: Run compliance service tests**

```bash
npm test -- --testPathPatterns="compliance.service" --no-coverage 2>&1 | tail -15
```

Expected: all remaining tests pass, total drops by 3.

- [ ] **Step 4: Commit**

```bash
git add src/domains/compliance/__tests__/compliance.service.test.ts
git commit -m "test: remove uploadEaaSignedCopy service tests"
```

---

### Task 3: Remove repository test for updateEaaSignedCopy

**Files:**
- Modify: `src/domains/compliance/__tests__/compliance.repository.test.ts`

- [ ] **Step 1: Remove the exports assertion for updateEaaSignedCopy**

Find the block that checks exported function names (around line 59–65). Remove this line:

```typescript
    expect(typeof complianceRepo.updateEaaSignedCopy).toBe('function');
```

- [ ] **Step 2: Run compliance repository tests**

```bash
npm test -- --testPathPatterns="compliance.repository" --no-coverage 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/domains/compliance/__tests__/compliance.repository.test.ts
git commit -m "test: remove updateEaaSignedCopy repository assertion"
```

---

### Task 4: Remove UI — signed copy display, button, and modal template

**Files:**
- Modify: `src/views/partials/agent/compliance-eaa-card.njk`
- Delete: `src/views/partials/agent/eaa-signed-copy-modal.njk`

- [ ] **Step 1: Remove the "Signed Copy: Uploaded" display block**

In `compliance-eaa-card.njk`, find and delete lines 34–39:

```nunjucks
      {% if compliance.eaa.signedCopyPath %}
      <div class="flex justify-between">
        <dt class="text-gray-500">{{ "Signed Copy" | t }}</dt>
        <dd class="text-green-600">{{ "Uploaded" | t }}</dd>
      </div>
      {% endif %}
```

- [ ] **Step 2: Remove the "Upload Signed Copy" button**

In the same file, find and delete lines 44–53:

```nunjucks
      {% if compliance.eaa.status == 'draft' or compliance.eaa.status == 'sent_to_seller' %}
        <button
          type="button"
          hx-get="/agent/eaa/{{ compliance.eaa.id }}/signed-copy/modal"
          hx-target="#compliance-modal-container"
          hx-swap="innerHTML"
          class="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50">
          {{ "Upload Signed Copy" | t }}
        </button>
      {% endif %}
```

- [ ] **Step 3: Delete the modal template**

```bash
git rm src/views/partials/agent/eaa-signed-copy-modal.njk
```

- [ ] **Step 4: Commit**

```bash
git add src/views/partials/agent/compliance-eaa-card.njk
git commit -m "feat: remove Upload Signed Copy UI from EAA card"
```

---

## Chunk 2: Backend removal

### Task 5: Remove eaa branches from router endpoints

**Files:**
- Modify: `src/domains/compliance/compliance.router.ts`

Note: The POST upload route, GET modal route, `multer` import, and `upload` variable were already removed. Only the download and bulk-delete endpoint branches remain.

- [ ] **Step 1: Remove `eaa` branch from the document download endpoint**

In the `GET /agent/transactions/:txId/documents` route, find and delete:

```typescript
      } else if (docType === 'eaa' && txDocs.estateAgencyAgreement?.signedCopyPath) {
        filePath = txDocs.estateAgencyAgreement.signedCopyPath;
        docRecordId = txDocs.estateAgencyAgreement.id;
```

- [ ] **Step 2: Remove `eaa` blocks from the bulk document delete (zip download route)**

Find and delete the push block:

```typescript
      if (txDocs.estateAgencyAgreement?.signedCopyPath) {
        filesToProcess.push({
          filePath: txDocs.estateAgencyAgreement.signedCopyPath,
          docType: 'eaa',
          recordId: txDocs.estateAgencyAgreement.id,
        });
      }
```

And the corresponding deletion handler:

```typescript
              } else if (doc.docType === 'eaa') {
                await complianceService.recordEaaSignedCopyDeleted(doc.recordId);
              }
```

- [ ] **Step 3: Check TypeScript compiles**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/domains/compliance/compliance.router.ts
git commit -m "feat: remove eaa doc type from download and bulk-delete endpoints"
```

---

### Task 6: Remove service functions

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts`

- [ ] **Step 1: Remove `ALLOWED_DOC_TYPES`, `MAX_DOC_SIZE`, and `uploadEaaSignedCopy`**

Find and delete (around lines 820–852):

```typescript
const ALLOWED_DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
const MAX_DOC_SIZE = 10 * 1024 * 1024; // 10MB

export async function uploadEaaSignedCopy(
  eaaId: string,
  file: { buffer: Buffer; mimetype: string; originalname: string },
  agentId: string,
): Promise<EaaRecord> {
  ...
}
```

- [ ] **Step 2: Remove `recordEaaSignedCopyDeleted`**

Find and delete (around lines 895–897):

```typescript
export async function recordEaaSignedCopyDeleted(eaaId: string): Promise<void> {
  return complianceRepo.markEaaSignedCopyDeleted(eaaId);
}
```

- [ ] **Step 3: Check TypeScript compiles**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/domains/compliance/compliance.service.ts
git commit -m "feat: remove uploadEaaSignedCopy and recordEaaSignedCopyDeleted service functions"
```

---

### Task 7: Remove repository functions and clean up queries

**Files:**
- Modify: `src/domains/compliance/compliance.repository.ts`

- [ ] **Step 1: Remove `updateEaaSignedCopy`**

Find and delete (around lines 430–438):

```typescript
export async function updateEaaSignedCopy(
  eaaId: string,
  signedCopyPath: string,
): Promise<EaaRecord> {
  return prisma.estateAgencyAgreement.update({
    where: { id: eaaId },
    data: { signedCopyPath },
  }) as unknown as Promise<EaaRecord>;
}
```

- [ ] **Step 2: Remove `markEaaSignedCopyDeleted`**

Find and delete (around lines 759–764):

```typescript
export async function markEaaSignedCopyDeleted(eaaId: string): Promise<void> {
  await prisma.estateAgencyAgreement.update({
    where: { id: eaaId },
    data: { signedCopyPath: null, signedCopyDeletedAt: new Date() },
  });
}
```

- [ ] **Step 3: Remove EAA paths from `collectSellerFilePaths`**

Find and delete the EAA block in that function (around lines 655–662):

```typescript
  // 4. Estate agency agreement signed copies
  const eaas = await prisma.estateAgencyAgreement.findMany({
    where: { sellerId },
    select: { signedCopyPath: true },
  });
  for (const eaa of eaas) {
    if (eaa.signedCopyPath) paths.push(eaa.signedCopyPath);
  }
```

- [ ] **Step 4: Remove `signedCopyPath` and `signedCopyDeletedAt` from `findTransactionDocuments` select**

Find the `estateAgencyAgreement` select inside `findTransactionDocuments` (around lines 717–723):

```typescript
      estateAgencyAgreement: {
        select: {
          id: true,
          signedCopyPath: true,
          signedCopyDeletedAt: true,
        },
      },
```

Change it to:

```typescript
      estateAgencyAgreement: {
        select: {
          id: true,
        },
      },
```

- [ ] **Step 5: Check TypeScript compiles**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 6: Run all compliance tests**

```bash
npm test -- --testPathPatterns="compliance" --no-coverage 2>&1 | tail -20
```

Expected: all suites pass. (The `updateEaaSignedCopy` repository assertion was removed in Task 3.)

- [ ] **Step 7: Commit**

```bash
git add src/domains/compliance/compliance.repository.ts
git commit -m "feat: remove EAA signed copy repository functions and clean up queries"
```

---

## Chunk 3: Final verification

### Task 8: Full test run and dead-reference check

- [ ] **Step 1: Run the full unit test suite**

```bash
npm test -- --no-coverage 2>&1 | tail -20
```

Expected: all suites pass.

- [ ] **Step 2: Confirm no dead references remain**

```bash
grep -r "uploadEaaSignedCopy\|updateEaaSignedCopy\|recordEaaSignedCopyDeleted\|markEaaSignedCopyDeleted\|signed-copy\|eaa-signed-copy-modal\|signedCopyPath\|signedCopyDeletedAt" src/ --include="*.ts" --include="*.njk"
```

Expected: no output. (If any appear, they are in dead test fixtures referencing the DB field — acceptable only in `signedCopyPath: null` mock data literals that match the DB type.)
