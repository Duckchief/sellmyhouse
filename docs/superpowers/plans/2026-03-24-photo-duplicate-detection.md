# Photo Duplicate Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject photo uploads whose SHA-256 hash matches any existing photo in the listing, preventing duplicate uploads.

**Architecture:** `computeHash(buffer)` is added to `photo.service.ts` and called at the top of `processAndSavePhoto` before the virus scan. If a matching hash is found in the listing's existing photos, a `ValidationError` is thrown. The hash is stored on `PhotoRecord` so future uploads can be compared. No DB migration needed — photos are stored as JSON in `listing.photos`.

**Tech Stack:** Node.js built-in `crypto` (no new dependencies), existing `ValidationError`, Jest for unit tests.

---

### Task 1: Add hash field to types

**Files:**
- Modify: `src/domains/property/property.types.ts`

This is a pure type change — add the optional `hash` field to `PhotoRecord` and the `ProcessedPhotoMetadata` interface in `photo.service.ts`.

- [ ] **Step 1: Add `hash?: string` to `PhotoRecord`**

In `src/domains/property/property.types.ts`, find the `PhotoRecord` interface (line 20) and add `hash?: string` after `uploadedAt`:

```ts
export interface PhotoRecord {
  id: string;
  filename: string;
  originalFilename: string;
  path: string;
  optimizedPath: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  displayOrder: number;
  status: PhotoStatus;
  uploadedAt: Date;
  hash?: string;
}
```

- [ ] **Step 2: Add `hash: string` to `ProcessedPhotoMetadata`**

In `src/domains/property/photo.service.ts`, find `ProcessedPhotoMetadata` (line 54) and add `hash: string` after `height`:

```ts
export interface ProcessedPhotoMetadata {
  id: string;
  filename: string;
  originalFilename: string;
  path: string;
  optimizedPath: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  hash: string;
}
```

- [ ] **Step 3: Run TypeScript build to confirm no type errors**

```bash
npm run build 2>&1 | grep -E "error TS|Error"
```

