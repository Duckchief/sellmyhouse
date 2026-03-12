# Phase 5: PDPA Compliance Module — Design Spec

**Date:** 2026-03-12
**Status:** Approved
**Branch:** feat/phase-5-pdpa-compliance

## Overview

Phase 5 builds the PDPA compliance module for SellMyHomeNow.sg v2. It covers consent management, data access and correction, data retention and hard deletion, NRIC handling, DNC registry compliance, and secure download and server deletion of sensitive documents.

All Phase 5 logic lives in a dedicated `src/domains/compliance/` domain. The compliance domain owns all PDPA workflows and is called by other domains — it does not call back into them except through the repository layer for hard deletes that cascade from the seller entity.

## Domain Structure

```
src/domains/compliance/
├── compliance.types.ts        # Enums, interfaces for all compliance entities
├── compliance.service.ts      # Business logic: consent, retention, DNC, anonymisation
├── compliance.repository.ts   # DB: ConsentRecord, DataDeletionRequest, DataCorrectionRequest
├── compliance.router.ts       # Routes: seller "My Data", agent/admin deletion queue
├── compliance.validator.ts    # Input validation for withdrawal, correction, deletion
├── compliance.service.test.ts # Unit tests (mock repository)
└── compliance.router.test.ts  # Route-level tests
```

**Shared utilities:**
- `src/domains/shared/nric.ts` — NRIC masking and last-4 validation (new, cross-domain utility)
- `src/domains/shared/encryption.ts` — AES-256-GCM encrypt/decrypt (already exists)
- `src/infra/jobs/retention.job.ts` — weekly cron job (new, calls compliance service)

**Cross-domain calls:**
- `notification.service` → calls `compliance.service.checkDncAllowed()` before any outbound WhatsApp/phone
- `compliance.service` → calls `seller.service.hardDelete(sellerId)` for cascading hard deletes on the seller entity (never calls seller.repository directly — cross-domain rule)
- `compliance.service` → calls `audit.service` to log all compliance actions
- `admin.service` → calls `compliance.service.anonymiseAgent()` on agent departure

## SP1: Consent Management

### Consent withdrawal flow

1. Seller submits withdrawal (marketing or service) from the "My Data" page
2. `compliance.service.withdrawConsent(sellerId, type, channel, ipAddress)`:
   - Creates a new `ConsentRecord` with `consentWithdrawnAt` set — append-only, never updates existing records
   - Updates `Seller.consentMarketing` or `Seller.consentService` flag for fast runtime checks
   - **Marketing withdrawal:** stops future marketing notifications (DNC gate blocks outbound from this point)
   - **Service withdrawal + no active transaction:** creates `DataDeletionRequest` with `status: flagged`, `retentionRule: "30_day_grace"` — admin reviews within 30 days
   - **Service withdrawal + active or completed transaction:** creates `DataDeletionRequest` with `status: blocked`, `retentionRule: "aml_cft_5_year"` — deletion blocked until 5 years post-transaction completion
3. Audit log entry: `consent.withdrawn` with `{ sellerId, type, channel }`

### DNC gate

`compliance.service.checkDncAllowed(sellerId, channel, messageType)` returns `{ allowed: boolean; reason?: string }`.

```typescript
type DncChannel = 'whatsapp' | 'phone' | 'email';
type MessageType = 'service' | 'marketing';
```

Rules:
- `messageType: 'marketing'` on any channel: blocked if `Seller.consentMarketing === false`
- `messageType: 'service'` on any channel: blocked if `Seller.consentService === false` (seller has opted out entirely)
- `messageType: 'service'` with `consentService === true`: always allowed regardless of marketing consent
- Service messages include: OTP reminders, appointment confirmations, compliance notices, transaction status updates
- Marketing messages include: new listing promotions, referral solicitations, market reports

The `notification.service` passes both `channel` and `messageType` when calling this gate. If blocked, the notification is saved to the `Notification` table with `status: blocked` and the reason.

