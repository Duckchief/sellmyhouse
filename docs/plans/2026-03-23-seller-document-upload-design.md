# Seller Document Upload & Tracking — Design

**Date:** 2026-03-23
**Status:** Approved

## Overview

Allow sellers to upload required documents through their dashboard. Agents are notified in-app, download the documents (which auto-deletes them from the system), and submit them to Huttons' internal systems. A 7-day auto-purge backstop ensures no sensitive files linger.

## Data Model

### SellerDocument Table

```prisma
model SellerDocument {
  id           String    @id @default(cuid())
  sellerId     String
  seller       Seller    @relation(fields: [sellerId], references: [id])
  docType      String    // nric, marriage_cert, eligibility_letter, otp_scan, eaa, other
  slotIndex    Int?      // 0=front, 1=back for NRIC; 0-based for multi-file types; null for single-file
  path         String    // encrypted file path: seller-docs/{sellerId}/{docType}-{id}.enc
  wrappedKey   String    // AES-256-GCM wrapped data key (base64)
  mimeType     String
  sizeBytes    Int
  uploadedAt   DateTime  @default(now())
  uploadedBy   String    // user ID (seller or agent)
  downloadedAt DateTime? // set when agent downloads
  downloadedBy String?   // agent user ID
  deletedAt    DateTime? // set on hard-delete (file removed, path retained for audit)

  @@index([sellerId, docType])
  @@index([sellerId, deletedAt])
}
```

### Document Type Constraints

| docType | Max Files | slotIndex Usage |
|---------|-----------|-----------------|
| `nric` | 2 | 0, 1 (front/back — or single file for both) |
| `marriage_cert` | 3 | 0, 1, 2 |
| `eligibility_letter` | 1 | null |
| `otp_scan` | 1 | null |
| `eaa` | 1 | null |
| `other` | 5 | 0–4 |

All types accept jpeg, png, pdf. Max file size: 10MB.

## Checklist Status Derivation

Status is derived from `SellerDocument` rows, not stored separately:

- **Not Uploaded** — no rows for that `docType`
- **Uploaded** — at least one row with `deletedAt IS NULL`
- **Received by Agent** — all rows for that `docType` have `deletedAt IS NOT NULL`

Re-upload after "Received by Agent" creates new rows, cycling status back to "Uploaded".

## Upload Flow

### Seller Upload
1. `POST /seller/documents` — multipart with `docType` + file
2. Validate `docType`, check file count hasn't hit max
3. Detect MIME from actual bytes (magic bytes via `file-type`)
4. Virus scan via ClamAV (`scanBuffer`, fail-closed)
5. Encrypt via `encryptedStorage.save()` → path + wrappedKey
6. Insert `SellerDocument` row
7. Create in-app notification for seller's assigned agent
8. Audit log: `seller_document.uploaded`
9. HTMX: re-render updated checklist item partial

### Agent Upload (on behalf of seller)
- `POST /agent/sellers/:sellerId/documents` — same flow
- `uploadedBy` = agent's user ID
- Audit log distinguishes seller vs agent upload

## Download & Purge Flow

### Individual Download-and-Delete
1. `POST /agent/sellers/:sellerId/documents/:documentId/download`
2. Decrypt via `encryptedStorage.read(path, wrappedKey)` → plaintext buffer (memory only)
3. Stream to agent with `Content-Disposition: attachment`, `Cache-Control: no-store`
4. Hard-delete: `encryptedStorage.delete(path)`, set `deletedAt` + `downloadedAt` + `downloadedBy`
5. Audit log: `seller_document.downloaded_and_deleted`

### Bulk Download-and-Delete
1. `POST /agent/sellers/:sellerId/documents/download-all`
2. Collect all un-deleted documents for seller
3. Decrypt all into memory, package as ZIP
4. Stream ZIP to agent
5. Hard-delete all files, update all rows
6. Audit log: `seller_document.bulk_downloaded_and_deleted`

### 7-Day Auto-Purge Backstop
- Daily cron picks up `SellerDocument` rows where `deletedAt IS NULL` and `uploadedAt` older than `sensitive_doc_retention_days` (7 days)
- Hard-deletes files and updates rows — same Tier 1 purge pattern
- Covers edge case where agent never downloads

### Seller-Side Delete
- `DELETE /seller/documents/:documentId`
- Only allowed while `downloadedAt IS NULL` (agent hasn't received it)
- Hard-deletes file, removes row entirely
- Audit log: `seller_document.deleted_by_seller`

## Agent Notification

- In-app notification only — one per upload, not batched
- Notification type: `seller_document_uploaded`
- Content: seller name + document type
- Agent dashboard shows badge/indicator for pending downloads

## UI

### Seller Dashboard (`/seller/documents`)
- Each checklist item shows live status: Not Uploaded / Uploaded / Received by Agent
- Upload area per item (file input or drag-drop), respecting max file count per `docType`
- Shows existing uploaded files (filename, size, upload date) with delete option (before agent download)
- Items filtered by property status (existing behaviour)
- HTMX: upload swaps just that checklist item partial

### Agent View (`/agent/sellers/:sellerId/documents`)
- Uploaded documents grouped by `docType`
- Per-document: type, size, upload date
- Individual "Download" button per document
- "Download All" button for bulk ZIP
- Both trigger download-and-delete

## Security & Compliance

| Concern | Approach |
|---------|----------|
| Encryption at rest | AES-256-GCM via `encryptedStorage` — per-file key, wrappedKey in DB |
| Virus scanning | ClamAV `scanBuffer`, fail-closed in production |
| MIME validation | Magic bytes via `file-type` library, not client header |
| File size | 10MB max |
| Path traversal | `assertInUploadsRoot()` on all file operations |
| Seller auth | `requireAuth()` + `requireRole('seller')` — own docs only |
| Agent auth | `requireAuth()` + `requireRole('agent')` + `requireTwoFactor()` — assigned sellers only |
| PDPA | Hard-delete on download. 7-day auto-purge backstop. No soft delete for personal data. |
| Audit trail | All uploads, downloads, deletions logged. Rows retained (paths nulled) for accountability. |
| Rate limiting | Existing API rate limit (100/min) |
