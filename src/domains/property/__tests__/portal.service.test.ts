// src/domains/property/__tests__/portal.service.test.ts
import * as portalService from '../portal.service';
import * as portalRepo from '../portal.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as auditService from '@/domains/shared/audit.service';
import { NotFoundError, ForbiddenError } from '@/domains/shared/errors';

jest.mock('../portal.repository');
jest.mock('@/domains/shared/settings.service');
jest.mock('@/domains/shared/audit.service');

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
      storeyRange: '07 TO 09',
      floorAreaSqm: 93,
      flatModel: 'Model A',
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
      mockPortalRepo.updatePortalListing.mockResolvedValue({
        id: 'pl-1',
        status: 'posted',
        portalListingUrl: 'https://www.propertyguru.com.sg/listing/123',
      } as never);

      const result = await portalService.markAsPosted(
        'pl-1',
        'https://www.propertyguru.com.sg/listing/123',
      );
      expect(result.status).toBe('posted');
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
});
