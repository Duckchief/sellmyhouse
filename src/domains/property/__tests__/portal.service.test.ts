// src/domains/property/__tests__/portal.service.test.ts
import * as portalService from '../portal.service';
import * as portalRepo from '../portal.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as auditService from '@/domains/shared/audit.service';
import { NotFoundError, ForbiddenError } from '@/domains/shared/errors';

jest.mock('../portal.repository');
jest.mock('@/domains/shared/settings.service');
jest.mock('@/domains/shared/audit.service');

import { localStorage } from '../../../infra/storage/local-storage';

jest.mock('../../../infra/storage/local-storage', () => ({
  localStorage: {
    read: jest.fn().mockResolvedValue(Buffer.from('img-data')),
    delete: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockedStorage = jest.mocked(localStorage);

const mockPortalRepo = jest.mocked(portalRepo);
const mockSettings = jest.mocked(settingsService);
const mockAudit = jest.mocked(auditService);

function makeListingWithRelations(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    propertyId: 'property-1',
    title: '4-Room Flat in Tampines',
    description: 'Great flat',
    photos: JSON.stringify(['/uploads/photos/seller-1/prop-1/optimized/photo1.jpg']),
    status: 'approved',
    property: {
      id: 'property-1',
      sellerId: 'seller-1',
      town: 'TAMPINES',
      flatType: '4 ROOM',
      level: '07',
      unitNumber: '123',
      floorAreaSqm: 93,
      block: '123',
      street: 'TAMPINES ST 21',
      leaseCommenceDate: 1995,
      askingPrice: '650000',
      seller: {
        agent: {
          id: 'agent-1',
          name: 'Jane Tan',
          ceaRegNo: 'R012345A',
          phone: '91234567',
        },
      },
    },
    ...overrides,
  };
}

describe('portal.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'agency_name') return 'Huttons Asia Pte Ltd';
      if (key === 'agency_licence') return 'L3008899K';
      return '';
    });
    mockAudit.log.mockResolvedValue(undefined as never);
  });

  describe('generatePortalListings', () => {
    it('creates PortalListing records for all three portals', async () => {
      mockPortalRepo.findListingWithAgent.mockResolvedValue(makeListingWithRelations() as never);
      mockPortalRepo.upsertPortalListing.mockResolvedValue({} as never);

      await portalService.generatePortalListings('listing-1');

      expect(mockPortalRepo.upsertPortalListing).toHaveBeenCalledTimes(3);
      const portalsUsed = mockPortalRepo.upsertPortalListing.mock.calls.map(
        (call) => (call[0] as { portalName: string }).portalName,
      );
      expect(portalsUsed).toContain('propertyguru');
      expect(portalsUsed).toContain('ninety_nine_co');
      expect(portalsUsed).toContain('srx');
    });

    it('throws NotFoundError if listing not found', async () => {
      mockPortalRepo.findListingWithAgent.mockResolvedValue(null);

      await expect(portalService.generatePortalListings('bad-id')).rejects.toThrow(NotFoundError);
    });
  });

  describe('markAsPosted', () => {
    it('sets status to posted and records URL and timestamp', async () => {
      mockPortalRepo.findPortalListingWithAgent.mockResolvedValue({
        id: 'pl-1',
        listing: { property: { seller: { agentId: 'agent-1' } } },
      } as never);
      mockPortalRepo.updatePortalListing.mockResolvedValue({
        id: 'pl-1',
        status: 'posted',
        portalListingUrl: 'https://www.propertyguru.com.sg/listing/123',
      } as never);

      const result = await portalService.markAsPosted(
        'pl-1',
        'https://www.propertyguru.com.sg/listing/123',
        'agent-1',
        'agent',
      );
      expect(result.status).toBe('posted');
    });

    it('throws ForbiddenError when agent does not own the portal listing', async () => {
      mockPortalRepo.findPortalListingWithAgent.mockResolvedValue({
        id: 'pl-1',
        listing: { property: { seller: { agentId: 'agent-2' } } },
      } as never);

      await expect(
        portalService.markAsPosted(
          'pl-1',
          'https://www.propertyguru.com.sg/listing/123',
          'agent-1',
          'agent',
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows admin to mark any portal listing as posted', async () => {
      mockPortalRepo.findPortalListingWithAgent.mockResolvedValue({
        id: 'pl-1',
        listing: { property: { seller: { agentId: 'agent-2' } } },
      } as never);
      mockPortalRepo.updatePortalListing.mockResolvedValue({
        id: 'pl-1',
        status: 'posted',
        portalListingUrl: 'https://www.propertyguru.com.sg/listing/123',
      } as never);

      await expect(
        portalService.markAsPosted(
          'pl-1',
          'https://www.propertyguru.com.sg/listing/123',
          'admin-1',
          'admin',
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('getPortalListings', () => {
    it('returns all portal listings for a listing (no ownership filter)', async () => {
      mockPortalRepo.findPortalListingsByListingId.mockResolvedValue([
        { id: 'pl-1', portalName: 'propertyguru' },
        { id: 'pl-2', portalName: 'ninety_nine_co' },
      ] as never);

      const results = await portalService.getPortalListings('listing-1');
      expect(results).toHaveLength(2);
    });

    it('returns portal listings for agent assigned to listing', async () => {
      mockPortalRepo.findListingWithAgent.mockResolvedValue({
        id: 'listing-1',
        property: { seller: { agentId: 'agent-1' } },
      } as never);
      mockPortalRepo.findPortalListingsByListingId.mockResolvedValue([
        { id: 'pl-1', portalName: 'propertyguru' },
      ] as never);

      const results = await portalService.getPortalListings('listing-1', 'agent-1', 'agent');
      expect(results).toHaveLength(1);
    });

    it('throws ForbiddenError for agent not assigned to listing', async () => {
      mockPortalRepo.findListingWithAgent.mockResolvedValue({
        id: 'listing-1',
        property: { seller: { agentId: 'agent-1' } },
      } as never);

      await expect(
        portalService.getPortalListings('listing-1', 'agent-2', 'agent'),
      ).rejects.toThrow(ForbiddenError);
    });

    it('admin bypasses ownership check and returns all portal listings', async () => {
      mockPortalRepo.findPortalListingsByListingId.mockResolvedValue([
        { id: 'pl-1', portalName: 'propertyguru' },
      ] as never);

      const results = await portalService.getPortalListings('listing-1', 'admin-user', 'admin');
      expect(results).toHaveLength(1);
      // ownership check (findListingWithAgent) is skipped for admins
      expect(mockPortalRepo.findListingWithAgent).not.toHaveBeenCalled();
    });
  });

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
      const photos = [
        { id: 'p1', displayOrder: 0, optimizedPath: 'opt/p1.jpg', path: 'orig/p1.jpg' },
      ];
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

    it('throws NotFoundError when listing does not exist', async () => {
      mockPortalRepo.findListingById = jest.fn().mockResolvedValue(null);

      await expect(
        portalService.getListingForPortalsPage('nonexistent-id', 'agent-1', 'agent'),
      ).rejects.toThrow(NotFoundError);
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

    it('proceeds with deletion and DB clear even if a photo file is missing from disk', async () => {
      mockPortalRepo.findListingById.mockResolvedValue({
        id: 'listing-1',
        photos: JSON.stringify(photos),
        photosApprovedAt: new Date(),
        property: { seller: { agentId: 'agent-1' } },
      });
      mockedStorage.read.mockRejectedValue(new Error('File not found'));

      const result = await portalService.downloadAndDeletePhotos('listing-1', 'agent-1', 'agent');

      expect(result.files).toHaveLength(0); // read failed, no buffers
      expect(mockedStorage.delete).toHaveBeenCalled(); // but deletes still ran
      expect(mockPortalRepo.clearListingPhotos).toHaveBeenCalledWith('listing-1'); // DB cleared
    });
  });

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

    it('throws NotFoundError when listing does not exist', async () => {
      mockPortalRepo.findListingById = jest.fn().mockResolvedValue(null);

      await expect(
        portalService.reinstatePhotoUpload('nonexistent-id', 'agent-1', 'agent'),
      ).rejects.toThrow(NotFoundError);

      expect(mockPortalRepo.reinstateListingPhotos).not.toHaveBeenCalled();
    });
  });
});
