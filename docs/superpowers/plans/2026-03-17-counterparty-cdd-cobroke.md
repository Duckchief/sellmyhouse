# Counterparty CDD Co-Broke Bypass Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the buyer is represented by an agent (co-broke), bypass the Counterparty CDD gate and show a greyed-out "not required" UI state with the buyer's agent details.

**Architecture:** Three-layer change — (1) data: surface offer co-broke fields through the compliance data fetch in `agent.repository.ts`; (2) gate: short-circuit Gate 3 in `review.service.ts` when `buyerRepresented` context is passed, and pass that context from `transaction.service.ts` after fetching the offer; (3) UI: add a co-broke branch to the counterparty CDD card template.

**Tech Stack:** TypeScript, Prisma, Nunjucks, Jest

---

## Chunk 1: Types + data layer

### Task 1: Update `SellerComplianceData` type and repository data fetch

**Files:**
- Modify: `src/domains/agent/agent.types.ts` (lines ~142–146)
- Modify: `src/domains/agent/agent.repository.ts` (lines ~288–325)
- Modify: `src/domains/agent/__tests__/agent.service.test.ts` (lines ~213–241)

**Background for implementer:**
- `getComplianceStatus()` in `agent.repository.ts` fetches compliance data for the seller detail page.
- It already fetches `activeTransaction` (the current in-progress transaction) with `select: { id: true }`.
- `counterpartyCdd` is built from that transaction. We need to also fetch the offer's co-broke fields from it.
- The Transaction model has `offer Offer?` relation (via `offerId` FK). Prisma lets us select nested fields.
- `agent.types.ts` defines `SellerComplianceData` — the return type of `getComplianceStatus`. It must match the new fields.

- [ ] **Step 1: Write the failing test**

  In `src/domains/agent/__tests__/agent.service.test.ts`, find the `getComplianceStatus` describe block (~line 213). Add a new test after the existing one:

  ```ts
  it('passes co-broke fields through when counterpartyCdd is present', async () => {
    mockRepo.getComplianceStatus.mockResolvedValue({
      cdd: {
        status: 'verified',
        verifiedAt: new Date(),
        riskLevel: 'standard',
        fullName: 'Test',
        nricLast4: '567A',
      },
      eaa: {
        status: 'not_started',
        id: null,
        signedAt: null,
        signedCopyPath: null,
        expiryDate: null,
        explanationConfirmedAt: null,
        explanationMethod: null,
      },
      consent: { service: true, marketing: false, withdrawnAt: null },
      caseFlags: [],
      counterpartyCdd: {
        status: 'not_started',
        verifiedAt: null,
        transactionId: 'tx-1',
        isCoBroke: true,
        buyerAgentName: 'John Agent',
        buyerAgentCeaReg: 'R012345B',
      },
    } as never);

    const result = await agentService.getComplianceStatus('seller-1');

    expect(result.counterpartyCdd?.isCoBroke).toBe(true);
    expect(result.counterpartyCdd?.buyerAgentName).toBe('John Agent');
    expect(result.counterpartyCdd?.buyerAgentCeaReg).toBe('R012345B');
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx jest src/domains/agent/__tests__/agent.service.test.ts --testNamePattern="passes co-broke fields" -t "passes co-broke"
  ```

  Expected: FAIL — TypeScript type error on `counterpartyCdd` shape (missing fields).

- [ ] **Step 3: Update `agent.types.ts` — add three fields to `counterpartyCdd`**

  In `src/domains/agent/agent.types.ts`, find the `counterpartyCdd` type (~line 142). Replace:

  ```ts
  counterpartyCdd: {
    status: 'verified' | 'not_started';
    verifiedAt: Date | null;
    transactionId: string | null;
  } | null;
  ```

  With:

  ```ts
  counterpartyCdd: {
    status: 'verified' | 'not_started';
    verifiedAt: Date | null;
    transactionId: string | null;
    isCoBroke: boolean;
    buyerAgentName: string | null;
    buyerAgentCeaReg: string | null;
  } | null;
  ```

