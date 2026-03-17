# Remove EAA Signed Copy Upload

**Date:** 2026-03-17
**Status:** Approved

## Context

The EAA (Estate Agency Agreement) signed copy upload feature allowed agents to upload a scanned PDF/image of the physically-signed CEA Form 1 into the platform. This was intended for AML/CFT 5-year retention.

The business decision: signed copies will be stored offline and uploaded directly to the Estate Agent's (Huttons) internal system after transaction completion. The platform does not need to store or serve these files. The "Mark as Signed" status button is retained for audit trail purposes.

## What Changes

### Removed entirely
- Upload Signed Copy button (EAA card UI)
- `eaa-signed-copy-modal.njk` template
- POST `/agent/eaa/:eaaId/signed-copy` route
- GET `/agent/eaa/:eaaId/signed-copy/modal` route
- `multer` import and `upload` middleware variable from compliance router
- `eaa` doc type branch from the compliance document download endpoint (`GET /agent/transactions/:txId/documents`)
- `eaa` doc type branch from the bulk retention document delete (zip download route)
- `uploadEaaSignedCopy` service function
- `recordEaaSignedCopyDeleted` service function
- `ALLOWED_DOC_TYPES` and `MAX_DOC_SIZE` constants (only used by upload)
- `updateEaaSignedCopy` repository function
- `markEaaSignedCopyDeleted` repository function
- EAA signed copy path from `collectSellerFilePaths` (retention scan)
- `signedCopyPath` and `signedCopyDeletedAt` from `findTransactionDocuments` select
- All related unit tests

### Kept
- "Mark as Signed" status button and `updateEaaStatus` flow (audit trail)
- `signedAt` field on EAA record
- `signedCopyPath` and `signedCopyDeletedAt` DB columns — left as-is (always null, no migration needed)
- `compliance-eaa-card.njk` EAA status display and other action buttons

## Database

No migration required. The `signedCopyPath` and `signedCopyDeletedAt` columns remain in the `estate_agency_agreements` table but will always be null going forward.

## Testing

Remove tests covering:
- POST signed-copy route (router test)
- GET signed-copy modal route (router test)
- `uploadEaaSignedCopy` (service test)
- `updateEaaSignedCopy` (repository test)

All remaining compliance tests must continue to pass.
