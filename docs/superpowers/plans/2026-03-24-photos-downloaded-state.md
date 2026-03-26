# Photos Downloaded State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a green "photos received" banner on the seller photo page after the agent downloads photos, and add a reinstate button on the agent portal to re-enable seller uploads.

**Architecture:** `getPhotosForProperty` is extended to return `{ photos, photosDownloaded }`. A new `photo-page-body.njk` partial wraps both the upload area and the grid, conditionally replaced by a banner. On the agent side, a new service function + repo function + route handle reinstatement by clearing `photosApprovedAt`.

**Tech Stack:** TypeScript, Express, Nunjucks, Prisma, HTMX, Tailwind CSS, Jest

---

## File Map

| File | Change |
|------|--------|
| `src/domains/property/photo.service.ts` | Extend `getPhotosForProperty` return type |
| `src/domains/property/__tests__/photo.service.test.ts` | Update existing tests + new photosDownloaded tests |
| `src/domains/property/property.router.ts` | Fix 3 call sites; update HTMX branch |
| `src/domains/property/__tests__/property.router.test.ts` | Update 2 mocks to new return shape |
| `src/views/partials/seller/photo-page-body.njk` | **New** — downloaded banner + conditional includes |
| `src/views/pages/seller/photos.njk` | Use new partial inside `#photo-page-body` wrapper |
| `src/domains/property/portal.repository.ts` | New `reinstateListingPhotos` function |
| `src/domains/property/portal.service.ts` | New `reinstatePhotoUpload` function |
| `src/domains/property/__tests__/portal.service.test.ts` | Tests for `reinstatePhotoUpload` |
| `src/domains/property/portal.router.ts` | New `POST /agent/listings/:listingId/photos/reinstate` route |
| `src/views/partials/agent/portal-photos.njk` | Add reinstate form to downloaded branch |

---

### Task 1: Extend `getPhotosForProperty` and fix all call sites

**Files:**
- Modify: `src/domains/property/photo.service.ts:248-259`
- Modify: `src/domains/property/__tests__/photo.service.test.ts:665-697`
- Modify: `src/domains/property/property.router.ts:166-167, 204-209, 324-325`
- Modify: `src/domains/property/__tests__/property.router.test.ts` (2 mock lines)

- [ ] **Step 1: Write failing tests for `getPhotosForProperty` new return shape**

In `src/domains/property/__tests__/photo.service.test.ts`, replace the existing `getPhotosForProperty` describe block (lines 665–697) with:

```typescript
// ─── getPhotosForProperty ───────────────────────────────────
describe('getPhotosForProperty', () => {
  it('returns photos sorted by displayOrder', async () => {
    const photo1 = makePhotoRecord({ id: 'photo-1', displayOrder: 2 });
    const photo2 = makePhotoRecord({ id: 'photo-2', displayOrder: 0 });
    const photo3 = makePhotoRecord({ id: 'photo-3', displayOrder: 1 });
    const listing = { ...makeListing([photo1, photo2, photo3]), photosApprovedAt: null };
    mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as unknown as Listing);

    const result = await photoService.getPhotosForProperty('prop-1');

    expect(result.photos[0].id).toBe('photo-2');
    expect(result.photos[1].id).toBe('photo-3');
    expect(result.photos[2].id).toBe('photo-1');
    expect(result.photosDownloaded).toBe(false);
  });

  it('returns empty array and photosDownloaded false when listing has no photos', async () => {
    const listing = { ...makeListing([]), photosApprovedAt: null };
    mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as unknown as Listing);

    const result = await photoService.getPhotosForProperty('prop-1');

    expect(result.photos).toEqual([]);
    expect(result.photosDownloaded).toBe(false);
  });

  it('returns empty array and photosDownloaded false when no active listing exists', async () => {
    mockedRepo.findActiveListingForProperty.mockResolvedValue(null);

    const result = await photoService.getPhotosForProperty('bad-prop');

    expect(result.photos).toEqual([]);
    expect(result.photosDownloaded).toBe(false);
  });

  it('returns photosDownloaded true when photosApprovedAt is set and photos is null', async () => {
    const listing = {
      id: 'listing-1',
      propertyId: 'prop-1',
      status: 'approved',
      photos: null,
      photosApprovedAt: new Date('2026-03-20'),
    };
    mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as unknown as Listing);

    const result = await photoService.getPhotosForProperty('prop-1');

    expect(result.photos).toEqual([]);
    expect(result.photosDownloaded).toBe(true);
  });

  it('returns photosDownloaded false when photosApprovedAt is set but photos still exist', async () => {
    const photo = makePhotoRecord({ displayOrder: 0 });
    const listing = {
      ...makeListing([photo]),
      photosApprovedAt: new Date('2026-03-20'),
    };
    mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as unknown as Listing);

    const result = await photoService.getPhotosForProperty('prop-1');

    expect(result.photos).toHaveLength(1);
    expect(result.photosDownloaded).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest --testPathPattern="photo.service.test" --no-coverage 2>&1 | tail -20
```

