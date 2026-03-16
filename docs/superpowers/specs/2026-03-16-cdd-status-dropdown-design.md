# CDD Status Dropdown — Design Spec
**Date:** 2026-03-16
**Status:** Approved

## Context

The platform previously captured seller CDD data (name, NRIC last 4, DOB, etc.) via a modal form. This was incorrect — the actual CDD records and mandatory 5-year AML/CFT retention are managed in Huttons' external Estate Agent CDD system. The platform's only responsibility is to track the compliance gate status so the transaction pipeline can be gated correctly.

## Goal

Replace the CDD modal and creation flow with a simple inline status dropdown. The agent physically verifies identity in Huttons' CDD system, then reflects the status here. Remove all data-capture UI.

## Data Model

`CddRecord` is retained as a thin status marker. Fields like `fullName`, `nricLast4` etc. are set to stub placeholder values to satisfy schema constraints — the real data lives externally.

| Agent selects | Backend action | `identityVerified` | `verifiedAt` |
|---|---|---|---|
| `not_started` | Hard-delete existing CDD record (if any) | — | — |
| `pending` | Upsert stub record | `false` | `null` |
| `verified` | Upsert stub record | `true` | `now()` |

Hard-delete on `not_started` is safe: the external system holds the canonical data and satisfies the 5-year retention obligation. No PDPA complication.

`getComplianceStatus` in `agent.repository.ts` already derives the three-state label from these fields — no change needed there.

## API

### New endpoint
```
PATCH /agent/sellers/:sellerId/cdd/status
Auth: agentAuth (requires 2FA)
Body: { status: 'not_started' | 'pending' | 'verified' }
Response: re-renders partials/agent/compliance-cdd-card (HTMX swap)
```

**Logic:**
- `not_started` — find latest CDD record for seller, hard-delete it. No-op if none exists.
- `pending` — if record exists and already pending, no-op. Otherwise upsert stub (`identityVerified: false`, `verifiedAt: null`).
- `verified` — upsert stub (`identityVerified: true`, `verifiedAt: now()`). If already verified, no-op.

Upsert = update existing record in-place if one exists, create if not. Avoids accumulating orphan records.

### Removed endpoints
- `POST /agent/sellers/:sellerId/cdd` — deleted
- `GET /agent/sellers/:sellerId/cdd/modal` — deleted

### Audit events
| Action | Audit log event |
|---|---|
| `not_started` | `cdd.record_deleted` |
| `pending` | `cdd.status_set_pending` |
| `verified` | `cdd.identity_verified` |

## UI

### compliance-cdd-card.njk (rewritten)

```
┌─────────────────────────────────────┐
│ CDD Status                          │
│                                     │
│ Status  [ Not Started ▼ ]           │
│                                     │
│ (when pending):                     │
│ ⚠ CDD must be Verified in Huttons'  │
│   system before proceeding to EAA.  │
│                                     │
│ (when verified):                    │
│ Verified    14/03/2026              │
└─────────────────────────────────────┘
```

- `<select>` with HTMX `hx-patch` on `change` event — immediate save, no submit button
- Loading indicator on dropdown during request
- `pending` state shows a guidance note explaining verification is required to proceed
- `verified` state shows `verifiedAt` date as confirmation

### Removed
- `cdd-modal.njk` — deleted
- `#compliance-modal-container` div in `seller-detail.njk` — removed if no other card uses it (check EAA card)

## Compliance Gate Behaviour

Gate 1 (`checkComplianceGate('seller_cdd', sellerId)`) checks `identityVerified = true`. This is unchanged:

| CDD status | `identityVerified` | Gate 1 | Can proceed to EAA → Gate 3 |
|---|---|---|---|
| `not_started` | no record | blocked | no |
| `pending` | `false` | blocked | no |
| `verified` | `true` | passes | yes |

Only `verified` unlocks the transaction pipeline. `pending` is intentionally a meaningful intermediate state.

## Files Affected

| File | Change |
|---|---|
| `src/domains/compliance/compliance.router.ts` | Remove POST cdd + GET modal; add PATCH cdd/status |
| `src/domains/compliance/compliance.repository.ts` | Add `upsertCddStatusRecord`, `deleteCddRecord` |
| `src/domains/compliance/compliance.service.ts` | Add `updateCddStatus` wrapper |
| `src/domains/compliance/compliance.types.ts` | Add `UpdateCddStatusInput` type |
| `src/views/partials/agent/compliance-cdd-card.njk` | Rewrite with dropdown |
| `src/views/partials/agent/cdd-modal.njk` | Delete |
| `src/views/pages/agent/seller-detail.njk` | Remove modal container if unused |
| Tests | Update/add for new endpoint; remove modal tests |