Expected: no TypeScript errors (there may be a warning about `hash` not yet returned from `processAndSavePhoto` — that's fine, fixed in Task 2).

- [ ] **Step 4: Commit**

```bash
git add src/domains/property/property.types.ts src/domains/property/photo.service.ts
git commit -m "feat: add hash field to PhotoRecord and ProcessedPhotoMetadata"
```

---

### Task 2: Implement `computeHash` and duplicate check in photo.service.ts

**Files:**
- Modify: `src/domains/property/photo.service.ts`
- Test: `src/domains/property/__tests__/photo.service.test.ts`

**Context:** `processAndSavePhoto` currently starts with a virus scan then disk writes. The duplicate check must go before both. The function already imports from `@paralleldrive/cuid2`, `sharp`, `file-type`, `local-storage`, `propertyRepo`, `auditService`, `scanBuffer`, and `errors`. You need to add `crypto` from Node built-ins.

The existing test file uses these patterns:
- `mockedRepo.findActiveListingForProperty` — mock this to return a listing with existing photos
- `makeListing(photos)` helper — returns `{ id: 'listing-1', propertyId: 'prop-1', status: 'draft', photos: JSON.stringify(photos) }`
- `makePhotoRecord(overrides)` helper — returns a valid `PhotoRecord` with optional field overrides

- [ ] **Step 1: Write failing tests**

In `src/domains/property/__tests__/photo.service.test.ts`, add a new `describe` block inside the existing `describe('photo.service', ...)` block, after the `validateImage` tests. Add it before or after the `processAndSavePhoto` describe block — check the file structure first.

```ts
describe('processAndSavePhoto — duplicate detection', () => {
  beforeEach(() => {
    mockedFileType.mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });
  });

  it('throws ValidationError when uploaded buffer hash matches an existing photo', async () => {
    const { createHash } = await import('crypto');
    const buffer = Buffer.from('fake-jpeg-data');
    const hash = createHash('sha256').update(buffer).digest('hex');
    const existingPhoto = makePhotoRecord({ hash });

    mockedRepo.findActiveListingForProperty.mockResolvedValue(
      makeListing([existingPhoto]) as unknown as Listing,
    );

    await expect(
      photoService.processAndSavePhoto(buffer, 'photo.jpg', 'image/jpeg', 'seller-1', 'prop-1'),
    ).rejects.toThrow(ValidationError);

    await expect(
      photoService.processAndSavePhoto(buffer, 'photo.jpg', 'image/jpeg', 'seller-1', 'prop-1'),
    ).rejects.toThrow('This photo has already been uploaded.');
  });

  it('does not throw when buffer hash does not match any existing photo', async () => {
    const existingPhoto = makePhotoRecord({ hash: 'different-hash-value' });

    mockedRepo.findActiveListingForProperty.mockResolvedValue(
      makeListing([existingPhoto]) as unknown as Listing,
    );

    await expect(
      photoService.processAndSavePhoto(
        Buffer.from('new-unique-image-data'),
        'new.jpg',
        'image/jpeg',
        'seller-1',
        'prop-1',
      ),
    ).resolves.toBeDefined();
  });

  it('does not throw when existing photos have no hash field (backwards compat)', async () => {
    const existingPhoto = makePhotoRecord(); // no hash field

    mockedRepo.findActiveListingForProperty.mockResolvedValue(
      makeListing([existingPhoto]) as unknown as Listing,
    );

    await expect(
      photoService.processAndSavePhoto(
        Buffer.from('any-image-data'),
        'photo.jpg',
        'image/jpeg',
        'seller-1',
        'prop-1',
      ),
    ).resolves.toBeDefined();
  });

  it('does not save files to disk when duplicate detected', async () => {
    const { createHash } = await import('crypto');
    const buffer = Buffer.from('fake-jpeg-data');
    const hash = createHash('sha256').update(buffer).digest('hex');
    const existingPhoto = makePhotoRecord({ hash });

    mockedRepo.findActiveListingForProperty.mockResolvedValue(
      makeListing([existingPhoto]) as unknown as Listing,
    );

    await expect(
      photoService.processAndSavePhoto(buffer, 'photo.jpg', 'image/jpeg', 'seller-1', 'prop-1'),
    ).rejects.toThrow(ValidationError);

    expect(mockedStorage.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern="photo.service" 2>&1 | tail -20
```

Expected: the four new tests FAIL (duplicate detection not yet implemented).

- [ ] **Step 3: Implement `computeHash` and the duplicate check**

In `src/domains/property/photo.service.ts`:

**Add import at the top** (after existing imports):
```ts
import { createHash } from 'crypto';
```

**Add `computeHash` helper** (after the existing imports block, before `validateImage`):
```ts
function computeHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
```

**Add duplicate check at the top of `processAndSavePhoto`**, before the `scanBuffer` call:
```ts
export async function processAndSavePhoto(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string,
  sellerId: string,
  propertyId: string,
): Promise<ProcessedPhotoMetadata> {
  // Check for duplicate before any processing or disk writes
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

  // Virus scan before processing
  const scanResult = await scanBuffer(buffer, originalFilename);
  // ... rest of function unchanged ...
```

**Return `hash` from `processAndSavePhoto`** — at the end of the function, add `hash` to the returned object:
```ts
  return {
    id,
    filename,
    originalFilename,
    path: originalPath,
    optimizedPath,
    mimeType,
    sizeBytes: buffer.length,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    hash,
  };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern="photo.service" 2>&1 | tail -20
```

Expected: all photo.service tests PASS, including the four new ones.

- [ ] **Step 5: Commit**

```bash
git add src/domains/property/photo.service.ts src/domains/property/__tests__/photo.service.test.ts
git commit -m "feat: detect duplicate photos by SHA-256 hash before upload"
```

---

### Task 3: Wire `hash` through the router

**Files:**
- Modify: `src/domains/property/property.router.ts` (lines ~220-234, the `photoRecord` construction in `POST /seller/photos`)

- [ ] **Step 1: Add `hash` to `photoRecord` construction**

In `src/domains/property/property.router.ts`, find the `photoRecord` object literal in the `POST /seller/photos` handler (search for `displayOrder: 0`). Add `hash: processed.hash` to it:

```ts
const photoRecord: PhotoRecord = {
  id: processed.id,
  filename: processed.filename,
  originalFilename: processed.originalFilename,
  path: processed.path,
  optimizedPath: processed.optimizedPath,
  mimeType: processed.mimeType,
  sizeBytes: processed.sizeBytes,
  width: processed.width,
  height: processed.height,
  displayOrder: 0,
  status: 'uploaded',
  uploadedAt: new Date(),
  hash: processed.hash,
};
```

- [ ] **Step 2: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: same pass/fail count as before (pre-existing `viewing.repository` failure only, no new failures).

- [ ] **Step 3: Manual verification**

Run `npm run dev` and go to `/seller/photos`:
1. Upload a photo → succeeds ✓
2. Upload the same photo again → rejected with "This photo has already been uploaded." ✓
3. Upload the same photo file renamed → still rejected (hash is content-based) ✓
4. Upload a different photo → succeeds ✓

- [ ] **Step 4: Commit**

```bash
git add src/domains/property/property.router.ts
git commit -m "feat: persist photo hash through router to PhotoRecord"
```