Expected: FAIL — existing tests call `result[0]` instead of `result.photos[0]`; new tests reference `photosDownloaded` which doesn't exist yet.

- [ ] **Step 3: Update `getPhotosForProperty` in `photo.service.ts`**

Replace the current `getPhotosForProperty` function (lines 248–259):

```typescript
// ─── Get Photos for Property ───────────────────────────────────────────────────

export async function getPhotosForProperty(
  propertyId: string,
): Promise<{ photos: PhotoRecord[]; photosDownloaded: boolean }> {
  const listing = await propertyRepo.findActiveListingForProperty(propertyId);
  if (!listing) {
    return { photos: [], photosDownloaded: false };
  }

  const photos: PhotoRecord[] = listing.photos
    ? (JSON.parse(listing.photos as string) as PhotoRecord[]).sort(
        (a, b) => a.displayOrder - b.displayOrder,
      )
    : [];

  const photosDownloaded =
    listing.photosApprovedAt !== null && listing.photosApprovedAt !== undefined && photos.length === 0;

  return { photos, photosDownloaded };
}
```

- [ ] **Step 4: Run service tests to verify they pass**

```bash
npx jest --testPathPattern="photo.service.test" --no-coverage 2>&1 | tail -10
```

Expected: all `getPhotosForProperty` tests PASS.

- [ ] **Step 5: Fix the three call sites in `property.router.ts`**

**Call site 1 — GET `/seller/photos` (lines 166–167):**

Replace:
```typescript
      const photos = await photoService.getPhotosForProperty(property.id);
      const templateData = { photos, photoCount: photos.length };
```
With:
```typescript
      const { photos, photosDownloaded } = await photoService.getPhotosForProperty(property.id);
      const templateData = { photos, photoCount: photos.length, photosDownloaded };
```

**Call site 2 — POST `/seller/photos` validation-failure branch (lines 203–209):**

Replace:
```typescript
        const photos = await photoService.getPhotosForProperty(property.id);
        return res.status(400).render('partials/seller/photo-grid', {
          photos,
          photoCount: photos.length,
          error: validation.error,
        });
```
With:
```typescript
        const { photos } = await photoService.getPhotosForProperty(property.id);
        return res.status(400).render('partials/seller/photo-grid', {
          photos,
          photoCount: photos.length,
          error: validation.error,
        });
```

**Call site 3 — GET `/seller/photos/:id/thumbnail` (lines 324–325):**

Replace:
```typescript
      const photos = await photoService.getPhotosForProperty(property.id);
      const photo = photos.find((p) => p.id === photoId);
```
With:
```typescript
      const { photos } = await photoService.getPhotosForProperty(property.id);
      const photo = photos.find((p) => p.id === photoId);
```

- [ ] **Step 6: Fix router test mocks in `property.router.test.ts`**

