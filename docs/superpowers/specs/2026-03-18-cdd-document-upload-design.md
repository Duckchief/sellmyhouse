# CDD Document Upload — Design Spec
**Date:** 2026-03-18
**Status:** Approved

## Problem

The `CddRecord` model has a `documents` JSON field designed to hold encrypted identity document paths, but no upload route exists. The download-and-delete routes in `compliance.router.ts` that reference `documents` are dead code paths — `cddRecords.flatMap(r => r.documents)` always returns empty. Files are also stored as plaintext by `localStorage`, violating the spec requirement of AES-256 encryption at rest for CDD documents.

---

## Solution Overview

Two-step flow: agent creates CDD record (existing), then uploads documents to it separately. Files are encrypted at rest using per-file envelope encryption. A `KeyProvider` abstraction allows the current `ENCRYPTION_KEY` env var to be swapped for AWS KMS without changing encryption logic.

---

## Document Types

A fixed enum covers all realistic HDB resale CDD scenarios:

| Value | Use case |
|---|---|
| `nric` | NRIC copy (SC/PR) |
| `passport` | Passport (foreigners) |
| `work_pass` | EP / S Pass / LTVP |
| `proof_of_address` | Utility bill, bank statement (enhanced DD) |
| `source_of_funds` | Enhanced risk level cases |
| `acra_bizfile` | Corporate counterparties |
| `death_certificate` | Executor/administrator estate cases |
| `will` | Testamentary executor cases |
| `letters_of_administration` | Intestate cases (no will) |
| `grant_of_probate` | Court grant (executor cases) |
| `hdb_transmission_approval` | HDB approval for estate transmission |
| `other` | Catch-all — requires agent-supplied `label` |

CDD is about verifying identity and authority to transact. In executor/administrator cases, probate documents (death certificate, will, grant of probate, HDB transmission approval) are part of CDD because they establish the legal standing to sell, not just identity.

---

## Architecture

### New Infrastructure

```
src/infra/security/key-provider.ts          # KeyProvider interface, EnvKeyProvider, AwsKmsKeyProvider
src/infra/storage/encrypted-storage.ts      # encryptedStorage: StorageService with encrypt-on-save, decrypt-on-read
```

### Modified Compliance Domain

```
src/domains/compliance/compliance.types.ts      # CddDocumentType enum, CddDocument type
src/domains/compliance/compliance.repository.ts # addCddDocument, removeCddDocument, getCddDocuments
src/domains/compliance/compliance.service.ts    # uploadCddDocument, downloadCddDocument, deleteCddDocument
src/domains/compliance/compliance.router.ts     # POST/GET/DELETE routes
src/domains/compliance/compliance.validator.ts  # docType enum validation, label rule
```

---

## API Routes

All routes: `requireAuth()` + `requireRole('agent', 'admin')` + `requireTwoFactor()`.
Ownership check in service layer: agent must be `verifiedByAgentId` on the CDD record, or admin.

### POST `/agent/cdd-records/:cddRecordId/documents`
Upload a document to an existing CDD record.

- Multer memory storage, max 10MB, allowed MIME: `image/jpeg`, `image/png`, `application/pdf`
- Body: `docType` (enum), `label` (required only when `docType === 'other'`, max 100 chars)
- Max 5 documents per CDD record
- ClamAV scan → fail-closed in production
- Encrypt → save → append to `documents` JSON → audit log

### DELETE `/agent/cdd-records/:cddRecordId/documents/:documentId`
Hard delete a single document.

- `fs.unlink()` the `.enc` file
- Remove entry from `documents` JSON
- Audit log
- Does not require transaction to be completed (agent may replace a bad scan at any time)

### POST `/agent/cdd-records/:cddRecordId/documents/:documentId/download`
Download (decrypt and stream) a single document for agent review. Does not delete the file.

- Unwrap data key → decrypt buffer in memory → stream to agent
- `Content-Disposition: attachment`, `Cache-Control: no-store`
- Audit log

---

## Envelope Encryption

### KeyProvider Interface

```ts
interface KeyProvider {
  wrapKey(dataKey: Buffer): Promise<string>;   // returns base64 ciphertext of encrypted data key
  unwrapKey(wrapped: string): Promise<Buffer>; // returns raw data key
}
```

**`EnvKeyProvider`:** uses `ENCRYPTION_KEY` env var, AES-256-GCM — consistent with existing `encrypt()`/`decrypt()` in `src/domains/shared/encryption.ts`. No new dependencies.

**`AwsKmsKeyProvider`:** uses `@aws-sdk/client-kms`. `GenerateDataKey` for wrap, `Decrypt` for unwrap. KMS key ARN from `KMS_KEY_ARN` env var. Region: `ap-southeast-1` (Singapore).

