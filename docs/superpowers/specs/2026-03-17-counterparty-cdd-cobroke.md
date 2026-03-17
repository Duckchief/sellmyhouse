# Spec: Counterparty CDD — Co-Broke Bypass

**Date:** 2026-03-17

## Background

Counterparty CDD is only required when the buyer is unrepresented. If the buyer has their own agent (co-broke transaction), we do not need to perform Counterparty CDD — the buyer's agent is responsible for their own client's due diligence.

The `Offer` model already captures this: `isCoBroke` (bool, auto-set when `buyerAgentName` is provided), `buyerAgentName` (string | null), `buyerAgentCeaReg` (string | null). The active transaction links to its accepted offer via `offerId`.

## What Changes

### 1. Data layer — `agent.repository.ts` + `agent.types.ts`

**Purpose:** surface co-broke details to the seller detail page UI.

In `agent.repository.ts`, when the active transaction is found, extend the `select` to include offer co-broke fields:

```ts
prisma.transaction.findFirst({
  where: { sellerId, status: { notIn: ['completed', 'fallen_through'] } },
  select: {
    id: true,
    offer: { select: { isCoBroke: true, buyerAgentName: true, buyerAgentCeaReg: true } },
  },
  orderBy: { createdAt: 'desc' },
})
```

Populate the `counterpartyCdd` object with these additional fields (when `activeTransaction` is non-null):

```ts
counterpartyCdd = {
  status: ...,                          // unchanged
  verifiedAt: ...,                      // unchanged
  transactionId: activeTransaction.id,  // unchanged
  isCoBroke: activeTransaction.offer?.isCoBroke ?? false,
  buyerAgentName: activeTransaction.offer?.buyerAgentName ?? null,
  buyerAgentCeaReg: activeTransaction.offer?.buyerAgentCeaReg ?? null,
};
```

In `agent.types.ts`, add three fields to the `counterpartyCdd` shape (top-level, same level as `status`/`verifiedAt`/`transactionId`):

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

### 2. Compliance gate — `transaction.service.ts` + `review.service.ts`

**Purpose:** bypass Gate 3 when buyer is co-broke. These are two independent changes to two files.

**`transaction.service.ts`** — in `advanceTransactionStatus`, before the Gate 3 call at line ~125, fetch the accepted offer and pass co-broke status as context:

```ts
// Gate 3 — counterparty CDD (bypassed for co-broke transactions)
const offer = tx.offerId ? await offerRepo.findById(tx.offerId) : null;
await checkComplianceGate('counterparty_cdd', tx.id, {
  buyerRepresented: offer?.isCoBroke ?? false,
});
```

If `tx.offerId` is null (no accepted offer yet), defaults to `false` — CDD remains required.

`offerRepo` is the existing `offer.repository` import pattern used elsewhere in the service. Check current imports in `transaction.service.ts` to confirm the correct import alias.

**`review.service.ts`** — in the `counterparty_cdd` gate case (lines ~84-96), add short-circuit at the very top of the case:

```ts
case 'counterparty_cdd': {
  if (_context?.buyerRepresented) return; // co-broke: buyer's agent handles their client's CDD
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

### 3. UI — `compliance-counterparty-cdd-card.njk`

Add a co-broke branch at the very top, before the existing `<div id="compliance-counterparty-cdd-card">` content:

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
  {# existing card content unchanged #}
{% endif %}
```

When `isCoBroke` is false: card renders exactly as today.

## Files Affected

| File | Change |
|------|--------|
| `src/domains/agent/agent.repository.ts` | Extend transaction select to include offer co-broke fields; populate `counterpartyCdd` |
| `src/domains/agent/agent.types.ts` | Add `isCoBroke`, `buyerAgentName`, `buyerAgentCeaReg` to `counterpartyCdd` shape |
| `src/domains/transaction/transaction.service.ts` | Fetch offer before Gate 3; pass `buyerRepresented` context |
| `src/domains/review/review.service.ts` | Short-circuit `counterparty_cdd` gate when `buyerRepresented` is true |
| `src/views/partials/agent/compliance-counterparty-cdd-card.njk` | Add co-broke UI state |

## What Does NOT Change

- No database migrations
- No new fields on Transaction or Offer
- Offer creation and `isCoBroke` derivation logic unchanged
- All other compliance gates unchanged
- Existing counterparty CDD flow (non-co-broke) unchanged
- The N+1 concern does not apply: this compliance data is only fetched on the seller detail page (single seller), not in list views