**TODO:** Integrate real Singapore DNC registry API when paid registration is complete. Current implementation gates on consent flags as a conservative proxy.

## SP2: Seller "My Data" Page

**Route:** `GET /seller/my-data`

Sections:
1. **Personal data held** — name, email, phone, masked NRIC last-4 (if CDD record exists), consent status and dates
2. **Consent management** — current service/marketing consent state with withdrawal buttons
3. **Data correction requests** — form to request correction of any personal data field + history of past requests with status
4. **Account deletion** — "Request account deletion" link triggers service consent withdrawal flow
5. **Download my data** — generates JSON export of the seller's own data. Included: name, email, phone, masked NRIC last-4, consent records (purpose, dates), data correction requests (field, requested value, status, dates), viewing history (date, status — no buyer personal data), property details (address, asking price, status). Excluded: full NRIC, encrypted documents, other sellers' data, audit log entries.

### Data correction flow

1. Seller submits: `{ fieldName, currentValue, requestedValue, reason }`
2. Creates `DataCorrectionRequest` with `status: pending`
3. Agent assigned to the seller is notified (in-app + email): "Seller [name] has requested a correction to their [fieldName]"
4. Agent reviews in their dashboard → approves or rejects (with reason)
   - **Auto-apply fields** (agent approves → system writes the new value automatically): `name`, `email`, `phone`, `notificationPreference`
   - **Manual-apply fields** (agent approves → agent applies the change outside the system, then marks processed): `nricLast4` (requires re-verification and new CDD record), any field requiring identity re-check
   - The `DataCorrectionRequest` record stores the `requestedValue` as a string; the agent decides whether to apply it directly or handle it manually
5. All actions audit-logged: `data_correction.requested`, `data_correction.processed`, `data_correction.rejected`
6. 30-day SLA: retention scanner flags correction requests unprocessed after 30 days for admin review

## SP3: Data Retention & Deletion

### Retention scanning cron job

`src/infra/jobs/retention.job.ts` runs weekly (Saturday midnight SGT, schedule from SystemSetting `retention_schedule`). Calls `compliance.service.scanRetention()`.

**What the scanner flags:**

| Entity | Condition | Action |
|--------|-----------|--------|
| Lead/Seller (no transaction) | No contact > 12 months | Flag for deletion |
| Seller with service consent withdrawn | > 30 days since withdrawal, no transaction | Flag for deletion |
| Transaction records | > 5 years post-completion | Flag for deletion (admin must approve) |
| CDD documents | > 5 years after end of business relationship | Flag file deletion |
| Consent records | Withdrawn > 1 year ago | Flag for deletion (see note below) |
| DataCorrectionRequest | Unprocessed > 30 days | Flag for agent attention (not deletion) |

**Note on consent record deletion:** Consent records are append-only while active (CLAUDE.md rule). Hard deleting them after 1 year post-withdrawal is intentional and PDPA-compliant — PDPA's data minimisation principle requires ceasing retention when the purpose is served. The 1-year post-withdrawal window provides an audit trail buffer. When a `ConsentRecord` row is hard deleted, the `AuditLog` entry for the deletion event survives independently (audit logs are never deleted), preserving the compliance trail.

Each flag creates a `DataDeletionRequest` record with:
- `status: flagged` (admin can approve) or `status: blocked` (AML/CFT override, admin cannot execute early)
- `retentionRule` string identifying the applicable rule
- `details` JSON with entity snapshot for the audit trail

### Admin deletion queue

Route: `GET /admin/compliance/deletion-queue`

Lists `DataDeletionRequest` records. For each:
- `status: blocked` → greyed out button, shows retention end date, explains AML/CFT override
- `status: flagged` → "Approve Deletion" button