Find all lines that mock `getPhotosForProperty` with a bare array. There are two:

```typescript
// Line ~198:
mockedPhotoService.getPhotosForProperty.mockResolvedValue([]);
// Line ~216:
mockedPhotoService.getPhotosForProperty.mockResolvedValue([]);
```

Replace both with:
```typescript
mockedPhotoService.getPhotosForProperty.mockResolvedValue({ photos: [], photosDownloaded: false });
```

- [ ] **Step 7: Run all tests to verify no regressions**

```bash
npm test 2>&1 | tail -10
```

Expected: all suites pass.

- [ ] **Step 8: Commit**

```bash
git add src/domains/property/photo.service.ts \
        src/domains/property/__tests__/photo.service.test.ts \
        src/domains/property/property.router.ts \
        src/domains/property/__tests__/property.router.test.ts
git commit -m "feat: extend getPhotosForProperty to return photosDownloaded flag"
```

---

### Task 2: Create `photo-page-body.njk` partial and update seller photos page

**Files:**
- Create: `src/views/partials/seller/photo-page-body.njk`
- Modify: `src/views/pages/seller/photos.njk`
- Modify: `src/domains/property/property.router.ts` (HTMX branch, line 169–170)

- [ ] **Step 1: Create `src/views/partials/seller/photo-page-body.njk`**

```nunjucks
{% if photosDownloaded %}
<div class="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
  <div class="flex items-center justify-center mb-4">
    <div class="w-14 h-14 bg-green-500 rounded-full flex items-center justify-center">
      <svg class="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
      </svg>
    </div>
  </div>
  <h3 class="text-base font-semibold text-green-800 mb-2">{{ "Photos received by your agent" | t }}</h3>
  <p class="text-sm text-green-700">{{ "Your agent has downloaded your photos and will use them to market your property." | t }}</p>
</div>
{% else %}
<div id="photo-upload-container">
  {% include "partials/seller/photo-upload-area.njk" %}
</div>
<div id="photo-grid-container" class="mt-8">
  {% include "partials/seller/photo-grid.njk" %}
</div>
{% endif %}
```

- [ ] **Step 2: Update `src/views/pages/seller/photos.njk`**

Replace the current content after the page header include (lines 9–16) from:

```nunjucks
  <div id="photo-upload-container">
    {% include "partials/seller/photo-upload-area.njk" %}
  </div>

  <div id="photo-grid-container" class="mt-8">
    {% include "partials/seller/photo-grid.njk" %}
  </div>
```

With:

```nunjucks
  <div id="photo-page-body">
    {% include "partials/seller/photo-page-body.njk" %}
  </div>
```

- [ ] **Step 3: Update HTMX branch in `property.router.ts`**

In the GET `/seller/photos` handler, replace the HTMX render:

```typescript
      if (req.headers['hx-request']) {
        return res.render('partials/seller/photo-grid', templateData);
      }
```

With:

```typescript
      if (req.headers['hx-request']) {
        return res.render('partials/seller/photo-page-body', templateData);
      }
```

- [ ] **Step 4: Run all tests**

```bash
npm test 2>&1 | tail -10
```

Expected: all suites pass (template changes have no unit test coverage — visual verification is done manually).

- [ ] **Step 5: Commit**

```bash
git add src/views/partials/seller/photo-page-body.njk \
        src/views/pages/seller/photos.njk \
        src/domains/property/property.router.ts
git commit -m "feat: show photos-downloaded banner on seller photo page"
```

---

### Task 3: Add reinstate photo upload (agent side)

**Files:**
- Modify: `src/domains/property/portal.repository.ts`
- Modify: `src/domains/property/portal.service.ts`
- Modify: `src/domains/property/__tests__/portal.service.test.ts`
- Modify: `src/domains/property/portal.router.ts`
- Modify: `src/views/partials/agent/portal-photos.njk`

