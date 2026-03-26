# Listing Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents access to approved listing photos (download + delete as ZIP), a portals index page, and a listing status card on the seller detail page.

**Architecture:** Six tasks: (1) portal repo + service queries (badge count, index, listing photo data); (2) photo download service; (3) extend agent getSellerDetail with listing fields; (4) badge middleware wired globally for all `/agent` routes; (5) two new portal router routes + modify the portals page route; (6) all templates.

**Tech Stack:** Express, Prisma, Nunjucks, archiver (already used), HTMX, vanilla JS fetch for ZIP download.

**Spec:** `docs/superpowers/specs/2026-03-24-listing-access-design.md`

---

### Task 1: Portal repo + service — queries (TDD)

Adds four repo functions and three service functions. No router or template changes yet.

**Files:**
- Modify: `src/domains/property/portal.repository.ts`
- Modify: `src/domains/property/portal.service.ts`
- Test: `src/domains/property/__tests__/portal.service.test.ts`

**Context:** `portal.repository.ts` currently imports `import type { PortalName } from '@prisma/client'` — needs `Prisma` added for `Prisma.JsonNull`. `portal.service.ts` imports are at the top of the file. The test file mocks `'../portal.repository'`, `'@/domains/shared/settings.service'`, `'@/domains/shared/audit.service'`.

- [ ] **Step 1: Write failing tests**

Add these `describe` blocks at the bottom of the existing `describe('portal.service', ...)` in `src/domains/property/__tests__/portal.service.test.ts`:

```ts
  describe('getPortalsReadyCount', () => {
    it('passes agentId to repo and returns count', async () => {
      mockPortalRepo.countPortalsReady = jest.fn().mockResolvedValue(3);
      const result = await portalService.getPortalsReadyCount('agent-1');
      expect(result).toBe(3);
      expect(mockPortalRepo.countPortalsReady).toHaveBeenCalledWith('agent-1');
    });

    it('passes undefined for admin to see all listings', async () => {
      mockPortalRepo.countPortalsReady = jest.fn().mockResolvedValue(5);
      await portalService.getPortalsReadyCount(undefined);
      expect(mockPortalRepo.countPortalsReady).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getPortalIndex', () => {
    it('maps listing to index item with correct statuses', async () => {
      mockPortalRepo.findListingsForPortalIndex = jest.fn().mockResolvedValue([
        {
          id: 'listing-1',
          status: 'approved',
          photosApprovedAt: new Date('2026-03-01'),
          descriptionApprovedAt: new Date('2026-03-01'),
          photos: JSON.stringify([{ id: 'p1', displayOrder: 0 }]),
          property: {
            town: 'TAMPINES',
            street: 'TAMPINES ST 21',
            block: '123',
            seller: { name: 'Tan Wei Ming' },
          },
          portalListings: [
            { id: 'pl-1', status: 'posted' },
            { id: 'pl-2', status: 'ready' },
          ],
        },
      ]);

      const result = await portalService.getPortalIndex('agent-1');
      expect(result).toHaveLength(1);
      expect(result[0].photosStatus).toBe('approved');
      expect(result[0].descriptionStatus).toBe('approved');
      expect(result[0].portalsPostedCount).toBe(1);
      expect(result[0].sellerName).toBe('Tan Wei Ming');
      expect(result[0].address).toContain('TAMPINES');
    });

    it('sets photosStatus to downloaded when photos null and photosApprovedAt set', async () => {
      mockPortalRepo.findListingsForPortalIndex = jest.fn().mockResolvedValue([
        {
          id: 'listing-1',
          photosApprovedAt: new Date('2026-03-01'),
          descriptionApprovedAt: null,
          photos: null,
          property: { town: 'TAMPINES', street: 'ST 21', block: '123', seller: { name: 'Lee' } },
          portalListings: [],
        },
      ]);

      const result = await portalService.getPortalIndex();
      expect(result[0].photosStatus).toBe('downloaded');
      expect(result[0].descriptionStatus).toBe('pending');
      expect(result[0].portalsPostedCount).toBe(0);
    });
  });

  describe('getListingForPortalsPage', () => {
    it('returns parsed photos array for assigned agent', async () => {
      const photos = [{ id: 'p1', displayOrder: 0, optimizedPath: 'opt/p1.jpg', path: 'orig/p1.jpg' }];
      mockPortalRepo.findListingById = jest.fn().mockResolvedValue({
        id: 'listing-1',
        photos: JSON.stringify(photos),
        photosApprovedAt: new Date('2026-03-01'),
        property: { seller: { agentId: 'agent-1' } },
      });

      const result = await portalService.getListingForPortalsPage('listing-1', 'agent-1', 'agent');
      expect(result.photos).toHaveLength(1);
      expect(result.photos[0].id).toBe('p1');
      expect(result.photosApprovedAt).toBeTruthy();
    });

    it('throws ForbiddenError when agent not assigned', async () => {
      mockPortalRepo.findListingById = jest.fn().mockResolvedValue({
        id: 'listing-1',
        photos: null,
        photosApprovedAt: null,
        property: { seller: { agentId: 'agent-2' } },
      });

      await expect(
        portalService.getListingForPortalsPage('listing-1', 'agent-1', 'agent'),
      ).rejects.toThrow(ForbiddenError);
    });

    it('admin bypasses ownership check', async () => {
      mockPortalRepo.findListingById = jest.fn().mockResolvedValue({
        id: 'listing-1',
        photos: null,
        photosApprovedAt: null,
        property: { seller: { agentId: 'agent-2' } },
      });

      const result = await portalService.getListingForPortalsPage('listing-1', 'admin-1', 'admin');
      expect(result.photos).toHaveLength(0);
    });
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern="portal.service" --testNamePattern="getPortalsReadyCount|getPortalIndex|getListingForPortalsPage" 2>&1 | tail -20
```