**Provider selection at startup** in `src/server.ts`:
```ts
const keyProvider = process.env.KEY_PROVIDER === 'aws'
  ? new AwsKmsKeyProvider()
  : new EnvKeyProvider();
```

Injected into `encryptedStorage` as a module-level singleton.

### Save Flow

```
1. Generate random 32-byte dataKey + 12-byte IV
2. AES-256-GCM encrypt buffer → ciphertext + authTag
3. Write blob: IV (12B) + authTag (16B) + ciphertext
4. KeyProvider.wrapKey(dataKey) → wrappedKey (base64)
5. localStorage.save(path, encBlob)
6. Return { path, wrappedKey }
```

### Read Flow

```
1. localStorage.read(path) → encBlob
2. Slice: IV = blob[0..12], authTag = blob[12..28], ciphertext = blob[28..]
3. KeyProvider.unwrapKey(wrappedKey) → dataKey
4. AES-256-GCM decrypt → plaintext buffer (in memory only, never written to disk)
5. Return buffer
```

### `documents` JSON Entry Shape

```ts
{
  id: string              // cuid2 — used as documentId in routes
  docType: CddDocumentType
  label: string | null    // required for 'other', null otherwise
  path: string            // relative: cdd/{cddRecordId}/{docType}-{uuid}.enc
  wrappedKey: string      // base64 — data key encrypted by master key
  mimeType: string        // original MIME type, for Content-Type on download
  sizeBytes: number       // original plaintext size (for UI display)
  uploadedAt: string      // ISO timestamp
  uploadedByAgentId: string
}
```

### File Storage

- Directory: `uploads/cdd/{cddRecordId}/`
- Filename: `{docType}-{uuid}.enc`
- Permissions: `chmod 700` (consistent with spec)
- UUID in filename prevents enumeration; docType prefix aids forensic identification

---

## Validation

| Layer | Rule |
|---|---|
| Multer | Max 10MB, MIME: jpeg/png/pdf only |
| Validator | `docType` must be one of 12 enum values |
| Validator | `label` required + max 100 chars when `docType === 'other'` |
| Service | Max 5 documents per CDD record |
| Service | ClamAV scan — fail-closed in production |
| Router | `assertInUploadsRoot()` on all resolved paths |
| Service | Ownership: agent must be `verifiedByAgentId` or admin |

---

## Error Handling

| Condition | Response |
|---|---|
| Infected file | `ValidationError` + audit log (`cdd.document_scan_rejected`) |
| Invalid docType | `ValidationError` |
| Missing label for 'other' | `ValidationError` |
| Document limit (>5) exceeded | `ValidationError` |
| Non-owner agent | `ForbiddenError` |
| File not found on disk | `NotFoundError` |
| KMS unavailable | 500 — fail-closed, no plaintext fallback |
| Path traversal attempt | `ForbiddenError` via `assertInUploadsRoot()` |

---

## Audit Log

Every operation is logged. Sensitive values are never logged.

| Action | Logged fields |
|---|---|
| `cdd.document_uploaded` | `cddRecordId`, `docType`, `sizeBytes`, `agentId` |
| `cdd.document_downloaded` | `cddRecordId`, `documentId`, `docType`, `agentId` |
| `cdd.document_deleted` | `cddRecordId`, `documentId`, `docType`, `agentId` |
| `cdd.document_scan_rejected` | `cddRecordId`, `filename`, `viruses`, `agentId` |

**Never logged:** file paths, wrapped keys, plaintext content, original filenames.

---

## Retention & PDPA Hard Delete

- `CddRecord.retentionExpiresAt` already set to 5 years (AML/CFT minimum), refreshed on transaction completion
- Existing `scanRetention` job extended to iterate `documents` entries, `fs.unlink()` each `.enc` file, then `hardDeleteCddDocuments()` to clear JSON
- `CddRecord` row retained with `documents: []` — AML/CFT requires record retention, not file retention
- `collectSellerFilePaths()` extended to include CDD `.enc` file paths for PDPA hard delete
- `localStorage.delete()` handles `.enc` deletion — no decryption needed

**No schema migration required.** `documents` is already `Json` on `CddRecord`. New entry shape is additive.

---

## Testing

| File | Coverage |
|---|---|
| `encrypted-storage.test.ts` | Save/read round-trip, IV unique per file, wrong key fails auth tag, path traversal rejected |
| `key-provider.test.ts` | `EnvKeyProvider` wrap/unwrap round-trip; `AwsKmsKeyProvider` via mocked `@aws-sdk/client-kms` |
| `compliance.service.test.ts` | Upload happy path, virus rejected, doc limit enforced, ownership check, download decrypts correctly, delete removes file + JSON entry |
| `compliance.router.test.ts` | All three routes correct status codes, 2FA guard enforced, non-owner agent gets 403 |

No real KMS calls in tests — `KeyProvider` is injected and easily mocked.
