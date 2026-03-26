# Spec: Photo Duplicate Detection

**Date:** 2026-03-24
**Status:** Approved

## Problem

A seller can upload the same photo file multiple times, wasting storage and cluttering the listing. There is no duplicate check in the current upload flow.

## Solution

Detect duplicate photos by content hash (SHA-256) at upload time. If the incoming file's hash matches any existing photo in the listing, reject the upload with a `ValidationError` before any file is saved to disk. The existing error rendering path displays the message in the photo grid.

## Behaviour

- On upload, SHA-256 of the raw file buffer is computed before any processing or disk writes
- The hash is compared against the `hash` field of every existing photo in the listing
- If a match is found: upload is rejected with the message `"This photo has already been uploaded."`
- If no match: upload proceeds normally; the computed hash is stored on the `PhotoRecord`
- The error renders in `#photo-grid-container` via the existing `ValidationError` path in the router (same as oversized/wrong-type errors)
- When using multi-file drag-and-drop, the queue halts on the duplicate error (existing `e.detail.successful` guard handles this)

## Implementation

### 1. `PhotoRecord` interface (`src/domains/property/property.types.ts`)

Add one optional field to maintain backwards compatibility with existing records that have no hash:

```ts
export interface PhotoRecord {
  // ... existing fields ...
  hash?: string;
}
```

### 2. `photo.service.ts`

**New helper:**
```ts
import { createHash } from 'crypto';

function computeHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
```

**Duplicate check** — called in `processAndSavePhoto` before the virus scan and before any disk writes:

```ts
export async function processAndSavePhoto(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string,
  sellerId: string,
  propertyId: string,
): Promise<ProcessedPhotoMetadata> {
  // Check for duplicate before any processing
  const hash = computeHash(buffer);
  const listing = await propertyRepo.findActiveListingForProperty(propertyId);
  if (listing) {
    const existing: PhotoRecord[] = listing.photos
      ? (JSON.parse(listing.photos as string) as PhotoRecord[])
      : [];
    if (existing.some((p) => p.hash === hash)) {
      throw new ValidationError('This photo has already been uploaded.');
    }
  }

  // ... rest of existing function unchanged ...
}
```

**Store hash on `PhotoRecord`** — in the router (`property.router.ts`) where `photoRecord` is assembled, add `hash` to the object passed to `addPhotoToListing`. The hash must be returned from `processAndSavePhoto` via `ProcessedPhotoMetadata`.

Add `hash: string` to `ProcessedPhotoMetadata` and return it from `processAndSavePhoto`.

### 3. `property.router.ts`

Add `hash: processed.hash` when constructing `photoRecord`:

```ts
const photoRecord: PhotoRecord = {
  // ... existing fields ...
  hash: processed.hash,
};
```

No other router changes.

## Scope

- Modify: `src/domains/property/property.types.ts` (add `hash?: string` to `PhotoRecord`)
- Modify: `src/domains/property/photo.service.ts` (add `computeHash`, duplicate check, return `hash` from `processAndSavePhoto`)
- Modify: `src/domains/property/property.router.ts` (pass `hash` when constructing `photoRecord`)
- No template changes
- No migration (photos stored as JSON, `hash` is optional on existing records)

## Testing

- Upload same photo twice → second upload rejected with "This photo has already been uploaded."
- Upload same file with different name → still rejected (hash is content-based)
- Upload two different photos → both accepted
- Existing photos with no `hash` field → not falsely flagged as duplicates
- Unit tests: `computeHash` returns consistent SHA-256; `processAndSavePhoto` throws `ValidationError` when hash matches