Expected: FAIL — `countPortalsReady is not a function` / functions not found.

- [ ] **Step 3: Add repo functions to `portal.repository.ts`**

Add `import { Prisma } from '@prisma/client';` at line 3 (after the existing `import type { PortalName }` line).

Then append these four functions at the end of the file:

```ts
export async function countPortalsReady(agentId?: string): Promise<number> {
  return prisma.listing.count({
    where: {
      photosApprovedAt: { not: null },
      descriptionApprovedAt: { not: null },
      photos: { not: Prisma.JsonNull },
      ...(agentId ? { property: { seller: { agentId } } } : {}),
      portalListings: { some: { status: { not: 'posted' as never } } },
    },
  });
}

export async function findListingsForPortalIndex(agentId?: string) {
  return prisma.listing.findMany({
    where: {
      status: { notIn: ['archived', 'rejected'] as never[] },
      OR: [
        { photos: { not: Prisma.JsonNull } },
        { photosApprovedAt: { not: null } },
        { descriptionApprovedAt: { not: null } },
        { description: { not: null } },
      ],
      ...(agentId ? { property: { seller: { agentId } } } : {}),
    },
    select: {
      id: true,
      status: true,
      photosApprovedAt: true,
      descriptionApprovedAt: true,
      photos: true,
      property: {
        select: {
          town: true,
          street: true,
          block: true,
          seller: { select: { name: true } },
        },
      },
      portalListings: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findListingById(listingId: string) {
  return prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      photos: true,
      photosApprovedAt: true,
      property: { select: { seller: { select: { agentId: true } } } },
    },
  });
}

export async function clearListingPhotos(listingId: string) {
  return prisma.listing.update({
    where: { id: listingId },
    data: { photos: Prisma.JsonNull },
  });
}
```

- [ ] **Step 4: Add service functions to `portal.service.ts`**

Add these imports at the top of `portal.service.ts` (after the existing imports):

```ts
import type { PhotoRecord } from './property.types';
```

Then append these three service functions at the end of the file:

```ts
export async function getPortalsReadyCount(agentId?: string): Promise<number> {
  return portalRepo.countPortalsReady(agentId);
}

export type PortalIndexItem = {
  id: string;
  sellerName: string | null;
  address: string;
  photosStatus: 'approved' | 'pending' | 'downloaded';
  descriptionStatus: 'approved' | 'pending';
  portalsPostedCount: number;
};

export async function getPortalIndex(agentId?: string): Promise<PortalIndexItem[]> {
  const listings = await portalRepo.findListingsForPortalIndex(agentId);
  return listings.map((l) => {
    let photosStatus: 'approved' | 'pending' | 'downloaded';
    if (l.photosApprovedAt && !l.photos) {
      photosStatus = 'downloaded';
    } else if (l.photosApprovedAt) {
      photosStatus = 'approved';
    } else {
      photosStatus = 'pending';
    }

    return {
      id: l.id,
      sellerName: l.property.seller.name,
      address: `Blk ${l.property.block} ${l.property.street}, ${l.property.town}`,
      photosStatus,
      descriptionStatus: l.descriptionApprovedAt ? 'approved' : 'pending',
      portalsPostedCount: l.portalListings.filter((pl) => pl.status === 'posted').length,
    };
  });
}

export async function getListingForPortalsPage(
  listingId: string,
  callerAgentId: string,
  callerRole: string,
): Promise<{ id: string; photos: PhotoRecord[]; photosApprovedAt: Date | null }> {
  const listing = await portalRepo.findListingById(listingId);
  if (!listing) throw new NotFoundError('Listing', listingId);

  if (callerRole !== 'admin') {
    const assignedAgentId = listing.property?.seller?.agentId ?? null;
    if (assignedAgentId !== callerAgentId) {
      throw new ForbiddenError('You are not authorised to view this listing');
    }
  }

  const photos: PhotoRecord[] = listing.photos
    ? (() => {
        try {
          const parsed = JSON.parse(listing.photos as string);
          return Array.isArray(parsed) ? (parsed as PhotoRecord[]) : [];
        } catch {
          return [];
        }
      })()
    : [];

  return { id: listing.id, photos, photosApprovedAt: listing.photosApprovedAt };
}
```

- [ ] **Step 5: Run all portal.service tests**

```bash
npm test -- --testPathPattern="portal.service" 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domains/property/portal.repository.ts src/domains/property/portal.service.ts src/domains/property/__tests__/portal.service.test.ts
git commit -m "feat: add portal index queries and listing photo data service functions"
```

---

### Task 2: Photo download service (TDD)

Adds `downloadAndDeletePhotos` to `portal.service.ts` — reads photo files, builds ZIP buffers, deletes from disk, clears DB, audits.

**Files:**
- Modify: `src/domains/property/portal.service.ts`
- Test: `src/domains/property/__tests__/portal.service.test.ts`

