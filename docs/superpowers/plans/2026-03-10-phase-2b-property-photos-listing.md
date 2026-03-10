# Phase 2B: Property Domain + Photo Upload + Listing — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the property domain with CRUD operations, photo upload with `sharp` image processing, listing state machine, price change logic, and connect onboarding wizard Step 2 to a real Property record.

**Architecture:** New `src/domains/property/` domain module following the project's standard pattern (types → repository → service → validator → router). Photo upload uses `multer` for multipart handling and `sharp` for image processing/validation. Listing has a state machine: `draft → pending_review → approved → live → paused → closed`. Price changes on live listings auto-revert to `pending_review`. Onboarding Step 2 creates/updates a real Property record instead of the current stub.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Tailwind CSS, multer, sharp, Jest, Supertest

**Spec:** `docs/superpowers/specs/2026-03-10-phase-2-seller-dashboard-design.md` (Sub-project 2B section, lines 94–137)

**Depends on:** Phase 2A (`feat/phase-2a-dashboard-onboarding` branch) — seller domain, dashboard shell, onboarding wizard

---

## File Structure

### New files (property domain)
- `src/domains/property/property.types.ts` — Types, enums, listing state machine transitions
- `src/domains/property/property.repository.ts` — Property + Listing CRUD, price history append
- `src/domains/property/property.service.ts` — Business logic: create/update property, price change, listing management
- `src/domains/property/photo.service.ts` — Photo upload, validation, sharp processing, reordering
- `src/domains/property/property.validator.ts` — express-validator chains for property + photo inputs
- `src/domains/property/property.router.ts` — Seller-facing routes for property + photos
- `src/domains/property/__tests__/property.repository.test.ts`
- `src/domains/property/__tests__/property.service.test.ts`
- `src/domains/property/__tests__/photo.service.test.ts`
- `src/domains/property/__tests__/property.router.test.ts`

### New views
- `src/views/pages/seller/property.njk` — Property details page
- `src/views/pages/seller/photos.njk` — Photo management page
- `src/views/partials/seller/property-form.njk` — Property edit form (HTMX)
- `src/views/partials/seller/photo-grid.njk` — Photo gallery with drag-and-drop
- `src/views/partials/seller/photo-upload-area.njk` — Upload dropzone

### Modified files
- `src/views/partials/seller/onboarding-step-2.njk` — Replace stub with real property form
- `src/domains/seller/seller.router.ts` — Wire onboarding step 2 to property service
- `src/domains/seller/seller.service.ts` — Add step 2 data handling
- `src/infra/http/app.ts` — Register property router
- `tests/fixtures/factory.ts` — Add listing factory, videoTutorial factory

---

## Chunk 1: Install Dependencies + Property Domain Types

### Task 1: Install multer for file upload handling

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install multer and its types**

Run:
```bash
npm install multer && npm install -D @types/multer
```

Expected: Packages installed successfully.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install multer for file upload handling"
```

---

### Task 2: Create property domain types

**Files:**
- Create: `src/domains/property/property.types.ts`

- [ ] **Step 1: Create the types file**

```typescript
import type { Property, Listing, Decimal } from '@prisma/client';

// ─── Listing State Machine ────────────────────────────────

export const LISTING_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_review'],
  pending_review: ['approved', 'draft'],
  approved: ['live', 'draft'],
  live: ['paused', 'pending_review', 'closed'],
  paused: ['live', 'closed'],
  closed: [],
};

export function canTransitionListing(from: string, to: string): boolean {
  return LISTING_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Photo Types ──────────────────────────────────────────

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
}

export type PhotoStatus = 'uploaded' | 'pending_review' | 'approved' | 'rejected';

export const MAX_PHOTOS = 20;
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const MIN_DIMENSION_PX = 800;
export const MAX_DIMENSION_PX = 2000;
export const JPEG_QUALITY = 80;
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'] as const;

// ─── Property Types ───────────────────────────────────────

export interface CreatePropertyInput {
  sellerId: string;
  town: string;
  street: string;
  block: string;
  flatType: string;
  storeyRange: string;
  floorAreaSqm: number;
  flatModel: string;
  leaseCommenceDate: number;
  remainingLease?: string;
  askingPrice?: number;
}

export interface UpdatePropertyInput {
  town?: string;
  street?: string;
  block?: string;
  flatType?: string;
  storeyRange?: string;
  floorAreaSqm?: number;
  flatModel?: string;
  leaseCommenceDate?: number;
  remainingLease?: string;
  askingPrice?: number;
}

export interface PriceHistoryEntry {
  price: number;
  changedAt: string;
  changedBy: string;
}

export interface PropertyWithListing extends Property {
  listings: Listing[];
}

// ─── HDB Reference Data ──────────────────────────────────

export const HDB_TOWNS = [
  'ANG MO KIO', 'BEDOK', 'BISHAN', 'BUKIT BATOK', 'BUKIT MERAH',
  'BUKIT PANJANG', 'BUKIT TIMAH', 'CENTRAL AREA', 'CHOA CHU KANG',
  'CLEMENTI', 'GEYLANG', 'HOUGANG', 'JURONG EAST', 'JURONG WEST',
  'KALLANG/WHAMPOA', 'MARINE PARADE', 'PASIR RIS', 'PUNGGOL',
  'QUEENSTOWN', 'SEMBAWANG', 'SENGKANG', 'SERANGOON', 'TAMPINES',
  'TOA PAYOH', 'WOODLANDS', 'YISHUN',
] as const;

export const HDB_FLAT_TYPES = [
  '1 ROOM', '2 ROOM', '3 ROOM', '4 ROOM', '5 ROOM',
  'EXECUTIVE', 'MULTI-GENERATION',
] as const;

