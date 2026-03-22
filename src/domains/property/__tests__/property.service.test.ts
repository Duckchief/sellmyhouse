import * as propertyService from '../property.service';
import * as propertyRepo from '../property.repository';
import * as auditService from '../../shared/audit.service';
import * as reviewService from '../../review/review.service';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ComplianceError,
} from '../../shared/errors';
import type { Property, Listing } from '@prisma/client';
import type { PropertyWithListing } from '../property.types';

jest.mock('../property.repository');
jest.mock('../../shared/audit.service');
jest.mock('../../review/review.service');
jest.mock('../../seller/case-flag.service', () => ({
  hasActiveMopFlag: jest.fn().mockResolvedValue(false),
}));
jest.mock('@paralleldrive/cuid2', () => ({ createId: jest.fn().mockReturnValue('abcdef123456') }));
jest.mock('@/domains/auth/auth.repository');

const mockedRepo = jest.mocked(propertyRepo);
const mockedAudit = jest.mocked(auditService);
const mockedReviewService = jest.mocked(reviewService);
const mockedCaseFlagService = jest.requireMock('../../seller/case-flag.service') as {
  hasActiveMopFlag: jest.Mock;
};
const mockedAuthRepo = jest.requireMock('@/domains/auth/auth.repository');

describe('property.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedReviewService.checkComplianceGate.mockResolvedValue(undefined);
    mockedRepo.findBySlug.mockResolvedValue(null); // slug not taken by default
    mockedAuthRepo.findSellerById = jest.fn().mockResolvedValue({ id: 'seller-1', emailVerified: true });
  });

  // ─── createProperty ────────────────────────────────────────

  describe('createProperty', () => {
    it('creates property and draft listing, then logs audit', async () => {
      const input = {
        sellerId: 'seller-1',
        town: 'ANG MO KIO',
        street: 'Ang Mo Kio Ave 3',
        block: '123',
        flatType: '4 ROOM',
        level: '04',
        unitNumber: '56',
        floorAreaSqm: 90,
        leaseCommenceDate: 1990,
      };

      const fakeProperty = { id: 'prop-1', ...input };
      const fakeListing = { id: 'listing-1', propertyId: 'prop-1', status: 'draft' };

      mockedRepo.create.mockResolvedValue(fakeProperty as Property);
      mockedRepo.createListing.mockResolvedValue(fakeListing as unknown as Listing);
      mockedAudit.log.mockResolvedValue(undefined);

      const result = await propertyService.createProperty(input);

      expect(mockedRepo.create).toHaveBeenCalledWith(expect.objectContaining(input));
      expect(mockedRepo.createListing).toHaveBeenCalledWith('prop-1');
      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'property.created',
          entityType: 'property',
          entityId: 'prop-1',
        }),
      );
      expect(result).toEqual(fakeProperty);
    });

    it('always generates a non-null slug on creation', async () => {
      const input = {
        sellerId: 'seller-1',
        town: 'ANG MO KIO',
        street: 'Ang Mo Kio Ave 3',
        block: '123',
        flatType: '4 ROOM',
        level: '04',
        unitNumber: '56',
        floorAreaSqm: 90,
        leaseCommenceDate: 1990,
      };

      const expectedSlug = '123-ang-mo-kio-ave-3-ang-mo-kio';
      const fakeProperty = { id: 'prop-1', ...input, slug: expectedSlug };

      mockedRepo.findBySlug.mockResolvedValue(null); // slug not taken
      mockedRepo.create.mockResolvedValue(fakeProperty as unknown as Property);
      mockedRepo.createListing.mockResolvedValue({ id: 'listing-1' } as unknown as Listing);
      mockedAudit.log.mockResolvedValue(undefined);

      const result = await propertyService.createProperty(input);

      expect(mockedRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: expectedSlug }),
      );
      expect(result.slug).toBe(expectedSlug);
    });

    it('appends a unique suffix when slug already exists', async () => {
      const input = {
        sellerId: 'seller-1',
        town: 'ANG MO KIO',
        street: 'Ang Mo Kio Ave 3',
        block: '123',
        flatType: '4 ROOM',
        level: '04',
        unitNumber: '56',
        floorAreaSqm: 90,
        leaseCommenceDate: 1990,
      };

      // First call returns existing property (slug taken), second returns null
      mockedRepo.findBySlug
        .mockResolvedValueOnce({ id: 'other-prop' } as unknown as Property)
        .mockResolvedValueOnce(null);
      mockedRepo.create.mockResolvedValue({
        id: 'prop-1',
        ...input,
        slug: '123-ang-mo-kio-ave-3-ang-mo-kio-abcdef',
      } as unknown as Property);
      mockedRepo.createListing.mockResolvedValue({ id: 'listing-1' } as unknown as Listing);
      mockedAudit.log.mockResolvedValue(undefined);

      await propertyService.createProperty(input);

      expect(mockedRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: expect.stringContaining('123-ang-mo-kio-ave-3-ang-mo-kio-'),
        }),
      );
    });

    // ─── MOP enforcement ──────────────────────────────────────

    it('throws ComplianceError when active mop_not_met flag exists and no override reason', async () => {
      mockedCaseFlagService.hasActiveMopFlag.mockResolvedValueOnce(true);

      await expect(
        propertyService.createProperty({
          sellerId: 'seller-1',
          town: 'ANG MO KIO',
          street: 'Ang Mo Kio Ave 3',
          block: '123',
          flatType: '4 ROOM',
          level: '04',
        unitNumber: '56',
          floorAreaSqm: 90,
            leaseCommenceDate: 1990,
        }),
      ).rejects.toThrow(ComplianceError);

      expect(mockedRepo.create).not.toHaveBeenCalled();
    });

    it('proceeds and logs MOP override audit when override reason is provided', async () => {
      mockedCaseFlagService.hasActiveMopFlag.mockResolvedValueOnce(true);
      mockedRepo.create.mockResolvedValue({ id: 'prop-1' } as unknown as Property);
      mockedRepo.createListing.mockResolvedValue({ id: 'listing-1' } as unknown as Listing);
      mockedAudit.log.mockResolvedValue(undefined);

      await propertyService.createProperty({
        sellerId: 'seller-1',
        town: 'ANG MO KIO',
        street: 'Ang Mo Kio Ave 3',
        block: '123',
        flatType: '4 ROOM',
        level: '04',
        unitNumber: '56',
        floorAreaSqm: 90,
        leaseCommenceDate: 1990,
        mopOverrideReason: 'HDB hardship exemption granted — ref HDB/2026/001',
        agentId: 'agent-1',
      });

      expect(mockedRepo.create).toHaveBeenCalled();
      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          action: 'case_flag.mop_override',
          details: expect.objectContaining({
            mopOverrideReason: 'HDB hardship exemption granted — ref HDB/2026/001',
          }),
        }),
      );
    });

    it('throws ValidationError if seller email is not verified', async () => {
      mockedAuthRepo.findSellerById = jest.fn().mockResolvedValue({
        id: 'seller-1',
        emailVerified: false,
      });
      mockedCaseFlagService.hasActiveMopFlag.mockResolvedValue(false);

      await expect(
        propertyService.createProperty({
          sellerId: 'seller-1',
          agentId: 'agent-1',
          town: 'Ang Mo Kio',
          street: 'ANG MO KIO AVE 3',
          block: '123',
          flatType: 'four_room',
          level: '07',
          unitNumber: '09',
          floorAreaSqm: 90,
          leaseCommenceDate: 1985,
          askingPrice: 450000,
        }),
      ).rejects.toThrow('Please verify your email address');
    });
  });

  // ─── getPropertyForSeller ──────────────────────────────────

  describe('getPropertyForSeller', () => {
    it('returns property when found', async () => {
      const fakeProperty = { id: 'prop-1', sellerId: 'seller-1' };
      mockedRepo.findBySellerId.mockResolvedValue(fakeProperty as unknown as PropertyWithListing);

      const result = await propertyService.getPropertyForSeller('seller-1');

      expect(mockedRepo.findBySellerId).toHaveBeenCalledWith('seller-1');
      expect(result).toEqual(fakeProperty);
    });

    it('returns null when no property exists for seller', async () => {
      mockedRepo.findBySellerId.mockResolvedValue(null);

      const result = await propertyService.getPropertyForSeller('seller-1');

      expect(result).toBeNull();
    });
  });

  // ─── getPropertyById ──────────────────────────────────────

  describe('getPropertyById', () => {
    it('returns property with listings when found', async () => {
      const fakeProperty = { id: 'prop-1', listings: [] };
      mockedRepo.findByIdWithListings.mockResolvedValue(
        fakeProperty as unknown as PropertyWithListing,
      );

      const result = await propertyService.getPropertyById('prop-1');

      expect(result).toEqual(fakeProperty);
    });

    it('throws NotFoundError for missing property', async () => {
      mockedRepo.findByIdWithListings.mockResolvedValue(null);

      await expect(propertyService.getPropertyById('bad-id')).rejects.toThrow(NotFoundError);
    });
  });

  // ─── updateProperty ───────────────────────────────────────

  describe('updateProperty', () => {
    it('updates property and logs audit', async () => {
      const fakeProperty = { id: 'prop-1', sellerId: 'seller-1', listings: [] };
      const updatedProperty = {
        id: 'prop-1',
        sellerId: 'seller-1',
        flatType: '5 ROOM',
        listings: [],
      };

      mockedRepo.findByIdWithListings.mockResolvedValue(
        fakeProperty as unknown as PropertyWithListing,
      );
      mockedRepo.update.mockResolvedValue(updatedProperty as unknown as PropertyWithListing);
      mockedAudit.log.mockResolvedValue(undefined);

      const result = await propertyService.updateProperty('prop-1', 'seller-1', {
        flatType: '5 ROOM',
      });

      expect(mockedRepo.update).toHaveBeenCalledWith('prop-1', { flatType: '5 ROOM' });
      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'property.updated',
          entityType: 'property',
          entityId: 'prop-1',
        }),
      );
      expect(result).toEqual(updatedProperty);
    });

    it('throws NotFoundError for missing property', async () => {
      mockedRepo.findByIdWithListings.mockResolvedValue(null);

      await expect(
        propertyService.updateProperty('bad-id', 'seller-1', { flatType: '5 ROOM' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when sellerId does not match', async () => {
      const fakeProperty = { id: 'prop-1', sellerId: 'seller-1', listings: [] };
      mockedRepo.findByIdWithListings.mockResolvedValue(
        fakeProperty as unknown as PropertyWithListing,
      );

      await expect(
        propertyService.updateProperty('prop-1', 'seller-OTHER', { flatType: '5 ROOM' }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('reverts live listing to pending_review on property update', async () => {
      const liveListing = { id: 'listing-1', propertyId: 'prop-1', status: 'live' };
      const fakeProperty = { id: 'prop-1', sellerId: 'seller-1', listings: [liveListing] };
      const updatedProperty = { id: 'prop-1', sellerId: 'seller-1', listings: [liveListing] };

      mockedRepo.findByIdWithListings.mockResolvedValue(
        fakeProperty as unknown as PropertyWithListing,
      );
      mockedRepo.update.mockResolvedValue(updatedProperty as unknown as PropertyWithListing);
      mockedRepo.updateListingStatus.mockResolvedValue({
        ...liveListing,
        status: 'pending_review',
      } as unknown as Listing);
      mockedAudit.log.mockResolvedValue(undefined);

      await propertyService.updateProperty('prop-1', 'seller-1', { flatType: '5 ROOM' });

      expect(mockedRepo.updateListingStatus).toHaveBeenCalledWith('listing-1', 'pending_review');
    });

    it('does not revert draft listing on property update', async () => {
      const draftListing = { id: 'listing-1', propertyId: 'prop-1', status: 'draft' };
      const fakeProperty = { id: 'prop-1', sellerId: 'seller-1', listings: [draftListing] };
      const updatedProperty = { id: 'prop-1', sellerId: 'seller-1', listings: [draftListing] };

      mockedRepo.findByIdWithListings.mockResolvedValue(
        fakeProperty as unknown as PropertyWithListing,
      );
      mockedRepo.update.mockResolvedValue(updatedProperty as unknown as PropertyWithListing);
      mockedAudit.log.mockResolvedValue(undefined);

      await propertyService.updateProperty('prop-1', 'seller-1', { flatType: '5 ROOM' });

      expect(mockedRepo.updateListingStatus).not.toHaveBeenCalled();
    });
  });

  // ─── updateAskingPrice ────────────────────────────────────

  describe('updateAskingPrice', () => {
    it('appends to price history and logs audit with old and new prices', async () => {
      const fakeProperty = {
        id: 'prop-1',
        sellerId: 'seller-1',
        askingPrice: 500000,
        listings: [],
      };
      const updatedProperty = { ...fakeProperty, askingPrice: 520000 };

      mockedRepo.findByIdWithListings.mockResolvedValue(
        fakeProperty as unknown as PropertyWithListing,
      );
      mockedRepo.appendPriceHistory.mockResolvedValue(
        updatedProperty as unknown as PropertyWithListing,
      );
      mockedAudit.log.mockResolvedValue(undefined);

      await propertyService.updateAskingPrice('prop-1', 'seller-1', 520000);

      expect(mockedRepo.appendPriceHistory).toHaveBeenCalledWith('prop-1', 520000, 'seller-1');
      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'property.price_changed',
          entityType: 'property',
          entityId: 'prop-1',
          details: expect.objectContaining({
            oldPrice: 500000,
            newPrice: 520000,
          }),
        }),
      );
    });

    it('reverts live listing to pending_review when price changes', async () => {
      const liveListing = { id: 'listing-1', propertyId: 'prop-1', status: 'live' };
      const fakeProperty = {
        id: 'prop-1',
        sellerId: 'seller-1',
        askingPrice: 500000,
        listings: [liveListing],
      };
      const updatedProperty = { ...fakeProperty, askingPrice: 520000, listings: [liveListing] };

      mockedRepo.findByIdWithListings.mockResolvedValue(
        fakeProperty as unknown as PropertyWithListing,
      );
      mockedRepo.appendPriceHistory.mockResolvedValue(
        updatedProperty as unknown as PropertyWithListing,
      );
      mockedRepo.updateListingStatus.mockResolvedValue({
        ...liveListing,
        status: 'pending_review',
      } as unknown as Listing);
      mockedAudit.log.mockResolvedValue(undefined);

      await propertyService.updateAskingPrice('prop-1', 'seller-1', 520000);

      expect(mockedRepo.updateListingStatus).toHaveBeenCalledWith('listing-1', 'pending_review');
    });

    it('does NOT revert draft listing when price changes', async () => {
      const draftListing = { id: 'listing-1', propertyId: 'prop-1', status: 'draft' };
      const fakeProperty = {
        id: 'prop-1',
        sellerId: 'seller-1',
        askingPrice: 500000,
        listings: [draftListing],
      };
      const updatedProperty = { ...fakeProperty, askingPrice: 520000, listings: [draftListing] };

      mockedRepo.findByIdWithListings.mockResolvedValue(
        fakeProperty as unknown as PropertyWithListing,
      );
      mockedRepo.appendPriceHistory.mockResolvedValue(
        updatedProperty as unknown as PropertyWithListing,
      );
      mockedAudit.log.mockResolvedValue(undefined);

      await propertyService.updateAskingPrice('prop-1', 'seller-1', 520000);

      expect(mockedRepo.updateListingStatus).not.toHaveBeenCalled();
    });

    it('throws NotFoundError for missing property', async () => {
      mockedRepo.findByIdWithListings.mockResolvedValue(null);

      await expect(propertyService.updateAskingPrice('bad-id', 'seller-1', 520000)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('throws ForbiddenError when sellerId does not match', async () => {
      const fakeProperty = {
        id: 'prop-1',
        sellerId: 'seller-1',
        askingPrice: 500000,
        listings: [],
      };
      mockedRepo.findByIdWithListings.mockResolvedValue(
        fakeProperty as unknown as PropertyWithListing,
      );

      await expect(
        propertyService.updateAskingPrice('prop-1', 'seller-OTHER', 520000),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ─── updateListingStatus ──────────────────────────────────

  describe('updateListingStatus', () => {
    it('allows valid transition draft -> pending_review', async () => {
      const fakeListing = { id: 'listing-1', propertyId: 'prop-1', status: 'draft' };
      const updatedListing = { ...fakeListing, status: 'pending_review' };

      mockedRepo.findActiveListingForProperty.mockResolvedValue(fakeListing as unknown as Listing);
      mockedRepo.updateListingStatus.mockResolvedValue(updatedListing as unknown as Listing);
      mockedAudit.log.mockResolvedValue(undefined);

      const result = await propertyService.updateListingStatus('prop-1', 'pending_review');

      expect(mockedRepo.updateListingStatus).toHaveBeenCalledWith('listing-1', 'pending_review');
      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'listing.status_changed',
          entityType: 'listing',
          entityId: 'listing-1',
          details: { from: 'draft', to: 'pending_review' },
        }),
      );
      expect(result).toEqual(updatedListing);
    });

    it('rejects invalid transition draft -> live', async () => {
      const fakeListing = { id: 'listing-1', propertyId: 'prop-1', status: 'draft' };
      mockedRepo.findActiveListingForProperty.mockResolvedValue(fakeListing as unknown as Listing);

      await expect(propertyService.updateListingStatus('prop-1', 'live')).rejects.toThrow(
        ValidationError,
      );
    });

    it('throws NotFoundError when no active listing exists', async () => {
      mockedRepo.findActiveListingForProperty.mockResolvedValue(null);

      await expect(propertyService.updateListingStatus('prop-1', 'pending_review')).rejects.toThrow(
        NotFoundError,
      );
    });

    it('allows valid transition pending_review -> approved', async () => {
      const fakeListing = { id: 'listing-1', propertyId: 'prop-1', status: 'pending_review' };
      const updatedListing = { ...fakeListing, status: 'approved' };

      mockedRepo.findActiveListingForProperty.mockResolvedValue(fakeListing as unknown as Listing);
      mockedRepo.updateListingStatus.mockResolvedValue(updatedListing as unknown as Listing);
      mockedAudit.log.mockResolvedValue(undefined);

      const result = await propertyService.updateListingStatus('prop-1', 'approved');

      expect(result).toEqual(updatedListing);
    });

    it('rejects invalid transition closed -> live', async () => {
      const fakeListing = { id: 'listing-1', propertyId: 'prop-1', status: 'closed' };
      mockedRepo.findActiveListingForProperty.mockResolvedValue(fakeListing as unknown as Listing);

      await expect(propertyService.updateListingStatus('prop-1', 'live')).rejects.toThrow(
        ValidationError,
      );
    });

    it('calls checkComplianceGate when transitioning to live and updates on success', async () => {
      const fakeListing = { id: 'listing-1', propertyId: 'prop-1', status: 'approved' };
      const fakeProperty = { id: 'prop-1', sellerId: 'seller-1', listings: [fakeListing] };
      const updatedListing = { ...fakeListing, status: 'live' };

      mockedRepo.findActiveListingForProperty.mockResolvedValue(fakeListing as unknown as Listing);
      mockedRepo.findByIdWithListings.mockResolvedValue(
        fakeProperty as unknown as PropertyWithListing,
      );
      mockedRepo.updateListingStatus.mockResolvedValue(updatedListing as unknown as Listing);
      mockedReviewService.checkComplianceGate.mockResolvedValue(undefined);
      mockedAudit.log.mockResolvedValue(undefined);

      const result = await propertyService.updateListingStatus('prop-1', 'live');

      expect(mockedReviewService.checkComplianceGate).toHaveBeenCalledWith(
        'eaa_signed',
        'seller-1',
      );
      expect(mockedRepo.updateListingStatus).toHaveBeenCalledWith('listing-1', 'live');
      expect(result).toEqual(updatedListing);
    });

    it('rejects update when checkComplianceGate fails with ComplianceError', async () => {
      const fakeListing = { id: 'listing-1', propertyId: 'prop-1', status: 'approved' };
      const fakeProperty = { id: 'prop-1', sellerId: 'seller-1', listings: [fakeListing] };
      const complianceError = new ComplianceError('EAA must be signed before listing can go live');

      mockedRepo.findActiveListingForProperty.mockResolvedValue(fakeListing as unknown as Listing);
      mockedRepo.findByIdWithListings.mockResolvedValue(
        fakeProperty as unknown as PropertyWithListing,
      );
      mockedReviewService.checkComplianceGate.mockRejectedValue(complianceError);

      await expect(propertyService.updateListingStatus('prop-1', 'live')).rejects.toThrow(
        ComplianceError,
      );
      expect(mockedRepo.updateListingStatus).not.toHaveBeenCalled();
    });
  });
});