On admin approval, `compliance.service.executeHardDelete(requestId, agentId)`:
1. Validates request is `status: flagged` (not blocked)
2. Calls `compliance.repository.hardDelete(entityType, entityId)` which runs Prisma `delete` — never calls Prisma directly in the service
3. Calls `fs.unlink()` for any associated files on disk (file paths retrieved before delete executes)
4. Marks `DataDeletionRequest` as `status: executed`, sets `executedAt`
5. Creates audit log `data.hard_deleted` — self-contained snapshot (includes entity type, ID, and field summary captured before deletion; does not rely on the now-deleted record being queryable)

**Repeat-seller rule:** If a seller has any transaction (active or completed, regardless of count), the AML/CFT 5-year hold applies to the entire seller record. The rule is "any transaction ever triggers the 5-year hold from the latest transaction's completion date." A seller with multiple completed transactions uses the most recent `completionDate` as the retention start.

### Agent anonymisation

Separate from the cron-driven retention flow. Admin triggers from the agent detail page when deactivating a departed agent.

`compliance.service.anonymiseAgent(agentId, adminId)`:
- Sets: `name → "Former Agent {agentId}"`, `email → "anonymised-{agentId}@deleted.local"`, `phone → null`
- Agent record persists — audit logs continue to reference the agent ID meaningfully
- Audit log: `agent.anonymised`

This is the **only** case where anonymisation instead of hard delete is appropriate. Agent IDs appear in immutable audit logs; deleting the agent record would break referential integrity of the compliance record.

## SP4: NRIC Handling

**`src/domains/shared/nric.ts`** (new file):

```typescript
maskNric(last4: string): string
// Converts "567A" to "SXXXX567A" for display
// The S prefix and XXXX are fixed — only the last 4 characters are real

validateNricLast4(value: string): boolean
// Validates that the stored last-4 matches expected format (3 digits + 1 uppercase letter)
```

**Storage rules (already in schema):**
- `CddRecord.nricLast4` — last 4 characters only in database
- Full NRIC document scans stored as encrypted files via `encryption.ts`
- Display: always masked (`SXXXX567A`) — sellers and agents see only the mask

**Access control:**
- CDD document routes have agent-only middleware
- Sellers cannot access full NRIC document paths — only their masked last-4 via "My Data"
- Admin has access to CDD records but still sees masked display

## SP5: DNC Registry Compliance

Covered under SP1 (DNC gate in compliance service). Key constraint: marketing messages require explicit `consentMarketing === true`. Service messages (transaction notifications, compliance notices) are allowed with service consent only.

All outbound notification send attempts are logged in the `Notification` table with status `blocked` when the DNC gate rejects them — providing an audit trail of suppressed communications.

## SP6: Secure Download & Server Deletion

**Route:** `POST /agent/transactions/:transactionId/documents/:docType/download-and-delete`

**Supported `docType` values:** `cdd`, `otp`, `invoice`, `eaa` (EstateAgencyAgreement)

**Prerequisites:**
- Transaction `status === 'completed'` (system blocks during active transactions)
- Agent owns the seller (or requester is admin)
- Request body: `{ offlineRetentionConfirmed: true, canProduceConfirmed: true }` — both confirmations required

**Flow:**
1. Validates prerequisites — returns 403 if transaction not completed, 400 if confirmations missing
2. Resolves file path from the relevant record — validates file exists on disk before starting
3. Streams file to client with `res.download()`
4. On `res` `finish` event (stream fully sent, not just closed): `fs.unlink()` the file from disk. If the response errors before finishing, the file is **not** deleted — the agent can retry.
5. Updates DB record: set file path field to null, set `deletedAt` timestamp
6. Creates audit log `documents.downloaded_and_deleted`:
   ```json
   {
     "files": ["filename.pdf"],
     "transactionId": "...",
     "downloadedBy": "agentId",
     "offlineRetentionConfirmed": true,
     "reason": "server data minimisation"
   }
   ```