- [ ] **Step 4: Update `agent.repository.ts` — extend transaction select and populate new fields**

  In `src/domains/agent/agent.repository.ts`, find the `prisma.transaction.findFirst` call (~line 288). Change the `select`:

  ```ts
  prisma.transaction.findFirst({
    where: { sellerId, status: { notIn: ['completed', 'fallen_through'] } },
    select: {
      id: true,
      offer: { select: { isCoBroke: true, buyerAgentName: true, buyerAgentCeaReg: true } },
    },
    orderBy: { createdAt: 'desc' },
  }),
  ```

  Then in the `if (activeTransaction)` block (~line 313), update the `counterpartyCdd` assignment to include the new fields:

  ```ts
  counterpartyCdd = {
    status: counterpartyCddRecord?.identityVerified
      ? ('verified' as const)
      : ('not_started' as const),
    verifiedAt: counterpartyCddRecord?.verifiedAt ?? null,
    transactionId: activeTransaction.id,
    isCoBroke: activeTransaction.offer?.isCoBroke ?? false,
    buyerAgentName: activeTransaction.offer?.buyerAgentName ?? null,
    buyerAgentCeaReg: activeTransaction.offer?.buyerAgentCeaReg ?? null,
  };
  ```

  Also update the inline type annotation for `counterpartyCdd` (the `let counterpartyCdd: { ... } | null` declaration ~line 307) to match the new shape in `agent.types.ts`:

  ```ts
  let counterpartyCdd: {
    status: 'verified' | 'not_started';
    verifiedAt: Date | null;
    transactionId: string | null;
    isCoBroke: boolean;
    buyerAgentName: string | null;
    buyerAgentCeaReg: string | null;
  } | null = null;
  ```

- [ ] **Step 5: Run the tests**

  ```bash
  npx jest src/domains/agent/__tests__/agent.service.test.ts
  ```

  Expected: all tests pass including the new one.

- [ ] **Step 6: Commit**

  ```bash
  git add src/domains/agent/agent.types.ts src/domains/agent/agent.repository.ts src/domains/agent/__tests__/agent.service.test.ts
  git commit -m "feat: add co-broke fields to counterpartyCdd compliance data"
  ```

---

## Chunk 2: Compliance gate bypass

### Task 2: Short-circuit Gate 3 when buyer is represented

**Files:**
- Modify: `src/domains/review/review.service.ts` (lines ~84–96)
- Modify: `src/domains/review/__tests__/review.service.test.ts` (~line 115)
- Modify: `src/domains/transaction/transaction.service.ts` (~line 123–125)
- Modify: `src/domains/transaction/__tests__/transaction.service.test.ts` (multiple locations)

**Background for implementer:**
- `checkComplianceGate` in `review.service.ts` already has a `_context?: { buyerRepresented?: boolean }` third parameter (line ~51) that is currently unused in the `counterparty_cdd` case.
- `transaction.service.ts` calls this gate at line ~125 without context. We need to fetch the offer first and pass co-broke status.
- `offerService` is already imported in `transaction.service.ts` (line 19) as `import * as offerService from '@/domains/offer/offer.service'`. Use `offerService.findOffer(tx.offerId)` to fetch the offer.
- `tx` (from `txRepo.findById`) includes `offerId` as a direct field (it is a column on the transaction table). It may be `null` if no offer was accepted yet — default to `false` in that case.
- Existing tests in `transaction.service.test.ts` assert the gate was called with 2 args. They must be updated to expect 3 args.

**Part A — `review.service.ts`:**

- [ ] **Step 1: Write failing tests for the co-broke bypass in `review.service.test.ts`**

  Find the `describe('checkComplianceGate - counterparty_cdd', ...)` block (~line 115). Add two new tests after the existing three:

  ```ts
  it('passes (bypasses CDD check) when buyerRepresented context is true', async () => {
    // Should not call findCddRecordByTransactionAndSubjectType at all
    await expect(
      checkComplianceGate('counterparty_cdd', 'tx-1', { buyerRepresented: true }),
    ).resolves.toBeUndefined();
    expect(mockComplianceService.findCddRecordByTransactionAndSubjectType).not.toHaveBeenCalled();
  });

  it('still requires CDD when buyerRepresented is false', async () => {
    mockComplianceService.findCddRecordByTransactionAndSubjectType.mockResolvedValue(null);
    await expect(
      checkComplianceGate('counterparty_cdd', 'tx-1', { buyerRepresented: false }),
    ).rejects.toThrow(ComplianceError);
  });
  ```

- [ ] **Step 2: Run to verify new tests fail**

  ```bash
  npx jest src/domains/review/__tests__/review.service.test.ts --testNamePattern="buyerRepresented"
  ```

  Expected: FAIL — gate does not yet short-circuit.

- [ ] **Step 3: Implement the short-circuit in `review.service.ts`**

  Find the `case 'counterparty_cdd':` block (~line 84). Add the early return at the very top of the case, before the existing CDD record lookup. Also update the comment to reflect the new behaviour:

  ```ts
  case 'counterparty_cdd': {
    // entityId = transactionId.
    // Co-broke transactions bypass this gate — the buyer's agent is responsible for their client's CDD.
    if (_context?.buyerRepresented) return;
    const cddRecord = await complianceService.findCddRecordByTransactionAndSubjectType(
      entityId,
      'counterparty',
    );
    if (!cddRecord || !cddRecord.verifiedAt) {
      throw new ComplianceError('Gate 3: Counterparty CDD must be completed before proceeding');
    }
    return;
  }
  ```