**Context:** `localStorage` is at `@/infra/storage/local-storage`. Mock pattern in test files: `jest.mock('../../../infra/storage/local-storage', () => ({ localStorage: { read: jest.fn(), delete: jest.fn(), save: jest.fn() } }))`. Relative path from `portal.service.test.ts` to `local-storage` is `'../../../infra/storage/local-storage'`.

- [ ] **Step 1: Add localStorage mock to the top of `portal.service.test.ts`**

Add these lines immediately after the existing `jest.mock('@/domains/shared/audit.service');` line:

```ts
import { localStorage } from '../../../infra/storage/local-storage';

jest.mock('../../../infra/storage/local-storage', () => ({
  localStorage: {
    read: jest.fn().mockResolvedValue(Buffer.from('img-data')),
    delete: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockedStorage = jest.mocked(localStorage);
```

Also add `NotFoundError` to the existing imports line — change:
```ts
import { NotFoundError, ForbiddenError } from '@/domains/shared/errors';
```
to (it should already be there; if not, add it).

- [ ] **Step 2: Write failing tests**

Add inside the existing `describe('portal.service', ...)` block:

```ts
  describe('downloadAndDeletePhotos', () => {
    const photos = [
      {
        id: 'p1',
        displayOrder: 0,
        filename: 'p1.jpg',
        originalFilename: 'living-room.jpg',
        path: 'photos/s1/prop1/original/p1.jpg',
        optimizedPath: 'photos/s1/prop1/optimized/p1.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100000,
        width: 1200,
        height: 800,
        status: 'approved',
        uploadedAt: new Date(),
      },
    ];

    beforeEach(() => {
      mockPortalRepo.findListingById = jest.fn();
      mockPortalRepo.clearListingPhotos = jest.fn().mockResolvedValue({} as never);
      mockedStorage.read.mockResolvedValue(Buffer.from('img-data'));
      mockedStorage.delete.mockResolvedValue(undefined);
    });

    it('returns file buffers and deletes both optimized and original paths', async () => {
      mockPortalRepo.findListingById.mockResolvedValue({
        id: 'listing-1',
        photos: JSON.stringify(photos),
        photosApprovedAt: new Date(),
        property: { seller: { agentId: 'agent-1' } },
      });

      const result = await portalService.downloadAndDeletePhotos('listing-1', 'agent-1', 'agent');

      expect(result.files).toHaveLength(1);
      expect(result.files[0].filename).toContain('p1');
      expect(mockedStorage.read).toHaveBeenCalledWith('photos/s1/prop1/optimized/p1.jpg');
      expect(mockedStorage.delete).toHaveBeenCalledWith('photos/s1/prop1/optimized/p1.jpg');
      expect(mockedStorage.delete).toHaveBeenCalledWith('photos/s1/prop1/original/p1.jpg');
    });

    it('clears photos from DB and logs audit', async () => {
      mockPortalRepo.findListingById.mockResolvedValue({
        id: 'listing-1',
        photos: JSON.stringify(photos),
        photosApprovedAt: new Date(),
        property: { seller: { agentId: 'agent-1' } },
      });

      await portalService.downloadAndDeletePhotos('listing-1', 'agent-1', 'agent');

      expect(mockPortalRepo.clearListingPhotos).toHaveBeenCalledWith('listing-1');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'listing_photos.downloaded_and_deleted' }),
      );
    });

    it('throws ForbiddenError when agent not assigned to listing', async () => {
      mockPortalRepo.findListingById.mockResolvedValue({
        id: 'listing-1',
        photos: JSON.stringify(photos),
        photosApprovedAt: new Date(),
        property: { seller: { agentId: 'agent-2' } },
      });

      await expect(
        portalService.downloadAndDeletePhotos('listing-1', 'agent-1', 'agent'),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when listing photos is null', async () => {
      mockPortalRepo.findListingById.mockResolvedValue({
        id: 'listing-1',
        photos: null,
        photosApprovedAt: new Date(),
        property: { seller: { agentId: 'agent-1' } },
      });

      await expect(
        portalService.downloadAndDeletePhotos('listing-1', 'agent-1', 'agent'),
      ).rejects.toThrow(NotFoundError);
    });

    it('admin bypasses ownership check', async () => {
      mockPortalRepo.findListingById.mockResolvedValue({
        id: 'listing-1',
        photos: JSON.stringify(photos),
        photosApprovedAt: new Date(),
        property: { seller: { agentId: 'agent-2' } },
      });

      const result = await portalService.downloadAndDeletePhotos('listing-1', 'admin-1', 'admin');
      expect(result.files).toHaveLength(1);
    });
  });
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern="portal.service" --testNamePattern="downloadAndDeletePhotos" 2>&1 | tail -20
```

Expected: FAIL — `downloadAndDeletePhotos is not a function`.

- [ ] **Step 4: Add import and implement `downloadAndDeletePhotos` in `portal.service.ts`**

Add this import at the top (after the `PhotoRecord` import added in Task 1):

```ts
import { localStorage } from '@/infra/storage/local-storage';
```

Then append the function at the end of `portal.service.ts`:

