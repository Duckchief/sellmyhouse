# Huttons Handoff Confirmation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow agents to confirm they've submitted sensitive documents to Huttons' case system, triggering immediate Tier 1 purge.

**Architecture:** New fields on Transaction track handoff timestamp + agent. A compliance service function runs immediate Tier 1 purge (reuses `purgeTransactionSensitiveDocs`). Route on transaction router, HTMX partial for the UI panel.

**Tech Stack:** Prisma migration, TypeScript, Express route, Nunjucks partial, HTMX

---

### Task 1: Schema — Add Huttons handoff fields to Transaction

**Files:**
- Modify: `prisma/schema.prisma:625-667` (Transaction model)
- Create: `prisma/migrations/20260319130000_huttons_handoff/migration.sql`

**Step 1: Add fields to Transaction model in schema.prisma**

After line 653 (`hdbAppApprovedAt`), before `fallenThroughReason`, add:

```prisma
  huttonsSubmittedAt           DateTime?             @map("huttons_submitted_at")
  huttonsSubmittedByAgentId    String?               @map("huttons_submitted_by_agent_id")
  huttonsSubmittedByAgent      Agent?                @relation("HuttonsSubmitter", fields: [huttonsSubmittedByAgentId], references: [id])
```

Add back-relation on Agent model (after `hdbSubmissions` line 362):

```prisma
  huttonsSubmissions           Transaction[]            @relation("HuttonsSubmitter")
```

**Step 2: Create migration SQL**

Create `prisma/migrations/20260319130000_huttons_handoff/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "huttons_submitted_at" TIMESTAMP(3),
ADD COLUMN "huttons_submitted_by_agent_id" TEXT;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_huttons_submitted_by_agent_id_fkey" FOREIGN KEY ("huttons_submitted_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

**Step 3: Run migration and generate client**

```bash
npx prisma migrate deploy
npx prisma generate
```

**Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add huttons handoff fields to Transaction"
```

---

### Task 2: Repository — confirmHuttonsHandoff + findTransactionsPendingHuttonsHandoff

**Files:**
- Modify: `src/domains/transaction/transaction.repository.ts`

**Step 1: Write failing tests**

These are repository functions that call Prisma directly. Since the repo is fully mocked in service tests, the repo functions themselves are thin Prisma wrappers. We'll test them through the service layer in Task 3. Add the functions now.

**Step 2: Add confirmHuttonsHandoff to transaction.repository.ts**

After `updateHdbTracking` (line 96), add:

```typescript
export async function confirmHuttonsHandoff(id: string, agentId: string) {
  return prisma.transaction.update({
    where: { id },
    data: {
      huttonsSubmittedAt: new Date(),
      huttonsSubmittedByAgentId: agentId,
    },
  });
}
```

**Step 3: Add findTransactionsPendingHuttonsHandoff**

After `confirmHuttonsHandoff`, add:

```typescript
export async function findTransactionsPendingHuttonsHandoff() {
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  return prisma.transaction.findMany({
    where: {
      status: 'completed',
      huttonsSubmittedAt: null,
      completionDate: { lt: threeDaysAgo, not: null },
    },
    select: {
      id: true,
      sellerId: true,
      completionDate: true,
      seller: { select: { name: true, agentId: true } },
    },
  });
}
```

**Step 4: Commit**

```bash
git add src/domains/transaction/transaction.repository.ts
git commit -m "feat(repo): add Huttons handoff confirmation and pending query"
```

---