**Bulk route:** `POST /agent/transactions/:transactionId/documents/download-all-and-delete`
- Collects all sensitive document paths for the transaction
- **Validates all file paths exist on disk before beginning** — returns 400 with list of missing files if any are absent, so the agent can resolve the discrepancy before committing to the operation
- Packages into a zip archive via `archiver` npm package
- Streams zip; deletion only happens on `res` `finish` event (same guard as single-file route)
- Deletes all files and updates all records post-download
- If deletion of any individual file fails post-stream, logs the error but continues deleting the rest (best-effort; admin is alerted via error log)

**Database metadata is preserved after deletion.** The following remain queryable:
- CDD: `identityVerified`, `verifiedByAgentId`, `verifiedAt`, `riskLevel`
- OTP: `status`, serial number, `issuedAt`, `exercisedAt`
- Invoice: `status`, `sentAt`, `paidAt`, `amount`

Only the actual file binary is removed. The audit trail proving due diligence was performed remains intact.

## Testing

### Unit tests (co-located with compliance domain)

- NRIC masking: `"S1234567A"` → `"SXXXX567A"` / `"567A"` → `"SXXXX567A"`
- Consent validation: rejects lead without service consent
- Consent validation: accepts lead without marketing consent
- Retention scanner: correctly flags leads with no activity > 12 months
- Retention scanner: does NOT flag transaction records < 5 years old
- Retention scanner: flags transaction records > 5 years old
- Retention scanner: does NOT flag CDD records during active business relationship
- DNC gate: marketing message blocked if `consentMarketing === false`
- DNC gate: service message allowed if `consentMarketing === false` but `consentService === true`
- DNC gate: all messages blocked if `consentService === false`
- File encryption: AES-256 encrypt/decrypt round-trip (encryption.ts already tested)
- Download-and-delete: blocked during active transaction (status !== completed)
- Download-and-delete: blocked if confirmation fields missing or false
- Consent withdrawal: creates new ConsentRecord (does not update existing)
- Agent anonymisation: sets correct anonymised values

### Integration tests (`tests/integration/`)

- Consent withdrawal (marketing): stops marketing sends, audit logged, old record unchanged
- Consent withdrawal (service, no transaction): creates flagged DataDeletionRequest within 30 days
- Consent withdrawal (service, active transaction): creates blocked DataDeletionRequest with AML/CFT rule
- Data access page: shows complete personal data for authenticated seller
- Data correction flow: request created → agent notified → applied → audit logged
- Retention scanner: lead flagged → admin approves → hard delete executes → `SELECT` returns null → files removed → audit log remains
- Retention scanner: transaction < 5 years → admin cannot approve early deletion (status: blocked)
- Retention scanner: CDD documents hard deleted after 5 years → encrypted files removed from disk
- Agent anonymisation: name/email/phone nullified → audit logs still reference agent ID → agent record still exists
- Hard delete verification: after deletion, `SELECT` by ID returns null (not a soft-deleted record)
- NRIC access: encrypted storage, agent-only access, seller cannot retrieve full NRIC document
- Download-and-delete: file downloaded → file deleted from disk → DB record updated (filePath null, deletedAt set) → CDD verification metadata still intact → audit log created
- Download-and-delete: after deletion, file no longer accessible via any route (returns 404)
- Download-and-delete: attempt on active transaction returns 403
- Download-and-delete: bulk download packages all files → deletes all → all records updated

## Sub-phases

Phase 5 is split into three sprint-sized sub-phases:

| Sub-phase | Business subsystems covered |
|-----------|----------------------------|
| SP1 | Compliance domain scaffold · Consent management (§5.1) · DNC registry gate (§5.5) |
| SP2 | Seller "My Data" page (§5.2) · Data correction requests (§5.2) · NRIC helpers (§5.4) |
| SP3 | Retention scanner (§5.3) · Admin deletion queue (§5.3) · Agent anonymisation (§5.3) · Secure download & delete (§5.6) |