```ts
export async function downloadAndDeletePhotos(
  listingId: string,
  callerAgentId: string,
  callerRole: string,
): Promise<{ files: { buffer: Buffer; filename: string }[] }> {
  const listing = await portalRepo.findListingById(listingId);
  if (!listing) throw new NotFoundError('Listing', listingId);

  if (callerRole !== 'admin') {
    const assignedAgentId = listing.property?.seller?.agentId ?? null;
    if (assignedAgentId !== callerAgentId) {
      throw new ForbiddenError('You are not authorised to manage this listing');
    }
  }

  if (!listing.photos) throw new NotFoundError('Photos', listingId);

  const photos = JSON.parse(listing.photos as string) as PhotoRecord[];
  const files: { buffer: Buffer; filename: string }[] = [];

  for (const photo of photos) {
    const buffer = await localStorage.read(photo.optimizedPath);
    files.push({ buffer, filename: `photo-${photo.displayOrder + 1}-${photo.id}.jpg` });
  }

  for (const photo of photos) {
    await localStorage.delete(photo.optimizedPath);
    await localStorage.delete(photo.path);
  }

  await portalRepo.clearListingPhotos(listingId);

  await auditService.log({
    agentId: callerAgentId,
    action: 'listing_photos.downloaded_and_deleted',
    entityType: 'listing',
    entityId: listingId,
    details: { photoCount: photos.length },
  });

  return { files };
}
```

- [ ] **Step 5: Run all portal.service tests**

```bash
npm test -- --testPathPattern="portal.service" 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domains/property/portal.service.ts src/domains/property/__tests__/portal.service.test.ts
git commit -m "feat: add downloadAndDeletePhotos to portal.service"
```

---

### Task 3: Extend agent getSellerDetail with listing fields (TDD)

Updates `SellerDetail` type + repo query + service mapping to expose `photoCount`, `portalsPostedCount`, `photosApprovedAt`, `descriptionApprovedAt`.

**Files:**
- Modify: `src/domains/agent/agent.types.ts` (lines 133-138)
- Modify: `src/domains/agent/agent.repository.ts` (lines 263-268 — the listings include)
- Modify: `src/domains/agent/agent.service.ts` (lines 136-143 — the listing mapping)
- Test: `src/domains/agent/__tests__/agent.service.test.ts`

**Context:** `SellerDetail.property.listing` is currently typed as `{ id, status, title, description } | null` (agent.types.ts line 133-138). The repo query at line 266 uses `listings: { take: 1, orderBy: { createdAt: 'desc' } }` — a full include with no `select`. The service maps at lines 136-143.

- [ ] **Step 1: Write failing test**

Add this test inside the existing `describe('getSellerDetail', ...)` block in `src/domains/agent/__tests__/agent.service.test.ts`:

```ts
    it('includes photoCount, portalsPostedCount, photosApprovedAt, descriptionApprovedAt in listing', async () => {
      const photoRecords = [{ id: 'p1', displayOrder: 0 }, { id: 'p2', displayOrder: 1 }];
      mockRepo.getSellerDetail.mockResolvedValue({
        id: 'seller-1',
        name: 'John Tan',
        email: null,
        phone: '91234567',
        countryCode: '+65',
        nationalNumber: '91234567',
        emailVerified: true,
        passwordHash: 'hash',
        sellingTimeline: null,
        sellingReason: null,
        sellingReasonOther: null,
        status: 'active',
        leadSource: null,
        agentId: 'agent-1',
        onboardingStep: 5,
        consentService: true,
        consentMarketing: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        saleProceeds: null,
        properties: [
          {
            id: 'prop-1',
            town: 'TAMPINES',
            street: 'TAMPINES ST 21',
            block: '123',
            flatType: '4 ROOM',
            level: '07',
            unitNumber: '123',
            floorAreaSqm: 93,
            leaseCommenceDate: 1995,
            askingPrice: null,
            priceHistory: null,
            status: 'active',
            listings: [
              {
                id: 'listing-1',
                status: 'approved',
                title: 'Great flat',
                description: 'Nice place',
                photos: JSON.stringify(photoRecords),
                photosApprovedAt: new Date('2026-03-01'),
                descriptionApprovedAt: new Date('2026-03-01'),
                portalListings: [
                  { id: 'pl-1', status: 'posted' },
                  { id: 'pl-2', status: 'ready' },
                  { id: 'pl-3', status: 'ready' },
                ],
              },
            ],
          },
        ],
      } as unknown as Awaited<ReturnType<typeof agentRepo.getSellerDetail>>);

      const result = await agentService.getSellerDetail('seller-1', 'agent-1');

      expect(result.property?.listing?.photoCount).toBe(2);
      expect(result.property?.listing?.portalsPostedCount).toBe(1);
      expect(result.property?.listing?.photosApprovedAt).toEqual(new Date('2026-03-01'));
      expect(result.property?.listing?.descriptionApprovedAt).toEqual(new Date('2026-03-01'));
    });
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --testPathPattern="agent.service" --testNamePattern="photoCount" 2>&1 | tail -20
```

Expected: FAIL — `photoCount` is `undefined` (not in the service mapping yet).

- [ ] **Step 3: Update `agent.types.ts` listing type**

In `src/domains/agent/agent.types.ts`, change the `listing` type inside `property` (lines 133-138) from:

```ts
    listing: {
      id: string;
      status: string;
      title: string | null;
      description: string | null;
    } | null;
```

to:

```ts
    listing: {
      id: string;
      status: string;
      title: string | null;
      description: string | null;
      photosApprovedAt: Date | null;
      descriptionApprovedAt: Date | null;
      photoCount: number | null;
      portalsPostedCount: number;
    } | null;
```

