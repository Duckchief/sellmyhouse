import * as propertyRepo from '../property.repository';
import type { CreatePropertyInput, UpdatePropertyInput, PhotoRecord } from '../property.types';

jest.mock('../../../infra/database/prisma', () => ({
  prisma: {
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
  },
}));
jest.mock('@paralleldrive/cuid2', () => ({ createId: () => 'test-id-123' }));

const { prisma } = jest.requireMock('../../../infra/database/prisma');

describe('property.repository', () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── create ──────────────────────────────────────────────

  describe('create', () => {
    it('creates a property with generated id and empty priceHistory', async () => {
      const input: CreatePropertyInput = {
        sellerId: 'seller-1',
        town: 'ANG MO KIO',
        street: 'ANG MO KIO AVE 3',
        block: '123',
        flatType: '4 ROOM',
        level: '07',
        unitNumber: '09',
        floorAreaSqm: 92,
        leaseCommenceDate: 1985,
        askingPrice: 580000,
      };

      const mockProperty = {
        id: 'test-id-123',
        ...input,
        priceHistory: '[]',
        status: 'draft',
      };

      prisma.property.create.mockResolvedValue(mockProperty);

      const result = await propertyRepo.create(input);

      expect(result).toEqual(mockProperty);
      expect(prisma.property.create).toHaveBeenCalledWith({
        data: {
          id: 'test-id-123',
          priceHistory: '[]',
          ...input,
        },
      });
    });
  });

  // ─── findByIdWithListings ─────────────────────────────────

  describe('findByIdWithListings', () => {
    it('returns property with listings when found', async () => {
      const mockProperty = {
        id: 'prop-1',
        sellerId: 'seller-1',
        listings: [{ id: 'listing-1', status: 'draft' }],
      };
      prisma.property.findUnique.mockResolvedValue(mockProperty);

      const result = await propertyRepo.findByIdWithListings('prop-1');

      expect(result).toEqual(mockProperty);
      expect(prisma.property.findUnique).toHaveBeenCalledWith({
        where: { id: 'prop-1' },
        include: { listings: true },
      });
    });

    it('returns null when not found', async () => {
      prisma.property.findUnique.mockResolvedValue(null);

      const result = await propertyRepo.findByIdWithListings('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ─── findBySellerId ───────────────────────────────────────

  describe('findBySellerId', () => {
    it('returns property with listings for seller', async () => {
      const mockProperty = {
        id: 'prop-1',
        sellerId: 'seller-1',
        listings: [],
      };
      prisma.property.findFirst.mockResolvedValue(mockProperty);

      const result = await propertyRepo.findBySellerId('seller-1');

      expect(result).toEqual(mockProperty);
      expect(prisma.property.findFirst).toHaveBeenCalledWith({
        where: { sellerId: 'seller-1' },
        include: { listings: true },
      });
    });

    it('returns null when seller has no property', async () => {
      prisma.property.findFirst.mockResolvedValue(null);

      const result = await propertyRepo.findBySellerId('seller-no-property');

      expect(result).toBeNull();
    });
  });

  // ─── update ───────────────────────────────────────────────

  describe('update', () => {
    it('updates property and returns with listings', async () => {
      const updateData: UpdatePropertyInput = {
        askingPrice: 600000,
        level: '10',
        unitNumber: '12',
      };
      const mockUpdated = {
        id: 'prop-1',
        askingPrice: 600000,
        level: '10',
        unitNumber: '12',
        listings: [],
      };
      prisma.property.update.mockResolvedValue(mockUpdated);

      const result = await propertyRepo.update('prop-1', updateData);

      expect(result).toEqual(mockUpdated);
      expect(prisma.property.update).toHaveBeenCalledWith({
        where: { id: 'prop-1' },
        data: updateData,
        include: { listings: true },
      });
    });
  });

  // ─── appendPriceHistory ───────────────────────────────────

  describe('appendPriceHistory', () => {
    it('parses existing history, appends new entry, and updates property', async () => {
      const existingHistory = [
        { price: 550000, changedAt: '2025-01-01T00:00:00.000Z', changedBy: 'agent-0' },
      ];
      const mockProperty = {
        id: 'prop-1',
        askingPrice: 550000,
        priceHistory: JSON.stringify(existingHistory),
        listings: [],
      };

      // First call returns current property, second returns updated
      prisma.property.findUnique.mockResolvedValue(mockProperty);

      const mockUpdated = {
        id: 'prop-1',
        askingPrice: 600000,
        priceHistory: expect.any(String),
        listings: [],
      };
      prisma.property.update.mockResolvedValue(mockUpdated);

      const result = await propertyRepo.appendPriceHistory('prop-1', 600000, 'agent-1');

      expect(prisma.property.findUnique).toHaveBeenCalledWith({
        where: { id: 'prop-1' },
        include: { listings: true },
      });

      const updateCall = prisma.property.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: 'prop-1' });
      expect(updateCall.data.askingPrice).toBe(600000);

      const updatedHistory = JSON.parse(updateCall.data.priceHistory);
      expect(updatedHistory).toHaveLength(2);
      expect(updatedHistory[1].price).toBe(600000);
      expect(updatedHistory[1].changedBy).toBe('agent-1');
      expect(updatedHistory[1].changedAt).toBeDefined();

      expect(updateCall.include).toEqual({ listings: true });
      expect(result).toEqual(mockUpdated);
    });

    it('works when priceHistory is empty array string', async () => {
      const mockProperty = {
        id: 'prop-1',
        askingPrice: null,
        priceHistory: '[]',
        listings: [],
      };
      prisma.property.findUnique.mockResolvedValue(mockProperty);
      prisma.property.update.mockResolvedValue({ ...mockProperty, askingPrice: 500000 });

      await propertyRepo.appendPriceHistory('prop-1', 500000, 'seller-1');

      const updateCall = prisma.property.update.mock.calls[0][0];
      const updatedHistory = JSON.parse(updateCall.data.priceHistory);
      expect(updatedHistory).toHaveLength(1);
      expect(updatedHistory[0].price).toBe(500000);
    });
  });

  // ─── createListing ────────────────────────────────────────

  describe('createListing', () => {
    it('creates a listing with generated id, draft status, and empty photos', async () => {
      const mockListing = {
        id: 'test-id-123',
        propertyId: 'prop-1',
        status: 'draft',
        photos: '[]',
      };
      prisma.listing.create.mockResolvedValue(mockListing);

      const result = await propertyRepo.createListing('prop-1');

      expect(result).toEqual(mockListing);
      expect(prisma.listing.create).toHaveBeenCalledWith({
        data: {
          id: 'test-id-123',
          propertyId: 'prop-1',
          status: 'draft',
          photos: '[]',
        },
      });
    });
  });

  // ─── findActiveListingForProperty ─────────────────────────

  describe('findActiveListingForProperty', () => {
    it('finds first non-closed listing ordered by createdAt desc', async () => {
      const mockListing = { id: 'listing-1', propertyId: 'prop-1', status: 'live' };
      prisma.listing.findFirst.mockResolvedValue(mockListing);

      const result = await propertyRepo.findActiveListingForProperty('prop-1');

      expect(result).toEqual(mockListing);
      expect(prisma.listing.findFirst).toHaveBeenCalledWith({
        where: {
          propertyId: 'prop-1',
          status: { notIn: ['closed'] },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns null when no active listing exists', async () => {
      prisma.listing.findFirst.mockResolvedValue(null);

      const result = await propertyRepo.findActiveListingForProperty('prop-1');

      expect(result).toBeNull();
    });
  });

  // ─── updateListingStatus ──────────────────────────────────

  describe('updateListingStatus', () => {
    it('updates the listing status', async () => {
      const mockListing = { id: 'listing-1', status: 'pending_review' };
      prisma.listing.update.mockResolvedValue(mockListing);

      const result = await propertyRepo.updateListingStatus('listing-1', 'pending_review');

      expect(result).toEqual(mockListing);
      expect(prisma.listing.update).toHaveBeenCalledWith({
        where: { id: 'listing-1' },
        data: { status: 'pending_review' },
      });
    });
  });

  // ─── updateListingPhotos ──────────────────────────────────

  describe('updateListingPhotos', () => {
    it('stores photos as JSON string', async () => {
      const photos: PhotoRecord[] = [
        {
          id: 'photo-1',
          filename: 'photo-1.jpg',
          originalFilename: 'living-room.jpg',
          path: '/uploads/photos/photo-1.jpg',
          optimizedPath: '/uploads/photos/photo-1-opt.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1024000,
          width: 1920,
          height: 1080,
          displayOrder: 0,
          status: 'uploaded',
          uploadedAt: new Date('2026-03-10T00:00:00.000Z'),
        },
      ];

      const mockListing = { id: 'listing-1', photos: JSON.stringify(photos) };
      prisma.listing.update.mockResolvedValue(mockListing);

      const result = await propertyRepo.updateListingPhotos('listing-1', photos);

      expect(result).toEqual(mockListing);
      expect(prisma.listing.update).toHaveBeenCalledWith({
        where: { id: 'listing-1' },
        data: { photos: JSON.stringify(photos) },
      });
    });

    it('stores empty array as JSON string when no photos', async () => {
      prisma.listing.update.mockResolvedValue({ id: 'listing-1', photos: '[]' });

      await propertyRepo.updateListingPhotos('listing-1', []);

      expect(prisma.listing.update).toHaveBeenCalledWith({
        where: { id: 'listing-1' },
        data: { photos: '[]' },
      });
    });
  });
});