- [ ] **Step 1: Write failing tests for `reinstatePhotoUpload`**

In `src/domains/property/__tests__/portal.service.test.ts`, add a new describe block after the `downloadAndDeletePhotos` block (at the end of the file, before the closing `})`):

```typescript
  // ─── reinstatePhotoUpload ────────────────────────────────────────────────────

  describe('reinstatePhotoUpload', () => {
    beforeEach(() => {
      mockPortalRepo.reinstateListingPhotos = jest.fn().mockResolvedValue({} as never);
    });

    it('calls reinstateListingPhotos and writes audit log', async () => {
      mockPortalRepo.findListingById = jest.fn().mockResolvedValue({
        id: 'listing-1',
        photos: null,
        photosApprovedAt: new Date(),
        property: { seller: { agentId: 'agent-1' } },
      });

      await portalService.reinstatePhotoUpload('listing-1', 'agent-1', 'agent');

      expect(mockPortalRepo.reinstateListingPhotos).toHaveBeenCalledWith('listing-1');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'listing_photos.upload_reinstated' }),
      );
    });

    it('throws ForbiddenError when agent does not own the listing', async () => {
      mockPortalRepo.findListingById = jest.fn().mockResolvedValue({
        id: 'listing-1',
        photos: null,
        photosApprovedAt: new Date(),
        property: { seller: { agentId: 'agent-2' } },
      });

      await expect(
        portalService.reinstatePhotoUpload('listing-1', 'agent-1', 'agent'),
      ).rejects.toThrow(ForbiddenError);

      expect(mockPortalRepo.reinstateListingPhotos).not.toHaveBeenCalled();
    });

    it('allows admin to reinstate for any listing', async () => {
      mockPortalRepo.findListingById = jest.fn().mockResolvedValue({
        id: 'listing-1',
        photos: null,
        photosApprovedAt: new Date(),
        property: { seller: { agentId: 'agent-2' } },
      });

      await portalService.reinstatePhotoUpload('listing-1', 'admin-1', 'admin');

      expect(mockPortalRepo.reinstateListingPhotos).toHaveBeenCalledWith('listing-1');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest --testPathPattern="portal.service.test" --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `reinstatePhotoUpload` and `reinstateListingPhotos` do not exist yet.

- [ ] **Step 3: Add `reinstateListingPhotos` to `portal.repository.ts`**

At the end of `src/domains/property/portal.repository.ts`, add:

```typescript
export async function reinstateListingPhotos(listingId: string) {
  return prisma.listing.update({
    where: { id: listingId },
    data: { photosApprovedAt: null },
  });
}
```

- [ ] **Step 4: Add `reinstatePhotoUpload` to `portal.service.ts`**

At the end of `src/domains/property/portal.service.ts`, add:

```typescript
export async function reinstatePhotoUpload(
  listingId: string,
  callerAgentId: string,
  callerRole: string,
): Promise<void> {
  const listing = await portalRepo.findListingById(listingId);
  if (!listing) throw new NotFoundError('Listing', listingId);

  if (callerRole !== 'admin') {
    const assignedAgentId = listing.property?.seller?.agentId ?? null;
    if (assignedAgentId !== callerAgentId) {
      throw new ForbiddenError('You are not authorised to manage this listing');
    }
  }

  await portalRepo.reinstateListingPhotos(listingId);

  await auditService.log({
    agentId: callerAgentId,
    action: 'listing_photos.upload_reinstated',
    entityType: 'listing',
    entityId: listingId,
  });
}
```

- [ ] **Step 5: Run service tests to verify they pass**

```bash
npx jest --testPathPattern="portal.service.test" --no-coverage 2>&1 | tail -10
```

Expected: all suites pass.

- [ ] **Step 6: Add the reinstate route to `portal.router.ts`**

After the `POST /agent/listings/:listingId/photos/download-all` route (after line 109), add:

```typescript
// POST /agent/listings/:listingId/photos/reinstate — reinstate seller photo upload
portalRouter.post(
  '/agent/listings/:listingId/photos/reinstate',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { listingId } = req.params as { listingId: string };

      await portalService.reinstatePhotoUpload(listingId, user.id, user.role);

      const listingData = await portalService.getListingForPortalsPage(listingId, user.id, user.role);
      res.render('partials/agent/portal-photos', { listingData });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 7: Add reinstate form to `portal-photos.njk`**

In `src/views/partials/agent/portal-photos.njk`, replace lines 11–14 (the entire downloaded branch including the closing `{% elif %}` boundary):

```nunjucks
  {% if listingData.photosApprovedAt and listingData.photos | length == 0 %}
  {# Downloaded state: photosApprovedAt set but photos deleted from DB #}
  <p class="text-sm text-gray-500 italic">{{ "Photos have been downloaded and deleted." | t }}</p>

  {% elif listingData.photos | length > 0 %}
```

With:

```nunjucks
  {% if listingData.photosApprovedAt and listingData.photos | length == 0 %}
  {# Downloaded state: photosApprovedAt set but photos deleted from DB #}
  <p class="text-sm text-gray-500 italic">{{ "Photos have been downloaded and deleted." | t }}</p>
  <form hx-post="/agent/listings/{{ listingData.id }}/photos/reinstate"
        hx-target="#portal-photos-panel"
        hx-swap="outerHTML"
        class="mt-3">
    <input type="hidden" name="_csrf" value="{{ csrfToken }}">
    <button type="submit"
            class="w-full bg-white border border-gray-300 text-gray-700 py-2 rounded text-sm hover:bg-gray-50">
      {{ "↩ Reinstate seller photo upload" | t }}
    </button>
  </form>

  {% elif listingData.photos | length > 0 %}
```

This preserves the `{% elif %}` branch for when photos are present and the `{% else %}` / `{% endif %}` at the bottom of the file — only the downloaded branch body grows.

- [ ] **Step 8: Add router test for the reinstate route**

In `src/domains/property/__tests__/portal.router.test.ts`, add a new describe block after the existing test blocks (before the final closing `}`):

```typescript
  describe('POST /agent/listings/:listingId/photos/reinstate', () => {
    it('returns 200 and re-renders portal-photos partial on success', async () => {
      mockPortalService.reinstatePhotoUpload.mockResolvedValue(undefined);
      mockPortalService.getListingForPortalsPage.mockResolvedValue({
        id: 'listing-1',
        photos: [],
        photosApprovedAt: null,
      } as never);

      const res = await request(app).post('/agent/listings/listing-1/photos/reinstate');

      expect(res.status).toBe(200);
      expect(mockPortalService.reinstatePhotoUpload).toHaveBeenCalledWith(
        'listing-1',
        'agent-1',
        'agent',
      );
      expect(mockPortalService.getListingForPortalsPage).toHaveBeenCalledWith(
        'listing-1',
        'agent-1',
        'agent',
      );
    });

    it('returns 403 when agent does not own the listing', async () => {
      const { ForbiddenError } = await import('@/domains/shared/errors');
      mockPortalService.reinstatePhotoUpload.mockRejectedValue(
        new ForbiddenError('You are not authorised to manage this listing'),
      );

      const res = await request(app).post('/agent/listings/listing-1/photos/reinstate');

      expect(res.status).toBe(403);
    });
  });
```

- [ ] **Step 9: Run all tests**

```bash
npm test 2>&1 | tail -10
```

Expected: all suites pass.

- [ ] **Step 10: Commit**

```bash
git add src/domains/property/portal.repository.ts \
        src/domains/property/portal.service.ts \
        src/domains/property/__tests__/portal.service.test.ts \
        src/domains/property/__tests__/portal.router.test.ts \
        src/domains/property/portal.router.ts \
        src/views/partials/agent/portal-photos.njk
git commit -m "feat: add reinstate photo upload for agent portal"
```