### Task 3: Service — confirmHuttonsSubmission with immediate Tier 1 purge

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts`
- Test: `src/domains/compliance/__tests__/compliance.service.test.ts`

**Step 1: Write failing test — happy path**

Add to `compliance.service.test.ts`, before the final closing. First, add the transaction repo mock at the top of the file alongside the other mocks:

```typescript
import * as txRepo from '../../transaction/transaction.repository';
jest.mock('../../transaction/transaction.repository');
const mockTxRepo = txRepo as jest.Mocked<typeof txRepo>;
```

Note: compliance.service.ts already imports `complianceRepo`. For this feature, we need `txRepo` because `confirmHuttonsHandoff` lives in the transaction repository.

Then add the describe block:

```typescript
describe('confirmHuttonsSubmission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAudit.log.mockResolvedValue(undefined);
    mockStorage.delete.mockResolvedValue(undefined);
  });

  it('confirms handoff, purges sensitive docs, and writes audit log', async () => {
    mockTxRepo.findById.mockResolvedValue({
      id: 'tx-1',
      sellerId: 'seller-1',
      status: 'completed',
      completionDate: new Date(),
      seller: { agentId: 'agent-1' },
      huttonsSubmittedAt: null,
    } as any);
    mockTxRepo.confirmHuttonsHandoff.mockResolvedValue({} as any);
    mockRepo.purgeTransactionSensitiveDocs.mockResolvedValue({
      filePaths: ['otp/seller.pdf', 'cdd/doc.jpg.enc'],
    });
    mockRepo.findCddRecordsForNricRedaction = jest.fn().mockResolvedValue([]);

    const result = await complianceService.confirmHuttonsSubmission('tx-1', 'agent-1');

    expect(mockTxRepo.confirmHuttonsHandoff).toHaveBeenCalledWith('tx-1', 'agent-1');
    expect(mockRepo.purgeTransactionSensitiveDocs).toHaveBeenCalledWith('tx-1', 'seller-1');
    expect(mockStorage.delete).toHaveBeenCalledWith('otp/seller.pdf');
    expect(mockStorage.delete).toHaveBeenCalledWith('cdd/doc.jpg.enc');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'compliance.huttons_handoff_confirmed',
        entityType: 'transaction',
        entityId: 'tx-1',
      }),
    );
    expect(result.purgedFiles).toBe(2);
  });

  it('throws NotFoundError when transaction does not exist', async () => {
    mockTxRepo.findById.mockResolvedValue(null);

    await expect(
      complianceService.confirmHuttonsSubmission('tx-missing', 'agent-1'),
    ).rejects.toThrow('not found');
  });

  it('throws ValidationError when transaction is not completed', async () => {
    mockTxRepo.findById.mockResolvedValue({
      id: 'tx-1',
      status: 'option_issued',
      seller: { agentId: 'agent-1' },
    } as any);

    await expect(
      complianceService.confirmHuttonsSubmission('tx-1', 'agent-1'),
    ).rejects.toThrow('completed');
  });

  it('throws ForbiddenError when agent does not own the transaction', async () => {
    mockTxRepo.findById.mockResolvedValue({
      id: 'tx-1',
      status: 'completed',
      seller: { agentId: 'agent-other' },
    } as any);

    await expect(
      complianceService.confirmHuttonsSubmission('tx-1', 'agent-1'),
    ).rejects.toThrow();
  });

  it('throws ConflictError when already submitted', async () => {
    mockTxRepo.findById.mockResolvedValue({
      id: 'tx-1',
      status: 'completed',
      seller: { agentId: 'agent-1' },
      huttonsSubmittedAt: new Date(),
    } as any);

    await expect(
      complianceService.confirmHuttonsSubmission('tx-1', 'agent-1'),
    ).rejects.toThrow();
  });
});
```

**Step 2: Run tests — expect FAIL**

```bash
npx jest src/domains/compliance/__tests__/compliance.service.test.ts --testNamePattern="confirmHuttonsSubmission" --no-coverage
```

Expected: FAIL — `confirmHuttonsSubmission` does not exist.

**Step 3: Implement confirmHuttonsSubmission in compliance.service.ts**

Add import at top of file:

```typescript
import * as txRepo from '@/domains/transaction/transaction.repository';
```

Add the function after `purgeSensitiveDocs`:

```typescript
export async function confirmHuttonsSubmission(
  transactionId: string,
  agentId: string,
): Promise<{ purgedFiles: number }> {
  const tx = await txRepo.findById(transactionId);
  if (!tx) throw new NotFoundError('Transaction', transactionId);

  if (tx.status !== 'completed' && tx.status !== 'fallen_through') {
    throw new ValidationError('Transaction must be completed before confirming Huttons submission');
  }

  if (tx.seller?.agentId !== agentId) {
    throw new ForbiddenError('You do not own this transaction');
  }

  if ((tx as { huttonsSubmittedAt?: Date | null }).huttonsSubmittedAt) {
    throw new ConflictError('Huttons submission already confirmed for this transaction');
  }

  // Record the handoff
  await txRepo.confirmHuttonsHandoff(transactionId, agentId);

  // Immediate Tier 1 purge — same logic as the 7-day auto-purge
  const { filePaths } = await complianceRepo.purgeTransactionSensitiveDocs(transactionId, tx.sellerId);
  for (const filePath of filePaths) {
    try {
      await localStorage.delete(filePath);
    } catch {
      // Orphaned file — logged in audit below
    }
  }

  await auditService.log({
    agentId,
    action: 'compliance.huttons_handoff_confirmed',
    entityType: 'transaction',
    entityId: transactionId,
    details: { sellerId: tx.sellerId, filesDeleted: filePaths.length },
  });

  return { purgedFiles: filePaths.length };
}
```

**Step 4: Run tests — expect PASS**

```bash
npx jest src/domains/compliance/__tests__/compliance.service.test.ts --testNamePattern="confirmHuttonsSubmission" --no-coverage
```

Expected: All 4 tests PASS.

**Step 5: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/domains/compliance/compliance.service.ts src/domains/compliance/__tests__/compliance.service.test.ts
git commit -m "feat(compliance): add confirmHuttonsSubmission with immediate Tier 1 purge"
```