- [ ] **Step 4: Update `agent.repository.ts` — switch listing include to explicit select**

In `src/domains/agent/agent.repository.ts`, change (around line 266):

```ts
          listings: { take: 1, orderBy: { createdAt: 'desc' } },
```

to:

```ts
          listings: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              status: true,
              title: true,
              description: true,
              photos: true,
              photosApprovedAt: true,
              descriptionApprovedAt: true,
              portalListings: { select: { id: true, status: true } },
            },
          },
```

- [ ] **Step 5: Update `agent.service.ts` — extend listing mapping**

In `src/domains/agent/agent.service.ts`, change the `listing:` block (lines 136-143) from:

```ts
          listing: property.listings[0]
            ? {
                id: property.listings[0].id,
                status: property.listings[0].status,
                title: property.listings[0].title,
                description: property.listings[0].description,
              }
            : null,
```

to:

```ts
          listing: property.listings[0]
            ? {
                id: property.listings[0].id,
                status: property.listings[0].status,
                title: property.listings[0].title,
                description: property.listings[0].description,
                photosApprovedAt: property.listings[0].photosApprovedAt,
                descriptionApprovedAt: property.listings[0].descriptionApprovedAt,
                photoCount: (() => {
                  if (!property.listings[0].photos) return null;
                  try {
                    const parsed = JSON.parse(property.listings[0].photos as string);
                    return Array.isArray(parsed) ? parsed.length : null;
                  } catch {
                    return null;
                  }
                })(),
                portalsPostedCount: property.listings[0].portalListings.filter(
                  (pl) => pl.status === 'posted',
                ).length,
              }
            : null,
```

- [ ] **Step 6: Run all agent.service tests**

```bash
npm test -- --testPathPattern="agent.service" 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domains/agent/agent.types.ts src/domains/agent/agent.repository.ts src/domains/agent/agent.service.ts src/domains/agent/__tests__/agent.service.test.ts
git commit -m "feat: extend getSellerDetail listing with photoCount, portalsPostedCount, approval timestamps"
```

---

### Task 4: Portals-badge middleware

Injects `portalsReadyCount` into `res.locals` on every `/agent/*` request so the sidebar badge works everywhere.

**Files:**
- Create: `src/infra/http/middleware/portals-badge.ts`
- Modify: `src/infra/http/app.ts`

**Context:** The app.ts registers routes at lines 190–212. Auth (passport) runs as part of `app.use(session(...))` + `app.use(passport.initialize())` setup earlier in the file, so `req.user` is populated by the time any route middleware runs. No unit test needed — it's a thin adapter.

- [ ] **Step 1: Create `src/infra/http/middleware/portals-badge.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import * as portalService from '@/domains/property/portal.service';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

/**
 * Injects portalsReadyCount into res.locals for all /agent pages.
 * Used by the agent sidebar to show the Portals nav badge.
 * Non-fatal: if the query fails, the badge simply won't show.
 */
export async function portalsReadyBadgeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user as AuthenticatedUser | undefined;
    if (user) {
      const agentId = user.role === 'admin' ? undefined : user.id;
      res.locals.portalsReadyCount = await portalService.getPortalsReadyCount(agentId);
    }
  } catch {
    // Non-fatal — badge simply won't show
  }
  next();
}
```

- [ ] **Step 2: Register middleware in `src/infra/http/app.ts`**

Add this import near the top of `app.ts` with the other middleware imports:

```ts
import { portalsReadyBadgeMiddleware } from '../../infra/http/middleware/portals-badge';
```

Then add this line just before `app.use(agentRouter);` (line 207 in the current file):

```ts
  // Portals badge — inject portalsReadyCount into res.locals for all /agent pages
  app.use('/agent', portalsReadyBadgeMiddleware);
```

- [ ] **Step 3: Build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error TS" | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/infra/http/middleware/portals-badge.ts src/infra/http/app.ts
git commit -m "feat: inject portalsReadyCount into res.locals for agent sidebar badge"
```

---

### Task 5: Portal router — new routes + portals page update

Adds `GET /agent/portals` index route, `POST /agent/listings/:listingId/photos/download-all` download route, and modifies the portals page route to also pass listing photo data.

**Files:**
- Modify: `src/domains/property/portal.router.ts`

**Context:** The router currently has three routes (lines 15, 46, 70). `archiver` is NOT currently imported in portal.router.ts — it's imported in agent.router.ts. Add it here. The `getAgentFilter` helper (returns `undefined` for admin, `user.id` for agent) is not in portal.router.ts — implement it inline.

- [ ] **Step 1: Add imports to `portal.router.ts`**

Change the imports block at the top of `src/domains/property/portal.router.ts` from:

```ts
// src/domains/property/portal.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import * as portalService from './portal.service';
import * as photoService from './photo.service';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { getHasAvatar } from '../profile/profile.service';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
```

to:

```ts
// src/domains/property/portal.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import * as portalService from './portal.service';
import * as photoService from './photo.service';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { getHasAvatar } from '../profile/profile.service';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import archiver from 'archiver';
```

- [ ] **Step 2: Add `getAgentFilter` helper and `GET /agent/portals` index route**

Add these immediately after the `const agentAuth = [...]` line (after line 12):

```ts
function getAgentFilter(user: AuthenticatedUser): string | undefined {
  return user.role === 'admin' ? undefined : user.id;
}

