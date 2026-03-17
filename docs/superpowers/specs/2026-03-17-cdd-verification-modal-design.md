# CDD Verification Confirmation Modal

**Date:** 2026-03-17
**Status:** Approved

## Goal

When an agent sets a seller's CDD status to "Verified", intercept the action with a confirmation modal requiring the agent to type "I confirm". Once confirmed, the CDD record is locked — agents cannot change it. Admins can revert.

## Interaction Flow

1. Agent opens the CDD card on `/agent/sellers/:id`, sees the status `<select>` (Not Started / Pending / Verified)
2. Agent selects "Verified"
3. Instead of immediately PATCHing, the select triggers `GET /agent/sellers/:id/cdd/verify-modal` → confirmation modal rendered into `#compliance-modal-container`
4. Modal: message, text input, disabled Confirm button
5. Client-side JS enables Confirm button only when input equals `"I confirm"` (exact, case-sensitive)
6. Agent clicks Confirm → modal POSTs to `POST /agent/sellers/:id/cdd/verify`
7. Server validates phrase, writes `identityVerified = true`, `verifiedAt = now`, status = `verified`, returns refreshed CDD card
8. Re-rendered card:
   - **Agent view:** select replaced with locked green "Verified ✓" badge + `verifiedAt` date + *"Locked — contact admin to revert"*
   - **Admin view:** select remains, all three options available (no modal required)

## API

No schema changes — `identityVerified` and `verifiedAt` already exist on `CddRecord`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/agent/sellers/:sellerId/cdd/verify-modal` | Returns confirmation modal partial |
| `POST` | `/agent/sellers/:sellerId/cdd/verify` | Validates phrase, writes verified status, returns refreshed card |

### POST `/agent/sellers/:sellerId/cdd/verify` validations

- `phrase === 'I confirm'` — `400 ValidationError` if wrong (defence against direct API calls)
- `identityVerified !== true` — `409 ConflictError` if already locked
- Agent auth via existing `agentAuth` middleware

### PATCH `/agent/sellers/:sellerId/cdd/status` changes

- Transitions to `verified` blocked for agents → `403 ForbiddenError`
- Transitions to `not_started` / `pending` blocked if `identityVerified === true` and caller is agent → `403 ForbiddenError`
- Admin callers bypass the lock entirely (existing select behaviour preserved)

## UI Components

### `compliance-cdd-card.njk`

- When `identityVerified === false` (agent view): select fires `hx-get` to verify-modal when value is `verified`; fires existing `hx-patch` for `not_started` / `pending`
- When `identityVerified === true` (agent view): select removed; replaced with green "Verified ✓" badge, `verifiedAt` date, lock note
- When `identityVerified === true` (admin view): select remains with all options

### `partials/agent/cdd-verify-modal.njk` (new)

- Title: *"Confirm CDD Completion"*
- Body: *"You are about to mark this seller's CDD as Verified. This action cannot be undone by you. Type **I confirm** below to proceed."*
- `<input type="text" id="cdd-confirm-phrase">`
- Confirm button: disabled until input equals `"I confirm"` (inline JS, CSP nonce-gated)
- Cancel button: clears `#compliance-modal-container`
- On confirm: `hx-post` to verify endpoint, `hx-target="#compliance-cdd-card"`, `hx-swap="outerHTML"`

## Service Layer

### New: `verifyCdd(sellerId, agentId, phrase)`

- Throws `ValidationError` if phrase ≠ `'I confirm'`
- Throws `ConflictError` if record already `identityVerified`
- Calls `complianceRepo.upsertCddStatus(sellerId, agentId, 'verified')`
- Logs `cdd.identity_verified` audit entry

### Modified: `updateCddStatus(sellerId, status, agentId, isAdmin)`

- If `status === 'verified'` and caller is not admin → `ForbiddenError` (must use `verifyCdd`)
- If current record has `identityVerified === true` and caller is not admin → `ForbiddenError`

## Testing

### Service (`compliance.service.test.ts`)

- `verifyCdd` sets `identityVerified`, `verifiedAt`, logs audit entry
- `verifyCdd` throws `ValidationError` for wrong phrase
- `verifyCdd` throws `ConflictError` if already verified
- `updateCddStatus` blocks `verified` transition for agent → `ForbiddenError`
- `updateCddStatus` blocks any transition when `identityVerified` and caller is agent → `ForbiddenError`
- `updateCddStatus` allows admin to revert regardless of `identityVerified`

### Router (`compliance.router.test.ts`)

- `GET /agent/sellers/:id/cdd/verify-modal` → 200, returns modal partial
- `POST /agent/sellers/:id/cdd/verify` correct phrase → 200, refreshed card
- `POST /agent/sellers/:id/cdd/verify` wrong phrase → 400
- `POST /agent/sellers/:id/cdd/verify` already verified → 409
- `PATCH /agent/sellers/:id/cdd/status` to `verified` by agent → 403
- `PATCH /agent/sellers/:id/cdd/status` to `not_started` when locked by agent → 403
- `PATCH /agent/sellers/:id/cdd/status` any value by admin → 200