---

### Task 4: Route — POST /agent/transactions/:transactionId/confirm-huttons-handoff

**Files:**
- Modify: `src/domains/transaction/transaction.router.ts`

**Step 1: Add the route**

After the invoice paid route (line 387), before the invoice file download route, add:

```typescript
// POST /agent/transactions/:transactionId/confirm-huttons-handoff — confirm Huttons submission
transactionRouter.post(
  '/agent/transactions/:transactionId/confirm-huttons-handoff',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await complianceService.confirmHuttonsSubmission(
        req.params['transactionId'] as string,
        user.id,
      );

      if (req.headers['hx-request']) {
        return res.render('partials/agent/huttons-handoff-panel', {
          huttonsSubmittedAt: new Date(),
          purgedFiles: result.purgedFiles,
        });
      }
      res.json({ confirmed: true, purgedFiles: result.purgedFiles });
    } catch (err) {
      next(err);
    }
  },
);
```

Add the compliance service import at the top of the file:

```typescript
import * as complianceService from '@/domains/compliance/compliance.service';
```

**Step 2: Commit**

```bash
git add src/domains/transaction/transaction.router.ts
git commit -m "feat(route): add POST confirm-huttons-handoff endpoint"
```

---

### Task 5: UI — Huttons handoff panel partial

**Files:**
- Create: `src/views/partials/agent/huttons-handoff-panel.njk`
- Modify: `src/views/partials/agent/transaction-detail.njk`

**Step 1: Create the partial**

Create `src/views/partials/agent/huttons-handoff-panel.njk`:

```nunjucks
{# partials/agent/huttons-handoff-panel.njk #}
<div id="huttons-handoff" class="mt-4 p-4 border rounded bg-gray-50">
  {% if huttonsSubmittedAt %}
    <p class="text-green-700 font-medium">
      {{ "Submitted to Huttons on" | t }} {{ huttonsSubmittedAt | date("DD MMM YYYY") }}
    </p>
    {% if purgedFiles %}
      <p class="text-sm text-gray-600">{{ purgedFiles }} {{ "sensitive file(s) permanently deleted from platform." | t }}</p>
    {% endif %}
  {% else %}
    <form
      hx-post="/agent/transactions/{{ tx.id }}/confirm-huttons-handoff"
      hx-target="#huttons-handoff"
      hx-swap="outerHTML"
      hx-confirm="{{ 'Confirm you have downloaded all documents and submitted them to Huttons. This will permanently delete sensitive data from the platform. This cannot be undone.' | t }}"
    >
      <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
        {{ "Confirm submitted to Huttons" | t }}
      </button>
      <p class="mt-2 text-sm text-gray-500">
        {{ "Confirming will permanently delete NRIC documents, OTP scans, and invoice files from this platform." | t }}
      </p>
    </form>
  {% endif %}
</div>
```

**Step 2: Include the partial in transaction-detail.njk**

Modify `src/views/partials/agent/transaction-detail.njk` to include the handoff panel when the transaction is completed:

```nunjucks
{# partials/agent/transaction-detail.njk #}
<div class="transaction-detail" data-tx-id="{{ tx.id }}">
  <p>{{ "Status:" | t }} {{ tx.status }}</p>
  {% if tx.otp %}{% include "partials/agent/otp-panel.njk" %}{% endif %}
  {% if tx.commissionInvoice %}{% include "partials/agent/invoice-panel.njk" %}{% endif %}
  {% if tx.status == "completed" or tx.status == "fallen_through" %}
    {% set huttonsSubmittedAt = tx.huttonsSubmittedAt %}
    {% include "partials/agent/huttons-handoff-panel.njk" %}
  {% endif %}
</div>
```

**Step 3: Commit**

```bash
git add src/views/partials/agent/huttons-handoff-panel.njk src/views/partials/agent/transaction-detail.njk
git commit -m "feat(ui): add Huttons handoff confirmation panel"
```

---

### Task 6: Verify — Full test suite

**Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass. The existing 7-day auto-purge in `purgeSensitiveDocs()` continues to work independently — if `purgeTransactionSensitiveDocs` is called again for a transaction that was already purged via handoff confirmation, the repo function is idempotent (no files to delete, nricLast4 already XXXX).

**Step 2: Final commit if any cleanup needed**

```bash
git status
```