- [ ] **Step 4: Run review.service tests**

  ```bash
  npx jest src/domains/review/__tests__/review.service.test.ts
  ```

  Expected: all tests pass.

**Part B — `transaction.service.ts`:**

- [ ] **Step 5: Write failing tests for the new gate call signature**

  In `src/domains/transaction/__tests__/transaction.service.test.ts`, find `makeTransaction` (~line 48) and add `offerId: 'offer-1'` to its default fields:

  ```ts
  function makeTransaction(overrides: Record<string, unknown> = {}) {
    return {
      id: 'tx-1',
      propertyId: 'property-1',
      sellerId: 'seller-1',
      offerId: 'offer-1',
      agreedPrice: '600000',
      status: 'option_issued' as const,
      hdbApplicationStatus: 'not_started' as const,
      completionDate: null,
      exerciseDeadline: null,
      otp: null,
      commissionInvoice: null,
      ...overrides,
    };
  }
  ```

  In `beforeEach` (~line 95), update the `mockOfferService.findOffer` default to include `isCoBroke: false`:

  ```ts
  mockOfferService.findOffer.mockResolvedValue({
    id: 'offer-1',
    propertyId: 'property-1',
    status: 'accepted',
    isCoBroke: false,
  } as never);
  ```

  Now find **all** existing assertions of the form:
  ```ts
  expect(mockReviewService.checkComplianceGate).toHaveBeenCalledWith('counterparty_cdd', 'tx-1');
  ```
  and update each to include the third argument:
  ```ts
  expect(mockReviewService.checkComplianceGate).toHaveBeenCalledWith('counterparty_cdd', 'tx-1', { buyerRepresented: false });
  ```

  There are exactly **2** `toHaveBeenCalledWith` assertions to update (search for `'counterparty_cdd', 'tx-1'` — skip any occurrences that are in comments).

  Then add a new test for the co-broke bypass scenario in the `advanceTransactionStatus` describe block:

  ```ts
  it('passes buyerRepresented: true to Gate 3 when offer is co-broke', async () => {
    const tx = makeTransaction({ status: 'option_issued' });
    mockTxRepo.findById.mockResolvedValue(tx as never);
    mockOfferService.findOffer.mockResolvedValue({
      id: 'offer-1',
      status: 'accepted',
      isCoBroke: true,
      buyerAgentName: 'John Agent',
      buyerAgentCeaReg: 'R012345B',
    } as never);
    mockTxRepo.updateTransactionStatus.mockResolvedValue({
      ...tx,
      status: 'option_exercised',
    } as never);

    await txService.advanceTransactionStatus({
      transactionId: 'tx-1',
      status: 'option_exercised',
      agentId: 'agent-1',
    });

    expect(mockReviewService.checkComplianceGate).toHaveBeenCalledWith(
      'counterparty_cdd',
      'tx-1',
      { buyerRepresented: true },
    );
  });

  it('passes buyerRepresented: false when tx has no offerId', async () => {
    const tx = makeTransaction({ status: 'option_issued', offerId: null });
    mockTxRepo.findById.mockResolvedValue(tx as never);
    mockTxRepo.updateTransactionStatus.mockResolvedValue({
      ...tx,
      status: 'option_exercised',
    } as never);

    await txService.advanceTransactionStatus({
      transactionId: 'tx-1',
      status: 'option_exercised',
      agentId: 'agent-1',
    });

    expect(mockReviewService.checkComplianceGate).toHaveBeenCalledWith(
      'counterparty_cdd',
      'tx-1',
      { buyerRepresented: false },
    );
  });
  ```

- [ ] **Step 6: Run to verify new and updated tests fail**

  ```bash
  npx jest src/domains/transaction/__tests__/transaction.service.test.ts --testNamePattern="Gate 3|co-broke|buyerRepresented"
  ```

  Expected: FAIL — gate call doesn't pass context yet.

- [ ] **Step 7: Implement the offer fetch + context pass in `transaction.service.ts`**

  Find the Gate 3 comment and call (~lines 123–125). Replace:

  ```ts
  // H3: Gate 3 — counterparty CDD must be complete before any status advance
  // Passes transaction.id as entityId; checkComplianceGate uses it as the CDD subject lookup key
  await checkComplianceGate('counterparty_cdd', tx.id);
  ```

  With:

  ```ts
  // H3: Gate 3 — counterparty CDD (bypassed for co-broke transactions)
  const offer = tx.offerId ? await offerService.findOffer(tx.offerId) : null;
  await checkComplianceGate('counterparty_cdd', tx.id, {
    buyerRepresented: offer?.isCoBroke ?? false,
  });
  ```