export const HDB_FLAT_MODELS = [
  'Improved', 'New Generation', 'Model A', 'Standard', 'Simplified',
  'Model A2', 'DBSS', 'Type S1', 'Type S2', 'Adjoined flat',
  'Terrace', 'Premium Apartment', 'Maisonette', 'Multi Generation',
  'Premium Apartment Loft', 'Improved-Maisonette', 'Premium Maisonette',
  '2-room', '3Gen',
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/property/property.types.ts
git commit -m "feat(property): add property domain types with listing state machine"
```

---

## Chunk 2: Property Repository (TDD)

### Task 3: Create property repository with tests

**Files:**
- Create: `src/domains/property/__tests__/property.repository.test.ts`
- Create: `src/domains/property/property.repository.ts`

- [ ] **Step 1: Write failing tests for property repository**

Create `src/domains/property/__tests__/property.repository.test.ts`:

```typescript
import { propertyRepo } from '../property.repository';

// Mock Prisma
const prisma = {
  property: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
  },
  listing: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock('../../../infra/database/prisma', () => ({
  prisma,
}));

jest.mock('@paralleldrive/cuid2', () => ({
  createId: () => 'test-id-123',
}));

describe('propertyRepo', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('creates a property with correct data', async () => {
      const input = {
        sellerId: 'seller-1',
        town: 'TAMPINES',
        street: 'TAMPINES ST 21',
        block: '123',
        flatType: '4 ROOM',
        storeyRange: '07 TO 09',
        floorAreaSqm: 92,
        flatModel: 'Model A',
        leaseCommenceDate: 2000,
      };
      prisma.property.create.mockResolvedValue({ id: 'test-id-123', ...input });

      const result = await propertyRepo.create(input);

      expect(result.id).toBe('test-id-123');
      expect(prisma.property.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'test-id-123',
          sellerId: 'seller-1',
          town: 'TAMPINES',
          priceHistory: '[]',
        }),
      });
    });
  });

  describe('findByIdWithListings', () => {
    it('returns property with listings', async () => {
      const mockProperty = { id: 'p1', listings: [] };
      prisma.property.findUnique.mockResolvedValue(mockProperty);

      const result = await propertyRepo.findByIdWithListings('p1');

      expect(result).toEqual(mockProperty);
      expect(prisma.property.findUnique).toHaveBeenCalledWith({
        where: { id: 'p1' },
        include: { listings: true },
      });
    });

    it('returns null when not found', async () => {
      prisma.property.findUnique.mockResolvedValue(null);
      const result = await propertyRepo.findByIdWithListings('missing');
      expect(result).toBeNull();
    });
  });

  describe('findBySellerId', () => {
    it('returns first property for seller', async () => {
      const mockProperty = { id: 'p1', sellerId: 'seller-1' };
      prisma.property.findFirst.mockResolvedValue(mockProperty);

      const result = await propertyRepo.findBySellerId('seller-1');

      expect(prisma.property.findFirst).toHaveBeenCalledWith({
        where: { sellerId: 'seller-1' },
        include: { listings: true },
      });
      expect(result).toEqual(mockProperty);
    });
  });

  describe('update', () => {
    it('updates property fields', async () => {
      const updated = { id: 'p1', town: 'BEDOK' };
      prisma.property.update.mockResolvedValue(updated);

      const result = await propertyRepo.update('p1', { town: 'BEDOK' });

      expect(prisma.property.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { town: 'BEDOK' },
        include: { listings: true },
      });
      expect(result).toEqual(updated);
    });
  });

  describe('appendPriceHistory', () => {
    it('updates askingPrice and appends to priceHistory JSON', async () => {
      const existingProperty = {
        id: 'p1',
        askingPrice: 500000,
        priceHistory: JSON.stringify([]),
      };
      prisma.property.findUnique.mockResolvedValue(existingProperty);
      prisma.property.update.mockResolvedValue({
        ...existingProperty,
        askingPrice: 520000,
      });

      await propertyRepo.appendPriceHistory('p1', 520000, 'seller-1');

      expect(prisma.property.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: {
          askingPrice: 520000,
          priceHistory: expect.stringContaining('"price":520000'),
        },
        include: { listings: true },
      });
    });
  });

  describe('createListing', () => {
    it('creates a draft listing for property', async () => {
      const mockListing = { id: 'test-id-123', propertyId: 'p1', status: 'draft' };
      prisma.listing.create.mockResolvedValue(mockListing);

      const result = await propertyRepo.createListing('p1');

      expect(prisma.listing.create).toHaveBeenCalledWith({
        data: {
          id: 'test-id-123',
          propertyId: 'p1',
          status: 'draft',
          photos: '[]',
        },
      });
      expect(result).toEqual(mockListing);
    });
  });

  describe('updateListingStatus', () => {
    it('updates listing status', async () => {
      prisma.listing.update.mockResolvedValue({ id: 'l1', status: 'pending_review' });

      await propertyRepo.updateListingStatus('l1', 'pending_review');

      expect(prisma.listing.update).toHaveBeenCalledWith({
        where: { id: 'l1' },
        data: { status: 'pending_review' },
      });
    });
  });

  describe('findActiveListingForProperty', () => {
    it('returns the active listing', async () => {
      const mockListing = { id: 'l1', status: 'live' };
      prisma.listing.findFirst.mockResolvedValue(mockListing);

      const result = await propertyRepo.findActiveListingForProperty('p1');

      expect(prisma.listing.findFirst).toHaveBeenCalledWith({
        where: {
          propertyId: 'p1',
          status: { notIn: ['closed'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(mockListing);
    });
  });

  describe('updateListingPhotos', () => {
    it('updates photos JSON on listing', async () => {
      const photos = [{ id: 'ph1', filename: 'photo.jpg', displayOrder: 0 }];
      prisma.listing.update.mockResolvedValue({ id: 'l1', photos: JSON.stringify(photos) });

      await propertyRepo.updateListingPhotos('l1', photos);

      expect(prisma.listing.update).toHaveBeenCalledWith({
        where: { id: 'l1' },
        data: { photos: JSON.stringify(photos) },
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test -- --testPathPattern="property.repository" --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement property repository**

Create `src/domains/property/property.repository.ts`:

```typescript
import { prisma } from '../../infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';
import type { CreatePropertyInput, UpdatePropertyInput, PhotoRecord } from './property.types';

export const propertyRepo = {
  async create(input: CreatePropertyInput) {
    return prisma.property.create({
      data: {
        id: createId(),
        sellerId: input.sellerId,
        town: input.town,
        street: input.street,
        block: input.block,
        flatType: input.flatType,
        storeyRange: input.storeyRange,
        floorAreaSqm: input.floorAreaSqm,
        flatModel: input.flatModel,
        leaseCommenceDate: input.leaseCommenceDate,
        remainingLease: input.remainingLease ?? null,
        askingPrice: input.askingPrice ?? null,
        priceHistory: '[]',
      },
    });
  },

  async findByIdWithListings(id: string) {
    return prisma.property.findUnique({
      where: { id },
      include: { listings: true },
    });
  },

  async findBySellerId(sellerId: string) {
    return prisma.property.findFirst({
      where: { sellerId },
      include: { listings: true },
    });
  },

  async update(id: string, data: UpdatePropertyInput) {
    return prisma.property.update({
      where: { id },
      data,
      include: { listings: true },
    });
  },

  async appendPriceHistory(id: string, newPrice: number, changedBy: string) {
    const property = await prisma.property.findUnique({ where: { id } });
    if (!property) return null;

    const history: unknown[] = property.priceHistory
      ? JSON.parse(property.priceHistory as string)
      : [];

    history.push({
      price: newPrice,
      changedAt: new Date().toISOString(),
      changedBy,
    });

    return prisma.property.update({
      where: { id },
      data: {
        askingPrice: newPrice,
        priceHistory: JSON.stringify(history),
      },
      include: { listings: true },
    });
  },

  async createListing(propertyId: string) {
    return prisma.listing.create({
      data: {
        id: createId(),
        propertyId,
        status: 'draft',
        photos: '[]',
      },
    });
  },

  async findActiveListingForProperty(propertyId: string) {
    return prisma.listing.findFirst({
      where: {
        propertyId,
        status: { notIn: ['closed'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async updateListingStatus(listingId: string, status: string) {
    return prisma.listing.update({
      where: { id: listingId },
      data: { status: status as any },
    });
  },

  async updateListingPhotos(listingId: string, photos: PhotoRecord[]) {
    return prisma.listing.update({
      where: { id: listingId },
      data: { photos: JSON.stringify(photos) },
    });
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test -- --testPathPattern="property.repository" --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/property/__tests__/property.repository.test.ts src/domains/property/property.repository.ts
git commit -m "feat(property): add property repository with CRUD and listing management"
```

---

## Chunk 3: Property Service (TDD)

### Task 4: Create property service with tests

**Files:**
- Create: `src/domains/property/__tests__/property.service.test.ts`
- Create: `src/domains/property/property.service.ts`

- [ ] **Step 1: Write failing tests for property service**

Create `src/domains/property/__tests__/property.service.test.ts`:

```typescript
import { propertyService } from '../property.service';
import { propertyRepo } from '../property.repository';
import { auditService } from '../../shared/audit.service';
import { notificationService } from '../../notification/notification.service';

jest.mock('../property.repository');
jest.mock('../../shared/audit.service');
jest.mock('../../notification/notification.service');

const mockedRepo = jest.mocked(propertyRepo);
const mockedAudit = jest.mocked(auditService);

describe('propertyService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createProperty', () => {
    it('creates a property and a draft listing', async () => {
      const input = {
        sellerId: 'seller-1',
        town: 'TAMPINES',
        street: 'TAMPINES ST 21',
        block: '123',
        flatType: '4 ROOM',
        storeyRange: '07 TO 09',
        floorAreaSqm: 92,
        flatModel: 'Model A',
        leaseCommenceDate: 2000,
      };
      const mockProperty = { id: 'p1', ...input, status: 'draft' };
      const mockListing = { id: 'l1', propertyId: 'p1', status: 'draft' };

      mockedRepo.create.mockResolvedValue(mockProperty as any);
      mockedRepo.createListing.mockResolvedValue(mockListing as any);

      const result = await propertyService.createProperty(input);

      expect(mockedRepo.create).toHaveBeenCalledWith(input);
      expect(mockedRepo.createListing).toHaveBeenCalledWith('p1');
      expect(result).toEqual(mockProperty);
      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'property.created',
          entityType: 'property',
          entityId: 'p1',
        }),
      );
    });
  });

  describe('getPropertyForSeller', () => {
    it('returns property for seller', async () => {
      const mockProperty = { id: 'p1', sellerId: 'seller-1', listings: [] };
      mockedRepo.findBySellerId.mockResolvedValue(mockProperty as any);

      const result = await propertyService.getPropertyForSeller('seller-1');
      expect(result).toEqual(mockProperty);
    });

    it('returns null when no property exists', async () => {
      mockedRepo.findBySellerId.mockResolvedValue(null);
      const result = await propertyService.getPropertyForSeller('seller-1');
      expect(result).toBeNull();
    });
  });

  describe('updateProperty', () => {
    it('updates property and returns it', async () => {
      const existing = {
        id: 'p1',
        sellerId: 'seller-1',
        town: 'TAMPINES',
        askingPrice: 500000,
        listings: [{ id: 'l1', status: 'draft' }],
      };
      mockedRepo.findByIdWithListings.mockResolvedValue(existing as any);
      mockedRepo.update.mockResolvedValue({ ...existing, town: 'BEDOK' } as any);

      const result = await propertyService.updateProperty('p1', 'seller-1', { town: 'BEDOK' });

      expect(mockedRepo.update).toHaveBeenCalledWith('p1', { town: 'BEDOK' });
      expect(result.town).toBe('BEDOK');
    });

    it('throws NotFoundError for missing property', async () => {
      mockedRepo.findByIdWithListings.mockResolvedValue(null);

      await expect(
        propertyService.updateProperty('p1', 'seller-1', { town: 'BEDOK' }),
      ).rejects.toThrow('Property not found');
    });

    it('throws ForbiddenError when seller does not own property', async () => {
      mockedRepo.findByIdWithListings.mockResolvedValue({
        id: 'p1',
        sellerId: 'other-seller',
        listings: [],
      } as any);

      await expect(
        propertyService.updateProperty('p1', 'seller-1', { town: 'BEDOK' }),
      ).rejects.toThrow('Access denied');
    });
  });

  describe('updateAskingPrice', () => {
    it('appends to price history and logs audit', async () => {
      const existing = {
        id: 'p1',
        sellerId: 'seller-1',
        askingPrice: 500000,
        listings: [{ id: 'l1', status: 'draft' }],
      };
      mockedRepo.findByIdWithListings.mockResolvedValue(existing as any);
      mockedRepo.appendPriceHistory.mockResolvedValue({
        ...existing,
        askingPrice: 520000,
      } as any);

      const result = await propertyService.updateAskingPrice('p1', 'seller-1', 520000);

      expect(mockedRepo.appendPriceHistory).toHaveBeenCalledWith('p1', 520000, 'seller-1');
      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'property.price_changed',
          details: expect.objectContaining({
            oldPrice: 500000,
            newPrice: 520000,
          }),
        }),
      );
    });

    it('reverts live listing to pending_review when price changes', async () => {
      const existing = {
        id: 'p1',
        sellerId: 'seller-1',
        askingPrice: 500000,
        listings: [{ id: 'l1', status: 'live' }],
      };
      mockedRepo.findByIdWithListings.mockResolvedValue(existing as any);
      mockedRepo.appendPriceHistory.mockResolvedValue({
        ...existing,
        askingPrice: 520000,
      } as any);
      mockedRepo.updateListingStatus.mockResolvedValue({} as any);

      await propertyService.updateAskingPrice('p1', 'seller-1', 520000);

      expect(mockedRepo.updateListingStatus).toHaveBeenCalledWith('l1', 'pending_review');
    });

    it('does not revert draft listing when price changes', async () => {
      const existing = {
        id: 'p1',
        sellerId: 'seller-1',
        askingPrice: 500000,
        listings: [{ id: 'l1', status: 'draft' }],
      };
      mockedRepo.findByIdWithListings.mockResolvedValue(existing as any);
      mockedRepo.appendPriceHistory.mockResolvedValue({
        ...existing,
        askingPrice: 520000,
      } as any);

      await propertyService.updateAskingPrice('p1', 'seller-1', 520000);

      expect(mockedRepo.updateListingStatus).not.toHaveBeenCalled();
    });
  });

  describe('updateListingStatus', () => {
    it('transitions listing status when valid', async () => {
      mockedRepo.findActiveListingForProperty.mockResolvedValue({
        id: 'l1',
        propertyId: 'p1',
        status: 'draft',
      } as any);
      mockedRepo.updateListingStatus.mockResolvedValue({ id: 'l1', status: 'pending_review' } as any);

      await propertyService.updateListingStatus('p1', 'pending_review');

      expect(mockedRepo.updateListingStatus).toHaveBeenCalledWith('l1', 'pending_review');
    });

    it('throws ValidationError for invalid transition', async () => {
      mockedRepo.findActiveListingForProperty.mockResolvedValue({
        id: 'l1',
        propertyId: 'p1',
        status: 'draft',
      } as any);

      await expect(
        propertyService.updateListingStatus('p1', 'live'),
      ).rejects.toThrow('Cannot transition');
    });

    it('throws NotFoundError when no active listing', async () => {
      mockedRepo.findActiveListingForProperty.mockResolvedValue(null);

      await expect(
        propertyService.updateListingStatus('p1', 'pending_review'),
      ).rejects.toThrow('Listing not found');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test -- --testPathPattern="property.service" --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement property service**

Create `src/domains/property/property.service.ts`:

```typescript
import { propertyRepo } from './property.repository';
import { auditService } from '../shared/audit.service';
import { NotFoundError, ForbiddenError, ValidationError } from '../shared/errors';
import { canTransitionListing } from './property.types';
import type { CreatePropertyInput, UpdatePropertyInput } from './property.types';

export const propertyService = {
  async createProperty(input: CreatePropertyInput) {
    const property = await propertyRepo.create(input);
    await propertyRepo.createListing(property.id);

    auditService.log({
      action: 'property.created',
      entityType: 'property',
      entityId: property.id,
      details: { sellerId: input.sellerId, town: input.town, flatType: input.flatType },
    });

    return property;
  },

  async getPropertyForSeller(sellerId: string) {
    return propertyRepo.findBySellerId(sellerId);
  },

  async getPropertyById(propertyId: string) {
    const property = await propertyRepo.findByIdWithListings(propertyId);
    if (!property) throw new NotFoundError('Property', propertyId);
    return property;
  },

  async updateProperty(propertyId: string, sellerId: string, data: UpdatePropertyInput) {
    const property = await propertyRepo.findByIdWithListings(propertyId);
    if (!property) throw new NotFoundError('Property', propertyId);
    if (property.sellerId !== sellerId) throw new ForbiddenError('Access denied');

    const updated = await propertyRepo.update(propertyId, data);

    // If listing is live and property details changed, revert to pending_review
    const activeListing = property.listings?.find(
      (l: any) => l.status === 'live',
    );
    if (activeListing) {
      await propertyRepo.updateListingStatus(activeListing.id, 'pending_review');
      auditService.log({
        action: 'listing.reverted_for_review',
        entityType: 'listing',
        entityId: activeListing.id,
        details: { reason: 'property_details_changed', changedFields: Object.keys(data) },
      });
    }

    auditService.log({
      action: 'property.updated',
      entityType: 'property',
      entityId: propertyId,
      details: { changedFields: Object.keys(data) },
    });

    return updated;
  },

  async updateAskingPrice(propertyId: string, sellerId: string, newPrice: number) {
    const property = await propertyRepo.findByIdWithListings(propertyId);
    if (!property) throw new NotFoundError('Property', propertyId);
    if (property.sellerId !== sellerId) throw new ForbiddenError('Access denied');

    const oldPrice = property.askingPrice ? Number(property.askingPrice) : null;

    const updated = await propertyRepo.appendPriceHistory(propertyId, newPrice, sellerId);

    // If listing is live, auto-revert to pending_review
    const activeListing = property.listings?.find(
      (l: any) => l.status === 'live',
    );
    if (activeListing) {
      await propertyRepo.updateListingStatus(activeListing.id, 'pending_review');
      auditService.log({
        action: 'listing.reverted_for_review',
        entityType: 'listing',
        entityId: activeListing.id,
        details: { reason: 'price_changed', oldPrice, newPrice },
      });
    }

    auditService.log({
      action: 'property.price_changed',
      entityType: 'property',
      entityId: propertyId,
      details: { oldPrice, newPrice },
    });

    return updated;
  },

  async updateListingStatus(propertyId: string, newStatus: string) {
    const listing = await propertyRepo.findActiveListingForProperty(propertyId);
    if (!listing) throw new NotFoundError('Listing', propertyId);

    if (!canTransitionListing(listing.status, newStatus)) {
      throw new ValidationError(
        `Cannot transition listing from '${listing.status}' to '${newStatus}'`,
      );
    }

    const updated = await propertyRepo.updateListingStatus(listing.id, newStatus);

    auditService.log({
      action: 'listing.status_changed',
      entityType: 'listing',
      entityId: listing.id,
      details: { from: listing.status, to: newStatus },
    });

    return updated;
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test -- --testPathPattern="property.service" --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/property/__tests__/property.service.test.ts src/domains/property/property.service.ts
git commit -m "feat(property): add property service with CRUD, price change, and listing status logic"
```

---

## Chunk 4: Photo Service (TDD)

### Task 5: Create photo service with tests

**Files:**
- Create: `src/domains/property/__tests__/photo.service.test.ts`
- Create: `src/domains/property/photo.service.ts`

- [ ] **Step 1: Write failing tests for photo service**

Create `src/domains/property/__tests__/photo.service.test.ts`:

```typescript
import { photoService } from '../photo.service';
import { propertyRepo } from '../property.repository';
import { localStorage } from '../../../infra/storage/local-storage';
import { auditService } from '../../shared/audit.service';

jest.mock('../property.repository');
jest.mock('../../../infra/storage/local-storage');
jest.mock('../../shared/audit.service');

// Mock sharp
jest.mock('sharp', () => {
  const mockSharp = jest.fn(() => ({
    metadata: jest.fn().mockResolvedValue({ width: 1200, height: 900, format: 'jpeg' }),
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('optimized-image')),
  }));
  return mockSharp;
});

const mockedRepo = jest.mocked(propertyRepo);
const mockedStorage = jest.mocked(localStorage);
const mockedAudit = jest.mocked(auditService);

describe('photoService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('validateImage', () => {
    it('accepts valid JPEG', async () => {
      const result = await photoService.validateImage(
        Buffer.from('test'),
        'image/jpeg',
        1024 * 1024, // 1MB
      );
      expect(result.valid).toBe(true);
    });

    it('rejects non-image MIME type', async () => {
      const result = await photoService.validateImage(
        Buffer.from('test'),
        'application/pdf',
        1024,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('File type not allowed');
    });

    it('rejects file exceeding 5MB', async () => {
      const result = await photoService.validateImage(
        Buffer.from('test'),
        'image/jpeg',
        6 * 1024 * 1024,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum');
    });

    it('rejects image smaller than 800px', async () => {
      const sharp = require('sharp');
      sharp.mockReturnValueOnce({
        metadata: jest.fn().mockResolvedValue({ width: 600, height: 400, format: 'jpeg' }),
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('test')),
      });

      const result = await photoService.validateImage(
        Buffer.from('test'),
        'image/jpeg',
        1024,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('800px');
    });
  });

  describe('processAndSavePhoto', () => {
    it('saves original and optimized versions', async () => {
      mockedStorage.save.mockResolvedValue('saved-path');

      const result = await photoService.processAndSavePhoto(
        Buffer.from('image-data'),
        'photo.jpg',
        'image/jpeg',
        'seller-1',
        'property-1',
      );

      // Should save both original and optimized
      expect(mockedStorage.save).toHaveBeenCalledTimes(2);
      expect(result).toHaveProperty('filename');
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('optimizedPath');
      expect(result).toHaveProperty('width');
      expect(result).toHaveProperty('height');
    });
  });

  describe('addPhotoToListing', () => {
    it('adds photo to listing photos array', async () => {
      const existingPhotos: any[] = [];
      const listing = { id: 'l1', photos: JSON.stringify(existingPhotos) };
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);
      mockedRepo.updateListingPhotos.mockResolvedValue({} as any);

      const photo = {
        id: 'ph1',
        filename: 'photo.jpg',
        originalFilename: 'my-photo.jpg',
        path: '/uploads/photos/s1/p1/original/photo.jpg',
        optimizedPath: '/uploads/photos/s1/p1/optimized/photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        width: 1200,
        height: 900,
        displayOrder: 0,
        status: 'uploaded' as const,
        uploadedAt: new Date(),
      };

      await photoService.addPhotoToListing('p1', photo);

      expect(mockedRepo.updateListingPhotos).toHaveBeenCalledWith(
        'l1',
        expect.arrayContaining([expect.objectContaining({ id: 'ph1' })]),
      );
    });

    it('rejects when MAX_PHOTOS reached', async () => {
      const photos = Array.from({ length: 20 }, (_, i) => ({ id: `ph${i}` }));
      const listing = { id: 'l1', photos: JSON.stringify(photos) };
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);

      const photo = {
        id: 'ph-new',
        filename: 'photo.jpg',
        originalFilename: 'photo.jpg',
        path: '/path',
        optimizedPath: '/path-opt',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        width: 1200,
        height: 900,
        displayOrder: 20,
        status: 'uploaded' as const,
        uploadedAt: new Date(),
      };

      await expect(photoService.addPhotoToListing('p1', photo)).rejects.toThrow(
        'Maximum 20 photos',
      );
    });
  });

  describe('removePhoto', () => {
    it('removes photo from listing and deletes files', async () => {
      const photos = [
        { id: 'ph1', path: 'original/ph1.jpg', optimizedPath: 'optimized/ph1.jpg' },
        { id: 'ph2', path: 'original/ph2.jpg', optimizedPath: 'optimized/ph2.jpg' },
      ];
      const listing = { id: 'l1', photos: JSON.stringify(photos) };
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);
      mockedRepo.updateListingPhotos.mockResolvedValue({} as any);
      mockedStorage.delete.mockResolvedValue(undefined);

      await photoService.removePhoto('p1', 'ph1');

      expect(mockedStorage.delete).toHaveBeenCalledTimes(2); // original + optimized
      expect(mockedRepo.updateListingPhotos).toHaveBeenCalledWith(
        'l1',
        expect.not.arrayContaining([expect.objectContaining({ id: 'ph1' })]),
      );
    });

    it('throws NotFoundError for missing photo', async () => {
      const listing = { id: 'l1', photos: '[]' };
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);

      await expect(photoService.removePhoto('p1', 'ph-missing')).rejects.toThrow('Photo not found');
    });
  });

  describe('reorderPhotos', () => {
    it('reorders photos by provided ID list', async () => {
      const photos = [
        { id: 'ph1', displayOrder: 0 },
        { id: 'ph2', displayOrder: 1 },
        { id: 'ph3', displayOrder: 2 },
      ];
      const listing = { id: 'l1', photos: JSON.stringify(photos) };
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);
      mockedRepo.updateListingPhotos.mockResolvedValue({} as any);

      await photoService.reorderPhotos('p1', ['ph3', 'ph1', 'ph2']);

      expect(mockedRepo.updateListingPhotos).toHaveBeenCalledWith('l1', [
        expect.objectContaining({ id: 'ph3', displayOrder: 0 }),
        expect.objectContaining({ id: 'ph1', displayOrder: 1 }),
        expect.objectContaining({ id: 'ph2', displayOrder: 2 }),
      ]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test -- --testPathPattern="photo.service" --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement photo service**

Create `src/domains/property/photo.service.ts`:

```typescript
import sharp from 'sharp';
import { createId } from '@paralleldrive/cuid2';
import { localStorage } from '../../infra/storage/local-storage';
import { propertyRepo } from './property.repository';
import { auditService } from '../shared/audit.service';
import { NotFoundError, ValidationError } from '../shared/errors';
import {
  MAX_PHOTOS,
  MAX_PHOTO_SIZE_BYTES,
  MIN_DIMENSION_PX,
  MAX_DIMENSION_PX,
  JPEG_QUALITY,
  ALLOWED_MIME_TYPES,
  type PhotoRecord,
} from './property.types';

export const photoService = {
  async validateImage(
    buffer: Buffer,
    mimeType: string,
    sizeBytes: number,
  ): Promise<{ valid: boolean; error?: string }> {
    if (!ALLOWED_MIME_TYPES.includes(mimeType as any)) {
      return { valid: false, error: `File type not allowed. Use JPG or PNG.` };
    }

    if (sizeBytes > MAX_PHOTO_SIZE_BYTES) {
      return { valid: false, error: `File size exceeds maximum of 5MB.` };
    }

    try {
      const metadata = await sharp(buffer).metadata();
      const longestEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0);
      if (longestEdge < MIN_DIMENSION_PX) {
        return {
          valid: false,
          error: `Image must be at least 800px on the longest edge. Got ${longestEdge}px.`,
        };
      }
    } catch {
      return { valid: false, error: 'Could not read image metadata.' };
    }

    return { valid: true };
  },

  async processAndSavePhoto(
    buffer: Buffer,
    originalFilename: string,
    mimeType: string,
    sellerId: string,
    propertyId: string,
  ): Promise<Omit<PhotoRecord, 'displayOrder' | 'status' | 'uploadedAt'>> {
    const id = createId();
    const ext = 'jpg';
    const filename = `${id}.${ext}`;

    const metadata = await sharp(buffer).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    // Save original
    const originalPath = `photos/${sellerId}/${propertyId}/original/${filename}`;
    await localStorage.save(originalPath, buffer);

    // Resize and optimize
    const optimized = await sharp(buffer)
      .resize(MAX_DIMENSION_PX, MAX_DIMENSION_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    const optimizedPath = `photos/${sellerId}/${propertyId}/optimized/${filename}`;
    await localStorage.save(optimizedPath, optimized);

    return {
      id,
      filename,
      originalFilename,
      path: originalPath,
      optimizedPath,
      mimeType,
      sizeBytes: buffer.length,
      width,
      height,
    };
  },

  async addPhotoToListing(propertyId: string, photo: PhotoRecord): Promise<void> {
    const listing = await propertyRepo.findActiveListingForProperty(propertyId);
    if (!listing) throw new NotFoundError('Listing', propertyId);

    const existingPhotos: PhotoRecord[] = listing.photos
      ? JSON.parse(listing.photos as string)
      : [];

    if (existingPhotos.length >= MAX_PHOTOS) {
      throw new ValidationError(`Maximum ${MAX_PHOTOS} photos allowed per listing.`);
    }

    existingPhotos.push(photo);
    await propertyRepo.updateListingPhotos(listing.id, existingPhotos);
  },

  async removePhoto(propertyId: string, photoId: string): Promise<void> {
    const listing = await propertyRepo.findActiveListingForProperty(propertyId);
    if (!listing) throw new NotFoundError('Listing', propertyId);

    const photos: PhotoRecord[] = listing.photos ? JSON.parse(listing.photos as string) : [];
    const photo = photos.find((p) => p.id === photoId);
    if (!photo) throw new NotFoundError('Photo', photoId);

    // Delete files
    await localStorage.delete(photo.path);
    await localStorage.delete(photo.optimizedPath);

    // Remove from array and reindex
    const remaining = photos.filter((p) => p.id !== photoId);
    remaining.forEach((p, i) => (p.displayOrder = i));
    await propertyRepo.updateListingPhotos(listing.id, remaining);

    auditService.log({
      action: 'photo.deleted',
      entityType: 'photo',
      entityId: photoId,
      details: { propertyId, listingId: listing.id },
    });
  },

  async reorderPhotos(propertyId: string, photoIds: string[]): Promise<void> {
    const listing = await propertyRepo.findActiveListingForProperty(propertyId);
    if (!listing) throw new NotFoundError('Listing', propertyId);

    const photos: PhotoRecord[] = listing.photos ? JSON.parse(listing.photos as string) : [];

    const reordered = photoIds
      .map((id, index) => {
        const photo = photos.find((p) => p.id === id);
        if (!photo) return null;
        return { ...photo, displayOrder: index };
      })
      .filter(Boolean) as PhotoRecord[];

    await propertyRepo.updateListingPhotos(listing.id, reordered);
  },

  async getPhotosForProperty(propertyId: string): Promise<PhotoRecord[]> {
    const listing = await propertyRepo.findActiveListingForProperty(propertyId);
    if (!listing) return [];

    const photos: PhotoRecord[] = listing.photos ? JSON.parse(listing.photos as string) : [];
    return photos.sort((a, b) => a.displayOrder - b.displayOrder);
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test -- --testPathPattern="photo.service" --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/property/__tests__/photo.service.test.ts src/domains/property/photo.service.ts
git commit -m "feat(property): add photo service with validation, sharp processing, and management"
```

---

## Chunk 5: Property Validator + Router + Views

### Task 6: Create property validator

**Files:**
- Create: `src/domains/property/property.validator.ts`

- [ ] **Step 1: Create property validator**

```typescript
import { body, param } from 'express-validator';
import { HDB_TOWNS, HDB_FLAT_TYPES } from './property.types';

export const validatePropertyCreate = [
  body('town')
    .trim()
    .notEmpty()
    .withMessage('Town is required')
    .isIn([...HDB_TOWNS])
    .withMessage('Invalid town'),
  body('street').trim().notEmpty().withMessage('Street name is required'),
  body('block').trim().notEmpty().withMessage('Block number is required'),
  body('flatType')
    .trim()
    .notEmpty()
    .withMessage('Flat type is required')
    .isIn([...HDB_FLAT_TYPES])
    .withMessage('Invalid flat type'),
  body('storeyRange').trim().notEmpty().withMessage('Storey range is required'),
  body('floorAreaSqm')
    .isFloat({ min: 30, max: 300 })
    .withMessage('Floor area must be between 30 and 300 sqm')
    .toFloat(),
  body('flatModel').trim().notEmpty().withMessage('Flat model is required'),
  body('leaseCommenceDate')
    .isInt({ min: 1960, max: new Date().getFullYear() })
    .withMessage('Invalid lease commencement date')
    .toInt(),
  body('remainingLease').optional().trim(),
  body('askingPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Asking price must be a positive number')
    .toFloat(),
];

export const validatePropertyUpdate = [
  body('town')
    .optional()
    .trim()
    .isIn([...HDB_TOWNS])
    .withMessage('Invalid town'),
  body('street').optional().trim().notEmpty().withMessage('Street name cannot be empty'),
  body('block').optional().trim().notEmpty().withMessage('Block number cannot be empty'),
  body('flatType')
    .optional()
    .trim()
    .isIn([...HDB_FLAT_TYPES])
    .withMessage('Invalid flat type'),
  body('storeyRange').optional().trim().notEmpty(),
  body('floorAreaSqm').optional().isFloat({ min: 30, max: 300 }).toFloat(),
  body('flatModel').optional().trim().notEmpty(),
  body('leaseCommenceDate')
    .optional()
    .isInt({ min: 1960, max: new Date().getFullYear() })
    .toInt(),
  body('remainingLease').optional().trim(),
  body('askingPrice').optional().isFloat({ min: 0 }).toFloat(),
];

export const validatePhotoReorder = [
  body('photoIds').isArray({ min: 1 }).withMessage('Photo IDs array is required'),
  body('photoIds.*').isString().withMessage('Each photo ID must be a string'),
];

export const validatePhotoId = [
  param('id').isString().notEmpty().withMessage('Photo ID is required'),
];
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/property/property.validator.ts
git commit -m "feat(property): add property and photo validators"
```

---

### Task 7: Create property and photo views

**Files:**
- Create: `src/views/pages/seller/property.njk`
- Create: `src/views/pages/seller/photos.njk`
- Create: `src/views/partials/seller/property-form.njk`
- Create: `src/views/partials/seller/photo-grid.njk`
- Create: `src/views/partials/seller/photo-upload-area.njk`

- [ ] **Step 1: Create property page**

Create `src/views/pages/seller/property.njk`:

```nunjucks
{% extends "layouts/seller.njk" %}

{% block content %}
<div class="max-w-3xl mx-auto">
  <h1 class="text-2xl font-bold text-gray-900 mb-6">{{ "Your Property Details" | t }}</h1>

  <div id="property-form-container">
    {% include "partials/seller/property-form.njk" %}
  </div>
</div>
{% endblock %}
```

- [ ] **Step 2: Create property form partial**

Create `src/views/partials/seller/property-form.njk`:

```nunjucks
<form
  id="property-form"
  hx-put="/seller/property"
  hx-target="#property-form-container"
  hx-swap="innerHTML"
  class="space-y-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200"
>
  {% if success %}
  <div class="bg-green-50 border border-green-200 rounded-md p-4 mb-4">
    <p class="text-sm text-green-800">{{ "Property details updated successfully." | t }}</p>
  </div>
  {% endif %}

  {% if error %}
  <div class="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
    <p class="text-sm text-red-800">{{ error }}</p>
  </div>
  {% endif %}

  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div>
      <label for="town" class="block text-sm font-medium text-gray-700 mb-1">{{ "Town" | t }}</label>
      <select id="town" name="town" required
        class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
        <option value="">{{ "Select town" | t }}</option>
        {% for t in towns %}
        <option value="{{ t }}" {% if property and property.town == t %}selected{% endif %}>{{ t }}</option>
        {% endfor %}
      </select>
    </div>

    <div>
      <label for="flatType" class="block text-sm font-medium text-gray-700 mb-1">{{ "Flat Type" | t }}</label>
      <select id="flatType" name="flatType" required
        class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
        <option value="">{{ "Select flat type" | t }}</option>
        {% for ft in flatTypes %}
        <option value="{{ ft }}" {% if property and property.flatType == ft %}selected{% endif %}>{{ ft }}</option>
        {% endfor %}
      </select>
    </div>

    <div>
      <label for="block" class="block text-sm font-medium text-gray-700 mb-1">{{ "Block" | t }}</label>
      <input type="text" id="block" name="block" value="{{ property.block if property else '' }}" required
        class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
    </div>

    <div>
      <label for="street" class="block text-sm font-medium text-gray-700 mb-1">{{ "Street Name" | t }}</label>
      <input type="text" id="street" name="street" value="{{ property.street if property else '' }}" required
        class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
    </div>

    <div>
      <label for="storeyRange" class="block text-sm font-medium text-gray-700 mb-1">{{ "Storey Range" | t }}</label>
      <input type="text" id="storeyRange" name="storeyRange" value="{{ property.storeyRange if property else '' }}" required
        placeholder="e.g. 07 TO 09"
        class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
    </div>

    <div>
      <label for="floorAreaSqm" class="block text-sm font-medium text-gray-700 mb-1">{{ "Floor Area (sqm)" | t }}</label>
      <input type="number" id="floorAreaSqm" name="floorAreaSqm" value="{{ property.floorAreaSqm if property else '' }}" required
        min="30" max="300" step="0.1"
        class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
    </div>

    <div>
      <label for="flatModel" class="block text-sm font-medium text-gray-700 mb-1">{{ "Flat Model" | t }}</label>
      <input type="text" id="flatModel" name="flatModel" value="{{ property.flatModel if property else '' }}" required
        class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
    </div>

    <div>
      <label for="leaseCommenceDate" class="block text-sm font-medium text-gray-700 mb-1">{{ "Lease Commencement Year" | t }}</label>
      <input type="number" id="leaseCommenceDate" name="leaseCommenceDate" value="{{ property.leaseCommenceDate if property else '' }}" required
        min="1960" max="2026"
        class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
    </div>

    <div>
      <label for="askingPrice" class="block text-sm font-medium text-gray-700 mb-1">{{ "Asking Price ($)" | t }}</label>
      <input type="number" id="askingPrice" name="askingPrice" value="{{ property.askingPrice if property else '' }}"
        min="0" step="1000" placeholder="{{ 'Optional' | t }}"
        class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
    </div>

    <div>
      <label for="remainingLease" class="block text-sm font-medium text-gray-700 mb-1">{{ "Remaining Lease" | t }}</label>
      <input type="text" id="remainingLease" name="remainingLease" value="{{ property.remainingLease if property else '' }}"
        placeholder="{{ 'e.g. 72 years 03 months' | t }}"
        class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
    </div>
  </div>

  {% if property and property.askingPrice %}
  <div class="text-sm text-gray-500">
    {{ "Current asking price:" | t }} ${{ property.askingPrice | formatPrice }}
  </div>
  {% endif %}

  <div class="flex justify-end">
    <button type="submit"
      class="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
      {{ "Save Property Details" | t }}
    </button>
  </div>
</form>
```

- [ ] **Step 3: Create photos page**

Create `src/views/pages/seller/photos.njk`:

```nunjucks
{% extends "layouts/seller.njk" %}

{% block content %}
<div class="max-w-4xl mx-auto">
  <h1 class="text-2xl font-bold text-gray-900 mb-2">{{ "Property Photos" | t }}</h1>
  <p class="text-gray-600 mb-6">{{ "Upload up to 20 high-quality photos of your property. Minimum 800px, JPG or PNG only, max 5MB each." | t }}</p>

  <div id="photo-upload-container">
    {% include "partials/seller/photo-upload-area.njk" %}
  </div>

  <div id="photo-grid-container" class="mt-8">
    {% include "partials/seller/photo-grid.njk" %}
  </div>
</div>
{% endblock %}
```

- [ ] **Step 4: Create photo upload area partial**

Create `src/views/partials/seller/photo-upload-area.njk`:

```nunjucks
{% if error %}
<div class="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
  <p class="text-sm text-red-800">{{ error }}</p>
</div>
{% endif %}

{% if success %}
<div class="bg-green-50 border border-green-200 rounded-md p-4 mb-4">
  <p class="text-sm text-green-800">{{ "Photo uploaded successfully." | t }}</p>
</div>
{% endif %}

<div class="bg-white border-2 border-dashed border-gray-300 rounded-lg p-8 text-center"
  id="drop-zone">
  <svg class="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
    <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
  <p class="mt-2 text-sm text-gray-600">{{ "Drag and drop photos here, or click to select" | t }}</p>
  <p class="mt-1 text-xs text-gray-500">{{ "JPG or PNG, max 5MB, minimum 800px" | t }}</p>
  <p class="mt-1 text-xs text-gray-500">{{ photoCount | default(0) }} / 20 {{ "photos uploaded" | t }}</p>

  <form id="photo-upload-form"
    hx-post="/seller/photos"
    hx-target="#photo-grid-container"
    hx-swap="innerHTML"
    hx-encoding="multipart/form-data"
    class="mt-4">
    <input type="file" name="photo" accept="image/jpeg,image/png"
      class="hidden" id="photo-input"
      onchange="this.closest('form').requestSubmit()">
    <label for="photo-input"
      class="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 cursor-pointer">
      {{ "Choose Photo" | t }}
    </label>
  </form>
</div>
```

- [ ] **Step 5: Create photo grid partial**

Create `src/views/partials/seller/photo-grid.njk`:

```nunjucks
{% if photos and photos.length > 0 %}
<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" id="photo-grid">
  {% for photo in photos %}
  <div class="relative group bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
    data-photo-id="{{ photo.id }}">
    <img src="/seller/photos/{{ photo.id }}/thumbnail" alt="{{ photo.originalFilename }}"
      class="w-full h-40 object-cover">
    <div class="p-2">
      <p class="text-xs text-gray-500 truncate">{{ photo.originalFilename }}</p>
      <span class="inline-block mt-1 px-2 py-0.5 text-xs rounded-full
        {% if photo.status == 'approved' %}bg-green-100 text-green-800
        {% elif photo.status == 'pending_review' %}bg-yellow-100 text-yellow-800
        {% elif photo.status == 'rejected' %}bg-red-100 text-red-800
        {% else %}bg-blue-100 text-blue-800{% endif %}">
        {{ photo.status | t }}
      </span>
    </div>
    <button
      hx-delete="/seller/photos/{{ photo.id }}"
      hx-target="#photo-grid-container"
      hx-swap="innerHTML"
      hx-confirm="{{ 'Are you sure you want to delete this photo?' | t }}"
      class="absolute top-2 right-2 bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>
  </div>
  {% endfor %}
</div>

{% if photos.length > 1 %}
<div class="mt-4">
  <form hx-put="/seller/photos/reorder" hx-target="#photo-grid-container" hx-swap="innerHTML">
    <input type="hidden" name="photoIds" id="photo-order-input" value="{{ photos | map('id') | join(',') }}">
    <p class="text-sm text-gray-500">{{ "Drag photos to reorder. The first photo will be the cover image." | t }}</p>
  </form>
</div>
{% endif %}
{% else %}
<div class="text-center py-12 text-gray-500">
  <p>{{ "No photos uploaded yet. Upload your first photo above." | t }}</p>
</div>
{% endif %}
```

- [ ] **Step 6: Commit views**

```bash
git add src/views/pages/seller/property.njk src/views/pages/seller/photos.njk src/views/partials/seller/property-form.njk src/views/partials/seller/photo-grid.njk src/views/partials/seller/photo-upload-area.njk
git commit -m "feat(property): add property details and photo management views"
```

---

### Task 8: Create property router and register in app

**Files:**
- Create: `src/domains/property/property.router.ts`
- Modify: `src/infra/http/app.ts`

- [ ] **Step 1: Create property router**

Create `src/domains/property/property.router.ts`:

```typescript
import { Router } from 'express';
import multer from 'multer';
import { validationResult } from 'express-validator';
import { propertyService } from './property.service';
import { photoService } from './photo.service';
import {
  validatePropertyUpdate,
  validatePhotoReorder,
  validatePhotoId,
} from './property.validator';
import { HDB_TOWNS, HDB_FLAT_TYPES } from './property.types';
import { requireAuth } from '../../infra/http/middleware/require-auth';
import { requireRole } from '../../infra/http/middleware/require-auth';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const sellerAuth = [requireAuth(), requireRole('seller')];

export const propertyRouter = Router();

// ─── Property Details ─────────────────────────────────────

propertyRouter.get('/seller/property', ...sellerAuth, async (req, res, next) => {
  try {
    const sellerId = (req.user as any).id;
    const property = await propertyService.getPropertyForSeller(sellerId);
    const data = { property, towns: HDB_TOWNS, flatTypes: HDB_FLAT_TYPES };

    if (req.headers['hx-request']) {
      return res.render('partials/seller/property-form', data);
    }
    res.render('pages/seller/property', data);
  } catch (err) {
    next(err);
  }
});

propertyRouter.put('/seller/property', ...sellerAuth, validatePropertyUpdate, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const property = await propertyService.getPropertyForSeller((req.user as any).id);
      return res.render('partials/seller/property-form', {
        property,
        towns: HDB_TOWNS,
        flatTypes: HDB_FLAT_TYPES,
        error: errors.array()[0].msg,
      });
    }

    const sellerId = (req.user as any).id;
    let property = await propertyService.getPropertyForSeller(sellerId);

    // Separate price update from other field updates
    const { askingPrice, ...otherFields } = req.body;

    if (property) {
      // Update existing property
      if (Object.keys(otherFields).length > 0) {
        property = await propertyService.updateProperty(property.id, sellerId, otherFields);
      }
      if (askingPrice !== undefined && askingPrice !== '') {
        const newPrice = parseFloat(askingPrice);
        if (!isNaN(newPrice) && Number(property.askingPrice) !== newPrice) {
          property = await propertyService.updateAskingPrice(property.id, sellerId, newPrice);
        }
      }
    } else {
      // Create new property
      property = await propertyService.createProperty({
        sellerId,
        ...otherFields,
        askingPrice: askingPrice ? parseFloat(askingPrice) : undefined,
      });
    }

    res.render('partials/seller/property-form', {
      property,
      towns: HDB_TOWNS,
      flatTypes: HDB_FLAT_TYPES,
      success: true,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Photo Management ─────────────────────────────────────

propertyRouter.get('/seller/photos', ...sellerAuth, async (req, res, next) => {
  try {
    const sellerId = (req.user as any).id;
    const property = await propertyService.getPropertyForSeller(sellerId);

    if (!property) {
      const data = { photos: [], photoCount: 0, error: 'Please add your property details first.' };
      if (req.headers['hx-request']) {
        return res.render('partials/seller/photo-grid', data);
      }
      return res.render('pages/seller/photos', data);
    }

    const photos = await photoService.getPhotosForProperty(property.id);
    const data = { photos, photoCount: photos.length };

    if (req.headers['hx-request']) {
      return res.render('partials/seller/photo-grid', data);
    }
    res.render('pages/seller/photos', data);
  } catch (err) {
    next(err);
  }
});

propertyRouter.post('/seller/photos', ...sellerAuth, upload.single('photo'), async (req, res, next) => {
  try {
    const sellerId = (req.user as any).id;
    const property = await propertyService.getPropertyForSeller(sellerId);

    if (!property) {
      return res.status(400).render('partials/seller/photo-grid', {
        photos: [],
        error: 'Please add your property details first.',
      });
    }

    if (!req.file) {
      const photos = await photoService.getPhotosForProperty(property.id);
      return res.status(400).render('partials/seller/photo-grid', {
        photos,
        error: 'No file uploaded.',
      });
    }

    // Validate image
    const validation = await photoService.validateImage(
      req.file.buffer,
      req.file.mimetype,
      req.file.size,
    );
    if (!validation.valid) {
      const photos = await photoService.getPhotosForProperty(property.id);
      return res.status(400).render('partials/seller/photo-grid', {
        photos,
        error: validation.error,
      });
    }

    // Process and save
    const photoData = await photoService.processAndSavePhoto(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      sellerId,
      property.id,
    );

    const existingPhotos = await photoService.getPhotosForProperty(property.id);
    const photoRecord = {
      ...photoData,
      displayOrder: existingPhotos.length,
      status: 'uploaded' as const,
      uploadedAt: new Date(),
    };

    await photoService.addPhotoToListing(property.id, photoRecord);

    const photos = await photoService.getPhotosForProperty(property.id);
    res.render('partials/seller/photo-grid', { photos, photoCount: photos.length });
  } catch (err) {
    next(err);
  }
});

propertyRouter.delete('/seller/photos/:id', ...sellerAuth, ...validatePhotoId, async (req, res, next) => {
  try {
    const sellerId = (req.user as any).id;
    const property = await propertyService.getPropertyForSeller(sellerId);

    if (!property) {
      return res.status(404).render('partials/seller/photo-grid', { photos: [] });
    }

    await photoService.removePhoto(property.id, req.params.id);

    const photos = await photoService.getPhotosForProperty(property.id);
    res.render('partials/seller/photo-grid', { photos, photoCount: photos.length });
  } catch (err) {
    next(err);
  }
});

propertyRouter.put('/seller/photos/reorder', ...sellerAuth, validatePhotoReorder, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const sellerId = (req.user as any).id;
    const property = await propertyService.getPropertyForSeller(sellerId);

    if (!property) {
      return res.status(404).render('partials/seller/photo-grid', { photos: [] });
    }

    await photoService.reorderPhotos(property.id, req.body.photoIds);

    const photos = await photoService.getPhotosForProperty(property.id);
    res.render('partials/seller/photo-grid', { photos, photoCount: photos.length });
  } catch (err) {
    next(err);
  }
});

// ─── Photo Thumbnail (serve optimized image) ─────────────

propertyRouter.get('/seller/photos/:id/thumbnail', ...sellerAuth, async (req, res, next) => {
  try {
    const sellerId = (req.user as any).id;
    const property = await propertyService.getPropertyForSeller(sellerId);
    if (!property) return res.status(404).end();

    const photos = await photoService.getPhotosForProperty(property.id);
    const photo = photos.find((p) => p.id === req.params.id);
    if (!photo) return res.status(404).end();

    const { localStorage } = await import('../../infra/storage/local-storage');
    const buffer = await localStorage.read(photo.optimizedPath);
    res.type('image/jpeg').send(buffer);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Register property router in app.ts**

In `src/infra/http/app.ts`, add after the sellerRouter import and registration:

```typescript
import { propertyRouter } from '../../domains/property/property.router';
```

And add after `app.use(sellerRouter)`:

```typescript
app.use(propertyRouter);
```

- [ ] **Step 3: Commit**

```bash
git add src/domains/property/property.router.ts src/infra/http/app.ts
git commit -m "feat(property): add property router with photo upload and register in app"
```

---

## Chunk 6: Update Onboarding Step 2 + Seller Service Connection

### Task 9: Update onboarding step 2 to use real property form

**Files:**
- Modify: `src/views/partials/seller/onboarding-step-2.njk`
- Modify: `src/domains/seller/seller.service.ts`
- Modify: `src/domains/seller/seller.router.ts`

- [ ] **Step 1: Replace the stub onboarding step 2 with real property form**

Replace the contents of `src/views/partials/seller/onboarding-step-2.njk` with:

```nunjucks
<div class="max-w-2xl mx-auto">
  <h2 class="text-xl font-bold text-gray-900 mb-2">{{ "Your Property Details" | t }}</h2>
  <p class="text-gray-600 mb-6">{{ "Tell us about the HDB flat you'd like to sell." | t }}</p>

  {% if error %}
  <div class="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
    <p class="text-sm text-red-800">{{ error }}</p>
  </div>
  {% endif %}

  <form
    hx-post="/seller/onboarding/step/2"
    hx-target="#onboarding-step"
    hx-swap="innerHTML"
    class="space-y-4"
  >
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label for="town" class="block text-sm font-medium text-gray-700 mb-1">{{ "Town" | t }}</label>
        <select id="town" name="town" required
          class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
          <option value="">{{ "Select town" | t }}</option>
          {% for t in towns %}
          <option value="{{ t }}" {% if property and property.town == t %}selected{% endif %}>{{ t }}</option>
          {% endfor %}
        </select>
      </div>

      <div>
        <label for="flatType" class="block text-sm font-medium text-gray-700 mb-1">{{ "Flat Type" | t }}</label>
        <select id="flatType" name="flatType" required
          class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
          <option value="">{{ "Select flat type" | t }}</option>
          {% for ft in flatTypes %}
          <option value="{{ ft }}" {% if property and property.flatType == ft %}selected{% endif %}>{{ ft }}</option>
          {% endfor %}
        </select>
      </div>

      <div>
        <label for="block" class="block text-sm font-medium text-gray-700 mb-1">{{ "Block" | t }}</label>
        <input type="text" id="block" name="block" value="{{ property.block if property else '' }}" required
          class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
      </div>

      <div>
        <label for="street" class="block text-sm font-medium text-gray-700 mb-1">{{ "Street Name" | t }}</label>
        <input type="text" id="street" name="street" value="{{ property.street if property else '' }}" required
          class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
      </div>

      <div>
        <label for="storeyRange" class="block text-sm font-medium text-gray-700 mb-1">{{ "Storey Range" | t }}</label>
        <input type="text" id="storeyRange" name="storeyRange" value="{{ property.storeyRange if property else '' }}" required
          placeholder="e.g. 07 TO 09"
          class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
      </div>

      <div>
        <label for="floorAreaSqm" class="block text-sm font-medium text-gray-700 mb-1">{{ "Floor Area (sqm)" | t }}</label>
        <input type="number" id="floorAreaSqm" name="floorAreaSqm" value="{{ property.floorAreaSqm if property else '' }}" required
          min="30" max="300" step="0.1"
          class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
      </div>

      <div>
        <label for="flatModel" class="block text-sm font-medium text-gray-700 mb-1">{{ "Flat Model" | t }}</label>
        <input type="text" id="flatModel" name="flatModel" value="{{ property.flatModel if property else '' }}" required
          class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
      </div>

      <div>
        <label for="leaseCommenceDate" class="block text-sm font-medium text-gray-700 mb-1">{{ "Lease Commencement Year" | t }}</label>
        <input type="number" id="leaseCommenceDate" name="leaseCommenceDate" value="{{ property.leaseCommenceDate if property else '' }}" required
          min="1960" max="2026"
          class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
      </div>
    </div>

    <div class="flex justify-end pt-4">
      <button type="submit"
        class="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
        {{ "Save & Continue" | t }}
      </button>
    </div>
  </form>
</div>
```

- [ ] **Step 2: Update seller router to handle step 2 property data**

In `src/domains/seller/seller.router.ts`, modify the `POST /seller/onboarding/step/:step` handler. Inside the step completion logic, before calling `completeOnboardingStep`, add handling for step 2 data:

```typescript
// Add import at the top:
import { propertyService } from '../property/property.service';
import { HDB_TOWNS, HDB_FLAT_TYPES } from '../property/property.types';

// In the POST handler, before completeOnboardingStep, add step 2 logic:
// When step is 2, create or update property from form data
const stepNum = parseInt(req.params.step, 10);
if (stepNum === 2) {
  const { town, street, block, flatType, storeyRange, floorAreaSqm, flatModel, leaseCommenceDate } = req.body;

  if (!town || !street || !block || !flatType || !storeyRange || !floorAreaSqm || !flatModel || !leaseCommenceDate) {
    return res.render('partials/seller/onboarding-step-2', {
      towns: HDB_TOWNS,
      flatTypes: HDB_FLAT_TYPES,
      error: 'All property fields are required.',
    });
  }

  const existing = await propertyService.getPropertyForSeller(sellerId);
  if (existing) {
    await propertyService.updateProperty(existing.id, sellerId, {
      town, street, block, flatType, storeyRange,
      floorAreaSqm: parseFloat(floorAreaSqm),
      flatModel,
      leaseCommenceDate: parseInt(leaseCommenceDate, 10),
    });
  } else {
    await propertyService.createProperty({
      sellerId,
      town, street, block, flatType, storeyRange,
      floorAreaSqm: parseFloat(floorAreaSqm),
      flatModel,
      leaseCommenceDate: parseInt(leaseCommenceDate, 10),
    });
  }
}
```

Also update the `GET /seller/onboarding/step/:step` handler so step 2 passes property data and reference lists:

```typescript
// When step is 2, pass property data and reference lists
if (stepNum === 2) {
  const property = await propertyService.getPropertyForSeller(sellerId);
  return res.render(`partials/seller/onboarding-step-2`, {
    status: onboarding,
    property,
    towns: HDB_TOWNS,
    flatTypes: HDB_FLAT_TYPES,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/seller/onboarding-step-2.njk src/domains/seller/seller.router.ts
git commit -m "feat(seller): connect onboarding step 2 to real property creation"
```

---

## Chunk 7: Router Tests + Factory Updates + Integration Tests

### Task 10: Add listing factory to test fixtures

**Files:**
- Modify: `tests/fixtures/factory.ts`

- [ ] **Step 1: Add listing and videoTutorial factories**

Add to the factory object in `tests/fixtures/factory.ts`:

```typescript
async listing(overrides: {
  propertyId: string;
  title?: string;
  description?: string;
  status?: 'draft' | 'pending_review' | 'approved' | 'live' | 'paused' | 'closed';
  photos?: string;
}) {
  return testPrisma.listing.create({
    data: {
      id: createId(),
      propertyId: overrides.propertyId,
      title: overrides.title ?? null,
      description: overrides.description ?? null,
      status: overrides.status ?? 'draft',
      photos: overrides.photos ?? '[]',
    },
  });
},

async videoTutorial(overrides?: {
  title?: string;
  slug?: string;
  description?: string;
  youtubeUrl?: string;
  category?: 'photography' | 'forms' | 'process' | 'financial';
  orderIndex?: number;
}) {
  return testPrisma.videoTutorial.create({
    data: {
      id: createId(),
      title: overrides?.title ?? 'Test Tutorial',
      slug: overrides?.slug ?? `test-tutorial-${createId()}`,
      description: overrides?.description ?? 'A test video tutorial',
      youtubeUrl: overrides?.youtubeUrl ?? 'https://www.youtube.com/watch?v=test',
      category: overrides?.category ?? 'process',
      orderIndex: overrides?.orderIndex ?? 0,
    },
  });
},
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/factory.ts
git commit -m "feat(test): add listing and videoTutorial factories"
```

---

### Task 11: Create property router unit tests

**Files:**
- Create: `src/domains/property/__tests__/property.router.test.ts`

- [ ] **Step 1: Write router tests**

Create `src/domains/property/__tests__/property.router.test.ts`:

```typescript
import request from 'supertest';
import express from 'express';
import nunjucks from 'nunjucks';
import path from 'path';
import { propertyRouter } from '../property.router';
import { propertyService } from '../property.service';
import { photoService } from '../photo.service';

jest.mock('../property.service');
jest.mock('../photo.service');

const mockedPropertyService = jest.mocked(propertyService);
const mockedPhotoService = jest.mocked(photoService);

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const viewsPath = path.resolve(__dirname, '../../../views');
  const env = nunjucks.configure(viewsPath, { autoescape: true, express: app });
  env.addFilter('t', (str: string) => str);
  env.addFilter('date', (val: string) => val);
  env.addFilter('formatPrice', (val: any) => String(val));
  app.set('view engine', 'njk');

  // Mock auth middleware
  app.use((req: any, _res, next) => {
    req.user = { id: 'seller-1', role: 'seller', email: 'test@test.com', name: 'Test Seller' };
    req.isAuthenticated = () => true;
    next();
  });

  app.use(propertyRouter);
  return app;
}

describe('propertyRouter', () => {
  let app: express.Application;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => jest.clearAllMocks());

  describe('GET /seller/property', () => {
    it('returns 200 with property data', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue({
        id: 'p1',
        town: 'TAMPINES',
        flatType: '4 ROOM',
        listings: [],
      } as any);

      const res = await request(app).get('/seller/property');
      expect(res.status).toBe(200);
    });

    it('returns 200 with empty state when no property', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(null);

      const res = await request(app).get('/seller/property');
      expect(res.status).toBe(200);
    });

    it('returns partial for HTMX request', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(null);

      const res = await request(app)
        .get('/seller/property')
        .set('HX-Request', 'true');
      expect(res.status).toBe(200);
    });
  });

  describe('PUT /seller/property', () => {
    it('creates property when none exists', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(null);
      mockedPropertyService.createProperty.mockResolvedValue({
        id: 'p1',
        town: 'TAMPINES',
      } as any);

      const res = await request(app)
        .put('/seller/property')
        .send({
          town: 'TAMPINES',
          street: 'TAMPINES ST 21',
          block: '123',
          flatType: '4 ROOM',
          storeyRange: '07 TO 09',
          floorAreaSqm: '92',
          flatModel: 'Model A',
          leaseCommenceDate: '2000',
        });

      expect(res.status).toBe(200);
      expect(mockedPropertyService.createProperty).toHaveBeenCalled();
    });

    it('updates existing property', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue({
        id: 'p1',
        sellerId: 'seller-1',
        askingPrice: 500000,
      } as any);
      mockedPropertyService.updateProperty.mockResolvedValue({ id: 'p1' } as any);

      const res = await request(app)
        .put('/seller/property')
        .send({ town: 'BEDOK' });

      expect(res.status).toBe(200);
      expect(mockedPropertyService.updateProperty).toHaveBeenCalled();
    });
  });

  describe('GET /seller/photos', () => {
    it('returns 200 with photos', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue({ id: 'p1' } as any);
      mockedPhotoService.getPhotosForProperty.mockResolvedValue([]);

      const res = await request(app).get('/seller/photos');
      expect(res.status).toBe(200);
    });

    it('handles no property gracefully', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(null);

      const res = await request(app).get('/seller/photos');
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /seller/photos/:id', () => {
    it('deletes photo and returns updated grid', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue({ id: 'p1' } as any);
      mockedPhotoService.removePhoto.mockResolvedValue(undefined);
      mockedPhotoService.getPhotosForProperty.mockResolvedValue([]);

      const res = await request(app).delete('/seller/photos/ph1');
      expect(res.status).toBe(200);
      expect(mockedPhotoService.removePhoto).toHaveBeenCalledWith('p1', 'ph1');
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run:
```bash
npm test -- --testPathPattern="property.router" --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/domains/property/__tests__/property.router.test.ts
git commit -m "test(property): add property router unit tests"
```

---

### Task 12: Create integration tests

**Files:**
- Create: `tests/integration/property.test.ts`

- [ ] **Step 1: Write integration tests**

Create `tests/integration/property.test.ts`:

```typescript
import request from 'supertest';
import bcrypt from 'bcrypt';
import { createApp } from '../../src/infra/http/app';
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';

const app = createApp();

async function loginAsSeller(overrides?: { onboardingStep?: number; status?: string }) {
  const password = 'TestPass123!';
  const hash = await bcrypt.hash(password, 4);
  const agent = await factory.agent();
  const seller = await factory.seller({
    passwordHash: hash,
    agentId: agent.id,
    status: (overrides?.status as any) ?? 'active',
    onboardingStep: overrides?.onboardingStep ?? 5,
  });

  const session = request.agent(app);
  await session.post('/auth/login').send({ email: seller.email, password });
  return { session, seller, agent };
}

describe('Property Domain Integration', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  describe('GET /seller/property', () => {
    it('returns 200 for authenticated seller', async () => {
      const { session } = await loginAsSeller();
      const res = await session.get('/seller/property');
      expect(res.status).toBe(200);
    });

    it('returns 401 for unauthenticated request', async () => {
      const res = await request(app).get('/seller/property');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /seller/property — create', () => {
    it('creates a property and listing for seller', async () => {
      const { session, seller } = await loginAsSeller();

      const res = await session.put('/seller/property').send({
        town: 'TAMPINES',
        street: 'TAMPINES ST 21',
        block: '123',
        flatType: '4 ROOM',
        storeyRange: '07 TO 09',
        floorAreaSqm: '92',
        flatModel: 'Model A',
        leaseCommenceDate: '2000',
      });

      expect(res.status).toBe(200);

      // Verify property created in DB
      const property = await testPrisma.property.findFirst({
        where: { sellerId: seller.id },
        include: { listings: true },
      });
      expect(property).not.toBeNull();
      expect(property!.town).toBe('TAMPINES');
      expect(property!.status).toBe('draft');
      expect(property!.listings).toHaveLength(1);
      expect(property!.listings[0].status).toBe('draft');
    });

    it('creates audit log entry', async () => {
      const { session } = await loginAsSeller();

      await session.put('/seller/property').send({
        town: 'BEDOK',
        street: 'BEDOK NORTH AVE 1',
        block: '456',
        flatType: '3 ROOM',
        storeyRange: '01 TO 03',
        floorAreaSqm: '68',
        flatModel: 'New Generation',
        leaseCommenceDate: '1990',
      });

      const audit = await testPrisma.auditLog.findFirst({
        where: { action: 'property.created' },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe('PUT /seller/property — update with price change', () => {
    it('tracks price change in history', async () => {
      const { session, seller } = await loginAsSeller();

      // First create property
      await session.put('/seller/property').send({
        town: 'TAMPINES',
        street: 'TAMPINES ST 21',
        block: '123',
        flatType: '4 ROOM',
        storeyRange: '07 TO 09',
        floorAreaSqm: '92',
        flatModel: 'Model A',
        leaseCommenceDate: '2000',
        askingPrice: '500000',
      });

      // Update price
      await session.put('/seller/property').send({
        askingPrice: '520000',
      });

      const property = await testPrisma.property.findFirst({
        where: { sellerId: seller.id },
      });
      expect(Number(property!.askingPrice)).toBe(520000);

      const audit = await testPrisma.auditLog.findFirst({
        where: { action: 'property.price_changed' },
      });
      expect(audit).not.toBeNull();
    });

    it('reverts live listing to pending_review on price change', async () => {
      const { session, seller } = await loginAsSeller();

      // Create property with listing
      await session.put('/seller/property').send({
        town: 'TAMPINES',
        street: 'TAMPINES ST 21',
        block: '123',
        flatType: '4 ROOM',
        storeyRange: '07 TO 09',
        floorAreaSqm: '92',
        flatModel: 'Model A',
        leaseCommenceDate: '2000',
        askingPrice: '500000',
      });

      // Manually set listing to live (simulating agent approval)
      const property = await testPrisma.property.findFirst({
        where: { sellerId: seller.id },
        include: { listings: true },
      });
      await testPrisma.listing.update({
        where: { id: property!.listings[0].id },
        data: { status: 'live' },
      });

      // Now update price
      await session.put('/seller/property').send({
        askingPrice: '520000',
      });

      const listing = await testPrisma.listing.findFirst({
        where: { propertyId: property!.id },
      });
      expect(listing!.status).toBe('pending_review');
    });
  });

  describe('GET /seller/photos', () => {
    it('returns 200 for authenticated seller', async () => {
      const { session } = await loginAsSeller();
      const res = await session.get('/seller/photos');
      expect(res.status).toBe(200);
    });
  });

  describe('Onboarding step 2 — property creation', () => {
    it('creates property during onboarding step 2', async () => {
      const { session, seller } = await loginAsSeller({ onboardingStep: 1 });

      const res = await session
        .post('/seller/onboarding/step/2')
        .set('HX-Request', 'true')
        .send({
          town: 'TAMPINES',
          street: 'TAMPINES ST 21',
          block: '123',
          flatType: '4 ROOM',
          storeyRange: '07 TO 09',
          floorAreaSqm: '92',
          flatModel: 'Model A',
          leaseCommenceDate: '2000',
        });

      expect(res.status).toBe(200);

      // Verify property was created
      const property = await testPrisma.property.findFirst({
        where: { sellerId: seller.id },
      });
      expect(property).not.toBeNull();
      expect(property!.town).toBe('TAMPINES');

      // Verify onboarding step advanced
      const updatedSeller = await testPrisma.seller.findUnique({
        where: { id: seller.id },
      });
      expect(updatedSeller!.onboardingStep).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Run integration tests**

Run:
```bash
npm run test:integration -- --testPathPattern="property" --no-coverage
```

Expected: All tests PASS (requires test database running via `npm run docker:test:db`).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/property.test.ts
git commit -m "test(property): add integration tests for property CRUD and onboarding step 2"
```

---

## Chunk 8: Lint, Format, Final Verification

### Task 13: Lint, format, and run full test suite

- [ ] **Step 1: Run linter**

Run:
```bash
npm run lint
```

Expected: No errors (warnings OK). Fix any lint errors.

- [ ] **Step 2: Run formatter**

Run:
```bash
npm run format
```

- [ ] **Step 3: Run all unit tests**

Run:
```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 4: Run integration tests**

Run:
```bash
npm run test:integration
```

Expected: All tests PASS.

- [ ] **Step 5: Commit any lint/format fixes**

```bash
git add -A
git commit -m "style: fix lint errors and format Phase 2B files with Prettier"
```

---

## Summary

Phase 2B delivers:

1. **Property domain** (`src/domains/property/`) — types, repository, service, validator, router
2. **Photo upload** — multer + sharp processing, 5MB limit, 800px min, JPEG optimization to 2000px max
3. **Listing state machine** — `draft → pending_review → approved → live → paused → closed`
4. **Price change logic** — price history tracking, auto-revert live listing to `pending_review`
5. **Onboarding Step 2** — creates real Property + draft Listing record with HDB town/flat type selection
6. **Views** — property details page, photo management page with upload/delete/reorder
7. **Tests** — unit tests for repository, service, photo service, router; integration tests for CRUD, price changes, and onboarding flow