// GET /agent/portals — portals index (all active listings)
portalRouter.get(
  '/agent/portals',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const listings = await portalService.getPortalIndex(getAgentFilter(user));

      if (req.headers['hx-request']) {
        return res.render('partials/agent/portals-index-table.njk', { listings });
      }
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/portals-index', {
        pageTitle: 'Portal Listings',
        user,
        hasAvatar,
        listings,
      });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 3: Update `GET /agent/listings/:listingId/portals` to also fetch listing photo data**

Change the existing portals page route handler (lines 15-43) from:

```ts
portalRouter.get(
  '/agent/listings/:listingId/portals',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { listingId } = req.params;
      const portalListings = await portalService.getPortalListings(
        listingId as string,
        user.id,
        user.role,
      );

      if (req.headers['hx-request']) {
        return res.render('partials/agent/portal-panels', { portalListings, listingId });
      }
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/portals', {
        pageTitle: 'Portals',
        user,
        hasAvatar,
        portalListings,
        listingId,
      });
    } catch (err) {
      next(err);
    }
  },
);
```

to:

```ts
portalRouter.get(
  '/agent/listings/:listingId/portals',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { listingId } = req.params as { listingId: string };

      const [portalListings, listingData] = await Promise.all([
        portalService.getPortalListings(listingId, user.id, user.role),
        portalService.getListingForPortalsPage(listingId, user.id, user.role),
      ]);

      if (req.headers['hx-request']) {
        return res.render('partials/agent/portal-panels', { portalListings, listingId });
      }
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/portals', {
        pageTitle: 'Portal Listings',
        user,
        hasAvatar,
        portalListings,
        listingData,
        listingId,
      });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 4: Add `POST /agent/listings/:listingId/photos/download-all`**

Add this route after the portals page route and before the `GET /agent/listings/:listingId/photos/:photoId` route:

```ts
// POST /agent/listings/:listingId/photos/download-all — download all approved photos as ZIP, then delete
portalRouter.post(
  '/agent/listings/:listingId/photos/download-all',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { listingId } = req.params as { listingId: string };

      const { files } = await portalService.downloadAndDeletePhotos(
        listingId,
        user.id,
        user.role,
      );

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="photos-${listingId}.zip"`);
      res.setHeader('Cache-Control', 'no-store');

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);
      for (const file of files) {
        archive.append(file.buffer, { name: file.filename });
      }
      await archive.finalize();
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 5: Build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error TS" | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/domains/property/portal.router.ts
git commit -m "feat: add portals index route, photo download-all route, pass listingData to portals page"
```

---

### Task 6: Templates

All template additions and modifications. No tests (presentation only) — verify with `npm run build` after each file.

**Files:**
- Create: `src/views/pages/agent/portals-index.njk`
- Create: `src/views/partials/agent/portals-index-table.njk`
- Create: `src/views/partials/agent/portal-photos.njk`
- Modify: `src/views/pages/agent/portals.njk`
- Create: `src/views/partials/agent/seller-listing-card.njk`
- Modify: `src/views/pages/agent/seller-detail.njk`
- Modify: `src/views/layouts/agent.njk`

**Context:**
- All pages extend `layouts/agent.njk` which extends `layouts/base.njk`.
- `base.njk` has `{% block scripts %}{% endblock %}` after the app.js script tag (added in a prior feature).
- The `card` CSS class is used for cards on seller-detail.
- `page-section-title` class for card headings.
- `csrfToken` is available in all templates via `res.locals`.
- `cspNonce` is available in all templates via `res.locals`.

- [ ] **Step 1: Create `src/views/pages/agent/portals-index.njk`**

```njk
{# pages/agent/portals-index.njk #}
{% extends "layouts/agent.njk" %}

{% block content %}
<div class="max-w-5xl mx-auto">
  {% set pageSubtitle = "Active listings ready for portal posting" %}
  {% include "partials/shared/page-header.njk" %}
  <div id="portals-index-table">
    {% include "partials/agent/portals-index-table.njk" %}
  </div>
</div>
{% endblock %}
```

- [ ] **Step 2: Create `src/views/partials/agent/portals-index-table.njk`**

```njk
{# partials/agent/portals-index-table.njk — HTMX-swappable table of portal listings #}
{% if listings | length == 0 %}
<div class="text-center py-16 text-gray-400">
  <p class="text-lg">{{ "No listings ready for portal posting." | t }}</p>
</div>
{% else %}
<div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
  <table class="w-full text-sm">
    <thead class="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
      <tr>
        <th class="px-4 py-3">{{ "Seller" | t }}</th>
        <th class="px-4 py-3">{{ "Property" | t }}</th>
        <th class="px-4 py-3">{{ "Photos" | t }}</th>
        <th class="px-4 py-3">{{ "Description" | t }}</th>
        <th class="px-4 py-3">{{ "Portals" | t }}</th>
        <th class="px-4 py-3"></th>
      </tr>
    </thead>
    <tbody class="divide-y divide-gray-100">
      {% for item in listings %}
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 font-medium text-gray-900">{{ item.sellerName or "—" }}</td>
        <td class="px-4 py-3 text-gray-600 truncate max-w-xs">{{ item.address }}</td>
        <td class="px-4 py-3">
          {% if item.photosStatus == 'approved' %}
          <span class="text-xs px-2 py-1 rounded-full bg-green-100 text-green-800">{{ "✓ Approved" | t }}</span>
          {% elif item.photosStatus == 'downloaded' %}
          <span class="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-500">{{ "Downloaded" | t }}</span>
          {% else %}
          <span class="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-800">{{ "Pending" | t }}</span>
          {% endif %}
        </td>
        <td class="px-4 py-3">
          {% if item.descriptionStatus == 'approved' %}
          <span class="text-xs px-2 py-1 rounded-full bg-green-100 text-green-800">{{ "✓ Approved" | t }}</span>
          {% else %}
          <span class="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-800">{{ "Pending" | t }}</span>
          {% endif %}
        </td>
        <td class="px-4 py-3 text-gray-500 text-xs">{{ item.portalsPostedCount }} / 3</td>
        <td class="px-4 py-3">
          <a href="/agent/listings/{{ item.id }}/portals"
             class="text-purple-600 hover:underline text-xs font-medium">{{ "Open →" | t }}</a>
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
  <div class="px-4 py-2 text-xs text-gray-500">{{ listings | length }} {{ "listings" | t }}</div>
</div>
{% endif %}
```

- [ ] **Step 3: Create `src/views/partials/agent/portal-photos.njk`**

```njk
{# partials/agent/portal-photos.njk — listing photos panel on portals page #}
{# Requires: listingData.id, listingData.photos (array), listingData.photosApprovedAt #}
<div class="bg-white rounded-xl border border-slate-200 p-6 mb-4" id="portal-photos-panel">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-sm font-semibold text-gray-900">{{ "Listing Photos" | t }}</h2>
    {% if listingData.photos | length > 0 %}
    <span class="text-xs text-gray-500">{{ listingData.photos | length }} {{ "photos" | t }}</span>
    {% endif %}
  </div>

  {% if listingData.photosApprovedAt and listingData.photos | length == 0 %}
  {# Downloaded state: photosApprovedAt set but photos deleted from DB #}
  <p class="text-sm text-gray-500 italic">{{ "Photos have been downloaded and deleted." | t }}</p>

  {% elif listingData.photos | length > 0 %}
  {# Photos present — show thumbnails and download button #}
  <div class="grid grid-cols-4 gap-2 mb-4">
    {% for photo in listingData.photos %}
    {% if loop.index <= 8 %}
    <div class="relative">
      <img src="/agent/listings/{{ listingData.id }}/photos/{{ photo.id }}"
           alt="{{ photo.originalFilename }}"
           class="w-full h-20 object-cover rounded border">
      {% if loop.first %}
      <span class="absolute top-1 left-1 bg-yellow-400 text-yellow-900 text-xs font-semibold px-2 py-0.5 rounded-full">{{ "Cover" | t }}</span>
      {% endif %}
    </div>
    {% endif %}
    {% endfor %}
  </div>
  <form id="photos-download-form"
        action="/agent/listings/{{ listingData.id }}/photos/download-all"
        method="POST">
    <input type="hidden" name="_csrf" value="{{ csrfToken }}">
    <button type="submit" id="photos-download-btn"
            class="w-full bg-purple-600 text-white py-2 rounded font-medium hover:bg-purple-700 text-sm">
      {{ "⬇ Download All & Delete" | t }}
    </button>
  </form>

  {% else %}
  {# No photos uploaded or awaiting approval #}
  <p class="text-sm text-yellow-700 bg-yellow-50 px-3 py-2 rounded">
    {% if listingData.photosApprovedAt %}
    {{ "No photos found." | t }}
    {% else %}
    {{ "Awaiting photo approval." | t }}
    {% endif %}
  </p>
  {% endif %}
</div>
```

- [ ] **Step 4: Modify `src/views/pages/agent/portals.njk`**

Change from:

```njk
{# pages/agent/portals.njk #}
{% extends "layouts/agent.njk" %}
{% block content %}
<div class="portals-page">
  {% set pageTitle = "Portal Listings" %}
  {% set pageSubtitle = "Copy content for each portal below. Post manually, then paste the live URL back." %}
  {% include "partials/shared/page-header.njk" %}
  {% for portalListing in portalListings %}
    {% include "partials/agent/portal-panel.njk" %}
  {% endfor %}
</div>
{% endblock %}
```

to:

```njk
{# pages/agent/portals.njk #}
{% extends "layouts/agent.njk" %}

{% block content %}
<div class="portals-page">
  {% set pageTitle = "Portal Listings" %}
  {% set pageSubtitle = "Copy content for each portal below. Post manually, then paste the live URL back." %}
  {% include "partials/shared/page-header.njk" %}
  {% include "partials/agent/portal-photos.njk" %}
  {% for portalListing in portalListings %}
    {% include "partials/agent/portal-panel.njk" %}
  {% endfor %}
</div>
{% endblock %}

{% block scripts %}
<script nonce="{{ cspNonce }}">
(function () {
  var form = document.getElementById('photos-download-form');
  if (!form) return;
  var btn = document.getElementById('photos-download-btn');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = '{{ "Downloading…" | t }}';
    var csrfToken = form.querySelector('[name="_csrf"]').value;
    fetch(form.action, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
      credentials: 'same-origin',
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Download failed ' + res.status);
        var cd = res.headers.get('content-disposition') || '';
        var match = cd.match(/filename="?([^"]+)"?/);
        var filename = match ? match[1] : 'photos.zip';
        return res.blob().then(function (blob) { return { blob: blob, filename: filename }; });
      })
      .then(function (result) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(result.blob);
        a.download = result.filename;
        a.click();
        URL.revokeObjectURL(a.href);
        window.location.reload();
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = '{{ "⬇ Download All & Delete" | t }}';
      });
  });
})();
</script>
{% endblock %}
```

- [ ] **Step 5: Create `src/views/partials/agent/seller-listing-card.njk`**

```njk
{# partials/agent/seller-listing-card.njk — listing status card on seller-detail page #}
{% if seller.property and seller.property.listing %}
{% set listing = seller.property.listing %}
<div class="card">
  <h2 class="page-section-title">{{ "Listing" | t }}</h2>
  <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
    <div>
      <dt class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{{ "Photos" | t }}</dt>
      <dd>
        {% if listing.photosApprovedAt and not listing.photoCount %}
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">{{ "Downloaded" | t }}</span>
        {% elif listing.photosApprovedAt and listing.photoCount %}
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800">✓ {{ "Approved" | t }} · {{ listing.photoCount }} {{ "photos" | t }}</span>
        {% else %}
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800">{{ "Pending" | t }}</span>
        {% endif %}
      </dd>
    </div>
    <div>
      <dt class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{{ "Description" | t }}</dt>
      <dd>
        {% if listing.descriptionApprovedAt %}
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800">✓ {{ "Approved" | t }}</span>
        {% else %}
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800">{{ "Pending" | t }}</span>
        {% endif %}
      </dd>
    </div>
    <div>
      <dt class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{{ "Status" | t }}</dt>
      <dd class="text-gray-700">{{ listing.status }}</dd>
    </div>
    <div>
      <dt class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{{ "Portals" | t }}</dt>
      <dd class="text-gray-700">{{ listing.portalsPostedCount }} / 3 {{ "posted" | t }}</dd>
    </div>
  </dl>
  <div class="mt-4 pt-4 border-t border-gray-100">
    <a href="/agent/listings/{{ listing.id }}/portals"
       class="inline-block bg-purple-600 text-white text-sm px-4 py-2 rounded font-medium hover:bg-purple-700">
      {{ "Go to Portals →" | t }}
    </a>
  </div>
</div>
{% endif %}
```

- [ ] **Step 6: Modify `src/views/pages/agent/seller-detail.njk`**

Add the listing card immediately after the Seller Documents card (after the closing `</div>` of the documents card, around line 91):

Change:
```njk
  {# 2. Seller Documents #}
  <div class="card" id="seller-documents-card">
    {% include "partials/agent/seller-documents-inline.njk" %}
  </div>

  {# 3. Transaction Timeline #}
```

to:

```njk
  {# 2. Seller Documents #}
  <div class="card" id="seller-documents-card">
    {% include "partials/agent/seller-documents-inline.njk" %}
  </div>

  {# 3. Listing #}
  {% include "partials/agent/seller-listing-card.njk" %}

  {# 4. Transaction Timeline #}
```

Also update the Transaction Timeline and following card comments from `{# 3.`, `{# 3.`, etc. to `{# 4.`, `{# 5.`, etc. to keep numbering consistent.

- [ ] **Step 7: Modify `src/views/layouts/agent.njk` — add Portals nav entry**

In `agent.njk`, add the Portals nav link immediately after the closing `</a>` of the Reviews nav link and before the `<div class="sidebar-divider ...">` separator (around lines 25-27):

Change:
```njk
      <a href="/agent/reviews" ...>...</a>
      <div class="sidebar-divider border-t border-white/10 my-2"></div>
      <a href="/agent/settings" ...>...
```

to:

```njk
      <a href="/agent/reviews" title="{{ 'Reviews' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/agent/reviews' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('clipboard-document-check') }}<span class="sidebar-tooltip">{{ "Reviews" | t }}</span><span class="sidebar-label">{{ "Reviews" | t }}</span>
        {% if pendingReviewCount %}<span class="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full flex-shrink-0">{{ pendingReviewCount }}</span>{% endif %}
      </a>
      <a href="/agent/portals" title="{{ 'Portals' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/agent/portals' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('building-storefront') }}<span class="sidebar-tooltip">{{ "Portals" | t }}</span><span class="sidebar-label">{{ "Portals" | t }}</span>
        {% if portalsReadyCount %}<span class="ml-auto bg-purple-500 text-white text-xs px-2 py-0.5 rounded-full flex-shrink-0">{{ portalsReadyCount }}</span>{% endif %}
      </a>
      <div class="sidebar-divider border-t border-white/10 my-2"></div>
      <a href="/agent/settings" ...
```

**Important:** Keep the existing Reviews `<a>` tag exactly as it is — only add the new Portals `<a>` tag after it. Do not modify the Reviews entry.

- [ ] **Step 8: Build to confirm no errors**

```bash
npm run build 2>&1 | grep -E "error|Error" | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 9: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all passing (same count as before this feature — no new failures).

- [ ] **Step 10: Commit**

```bash
git add src/views/pages/agent/portals-index.njk src/views/partials/agent/portals-index-table.njk src/views/partials/agent/portal-photos.njk src/views/pages/agent/portals.njk src/views/partials/agent/seller-listing-card.njk src/views/pages/agent/seller-detail.njk src/views/layouts/agent.njk
git commit -m "feat: add portals index page, portal photos panel, and listing card on seller-detail"
```