- [ ] **Step 8: Run all transaction.service tests**

  ```bash
  npx jest src/domains/transaction/__tests__/transaction.service.test.ts
  ```

  Expected: all tests pass.

- [ ] **Step 9: Run full test suite**

  ```bash
  npm test
  ```

  Expected: same pass count as before (no new failures).

- [ ] **Step 10: Commit**

  ```bash
  git add src/domains/review/review.service.ts src/domains/review/__tests__/review.service.test.ts src/domains/transaction/transaction.service.ts src/domains/transaction/__tests__/transaction.service.test.ts
  git commit -m "feat: bypass counterparty CDD gate for co-broke transactions"
  ```

---

## Chunk 3: UI

### Task 3: Add co-broke state to counterparty CDD card

**Files:**
- Modify: `src/views/partials/agent/compliance-counterparty-cdd-card.njk`

**Background for implementer:**
- The template receives `compliance.counterpartyCdd` which now has `isCoBroke`, `buyerAgentName`, `buyerAgentCeaReg`.
- When `isCoBroke` is true, show a greyed-out info state instead of the existing CDD form/badge.
- When `isCoBroke` is false (or null), render exactly as today — do not change any existing logic.
- Use the `{{ "..." | t }}` i18n filter on all user-facing strings (project requirement from CLAUDE.md).

- [ ] **Step 1: Update the template**

  Open `src/views/partials/agent/compliance-counterparty-cdd-card.njk`. Wrap all existing content in an `{% else %}` branch and add the co-broke branch at the top, so the file becomes:

  Replace the entire file content with:

  ```njk
  {% if compliance.counterpartyCdd.isCoBroke %}
  <div class="space-y-3">
    <p class="text-sm text-gray-500 italic">
      {{ "Not required — counterparty is represented by an agent." | t }}
    </p>
    {% if compliance.counterpartyCdd.buyerAgentName or compliance.counterpartyCdd.buyerAgentCeaReg %}
    <dl class="space-y-2 text-sm">
      {% if compliance.counterpartyCdd.buyerAgentName %}
      <div class="flex justify-between">
        <dt class="text-gray-500">{{ "Agent Name" | t }}</dt>
        <dd class="text-gray-700">{{ compliance.counterpartyCdd.buyerAgentName }}</dd>
      </div>
      {% endif %}
      {% if compliance.counterpartyCdd.buyerAgentCeaReg %}
      <div class="flex justify-between">
        <dt class="text-gray-500">{{ "CEA Reg No" | t }}</dt>
        <dd class="text-gray-700">{{ compliance.counterpartyCdd.buyerAgentCeaReg }}</dd>
      </div>
      {% endif %}
    </dl>
    {% endif %}
  </div>
  {% else %}
  <div id="compliance-counterparty-cdd-card">
    <div class="flex items-center justify-between mb-4">
      <span class="px-2 py-1 text-xs rounded-full
        {% if compliance.counterpartyCdd.status == 'verified' %}bg-green-100 text-green-800
        {% else %}bg-gray-100 text-gray-800{% endif %}">{{ compliance.counterpartyCdd.status | t }}</span>
    </div>

    {% if compliance.counterpartyCdd.status == 'not_started' %}
      <p class="text-sm text-gray-500 mb-4">{{ "No counterparty CDD record for this transaction." | t }}</p>
      <button
        type="button"
        hx-get="/agent/transactions/{{ compliance.counterpartyCdd.transactionId }}/counterparty-cdd/modal"
        hx-target="#compliance-modal-container"
        hx-swap="innerHTML"
        class="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">
        {{ "Create Counterparty CDD" | t }}
      </button>
    {% else %}
      <dl class="space-y-2 text-sm">
        {% if compliance.counterpartyCdd.verifiedAt %}
        <div class="flex justify-between">
          <dt class="text-gray-500">{{ "Verified" | t }}</dt>
          <dd>{{ compliance.counterpartyCdd.verifiedAt | date }}</dd>
        </div>
        {% endif %}
      </dl>
    {% endif %}
  </div>
  {% endif %}
  ```

- [ ] **Step 2: Run tests**

  ```bash
  npm test
  ```

  Expected: all tests pass (template changes have no unit test coverage — verified visually).

- [ ] **Step 3: Commit**

  ```bash
  git add src/views/partials/agent/compliance-counterparty-cdd-card.njk
  git commit -m "feat: show co-broke agent details on counterparty CDD card"
  ```
