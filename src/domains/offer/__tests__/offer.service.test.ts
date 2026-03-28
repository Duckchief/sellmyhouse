import * as offerService from '../offer.service';
import * as offerRepo from '../offer.repository';
import * as propertyService from '@/domains/property/property.service';
import * as hdbService from '@/domains/hdb/service';
import * as aiFacade from '@/domains/shared/ai/ai.facade';
import * as settingsService from '@/domains/shared/settings.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as auditService from '@/domains/shared/audit.service';
import { ValidationError, NotFoundError, ForbiddenError } from '@/domains/shared/errors';

// Mock all dependencies
jest.mock('../offer.repository');
jest.mock('@/domains/property/property.service');
jest.mock('@/domains/hdb/service');
jest.mock('@/domains/shared/ai/ai.facade');
jest.mock('@/domains/shared/settings.service');
jest.mock('@/domains/notification/notification.service');
jest.mock('@/domains/shared/audit.service');

const mockOfferRepo = jest.mocked(offerRepo);
const mockPropertyService = jest.mocked(propertyService);
const mockHdbService = jest.mocked(hdbService);
const mockAiFacade = jest.mocked(aiFacade);
const mockSettings = jest.mocked(settingsService);
const mockNotification = jest.mocked(notificationService);
const mockAudit = jest.mocked(auditService);

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    propertyId: 'property-1',
    buyerName: 'Test Buyer',
    buyerPhone: '91234567',
    buyerAgentName: null,
    buyerAgentCeaReg: null,
    isCoBroke: false,
    offerAmount: '600000',
    counterAmount: null,
    status: 'pending' as const,
    notes: null,
    parentOfferId: null,
    aiAnalysis: null,
    aiAnalysisProvider: null,
    aiAnalysisModel: null,
    aiAnalysisStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeProperty(agentId = 'agent-1') {
  return { id: 'property-1', seller: { agentId } };
}

function makeListing() {
  return { id: 'listing-1', propertyId: 'property-1', status: 'live' };
}

describe('offer.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.getBoolean.mockResolvedValue(false); // AI disabled by default in tests
    mockSettings.get.mockResolvedValue('anthropic');
    mockSettings.getNumber.mockResolvedValue(30); // transaction_anonymisation_days default
    mockAudit.log.mockResolvedValue(undefined as never);
    mockNotification.send.mockResolvedValue(undefined as never);
    mockHdbService.getRecentByTownAndFlatType.mockResolvedValue([]);
    // Default: property assigned to agent-1
    mockPropertyService.findPropertyByIdWithSeller.mockResolvedValue(makeProperty() as never);
    // Default: active listing exists
    mockPropertyService.findActiveListingForProperty.mockResolvedValue(makeListing() as never);
  });

  describe('createOffer', () => {
    it('creates an offer and notifies the seller', async () => {
      const newOffer = makeOffer();
      mockOfferRepo.create.mockResolvedValue(newOffer as never);
      mockOfferRepo.findById.mockResolvedValue(newOffer as never);

      const result = await offerService.createOffer({
        propertyId: 'property-1',
        sellerId: 'seller-1',
        buyerName: 'Test Buyer',
        buyerPhone: '91234567',
        offerAmount: 600000,
        agentId: 'agent-1',
        town: 'TAMPINES',
        flatType: '4 ROOM',
      });

      expect(mockOfferRepo.create).toHaveBeenCalledTimes(1);
      expect(mockNotification.send).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('offer-1');
    });

    it('throws ValidationError when no active listing exists for property', async () => {
      mockPropertyService.findActiveListingForProperty.mockResolvedValue(null);

      await expect(
        offerService.createOffer({
          propertyId: 'property-1',
          sellerId: 'seller-1',
          buyerName: 'Test Buyer',
          buyerPhone: '91234567',
          offerAmount: 600000,
          agentId: 'agent-1',
          town: 'TAMPINES',
          flatType: '4 ROOM',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('does not generate AI analysis when offer_ai_analysis_enabled is false', async () => {
      mockSettings.getBoolean.mockResolvedValue(false);
      const newOffer = makeOffer();
      mockOfferRepo.create.mockResolvedValue(newOffer as never);
      mockOfferRepo.findById.mockResolvedValue(newOffer as never);

      await offerService.createOffer({
        propertyId: 'property-1',
        sellerId: 'seller-1',
        buyerName: 'Test Buyer',
        buyerPhone: '91234567',
        offerAmount: 600000,
        agentId: 'agent-1',
        town: 'TAMPINES',
        flatType: '4 ROOM',
      });

      expect(mockAiFacade.generateText).not.toHaveBeenCalled();
    });

    it('generates AI analysis when offer_ai_analysis_enabled is true', async () => {
      mockSettings.getBoolean.mockResolvedValue(true);
      const newOffer = makeOffer();
      mockOfferRepo.create.mockResolvedValue(newOffer as never);
      mockOfferRepo.findById.mockResolvedValue(newOffer as never);
      mockHdbService.getRecentByTownAndFlatType.mockResolvedValue([
        { resalePrice: 580000 } as never,
        { resalePrice: 620000 } as never,
      ]);
      mockAiFacade.generateText.mockResolvedValue({
        text: 'This offer is below market median.',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      });
      mockOfferRepo.updateAiAnalysis.mockResolvedValue(
        makeOffer({ aiAnalysisStatus: 'generated' }) as never,
      );

      await offerService.createOffer({
        propertyId: 'property-1',
        sellerId: 'seller-1',
        buyerName: 'Test Buyer',
        buyerPhone: '91234567',
        offerAmount: 600000,
        agentId: 'agent-1',
        town: 'TAMPINES',
        flatType: '4 ROOM',
      });

      expect(mockAiFacade.generateText).toHaveBeenCalledTimes(1);
      expect(mockOfferRepo.updateAiAnalysis).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ aiAnalysisStatus: 'generated' }),
      );
    });
  });

  describe('getOffersForProperty', () => {
    it('returns offers when agent is assigned to property', async () => {
      mockOfferRepo.findByPropertyId.mockResolvedValue([makeOffer()] as never);

      const result = await offerService.getOffersForProperty('property-1', 'agent-1', 'agent');

      expect(result).toHaveLength(1);
    });

    it('throws ForbiddenError when agent is not assigned to property', async () => {
      mockPropertyService.findPropertyByIdWithSeller.mockResolvedValue(
        makeProperty('other-agent') as never,
      );

      await expect(
        offerService.getOffersForProperty('property-1', 'agent-1', 'agent'),
      ).rejects.toThrow(ForbiddenError);
    });

    it('admin bypasses ownership check', async () => {
      mockPropertyService.findPropertyByIdWithSeller.mockResolvedValue(
        makeProperty('other-agent') as never,
      );
      mockOfferRepo.findByPropertyId.mockResolvedValue([makeOffer()] as never);

      const result = await offerService.getOffersForProperty('property-1', 'agent-1', 'admin');

      expect(result).toHaveLength(1);
      expect(mockPropertyService.findPropertyByIdWithSeller).not.toHaveBeenCalled();
    });
  });

  describe('counterOffer', () => {
    it('creates a child offer and sets parent status to countered atomically', async () => {
      const parent = makeOffer({ id: 'offer-1', status: 'pending' });
      const child = makeOffer({ id: 'offer-2', parentOfferId: 'offer-1', counterAmount: '650000' });
      mockOfferRepo.findById.mockResolvedValue(parent as never);
      mockOfferRepo.counterOfferAtomically.mockResolvedValue(child as never);

      await offerService.counterOffer({
        parentOfferId: 'offer-1',
        counterAmount: 650000,
        agentId: 'agent-1',
        role: 'agent',
      });

      expect(mockOfferRepo.counterOfferAtomically).toHaveBeenCalledWith(
        'offer-1',
        'pending',
        expect.objectContaining({ parentOfferId: 'offer-1', counterAmount: 650000 }),
        'countered',
      );
    });

    it('throws ValidationError when trying to counter a non-pending offer', async () => {
      const accepted = makeOffer({ status: 'accepted' });
      mockOfferRepo.findById.mockResolvedValue(accepted as never);

      await expect(
        offerService.counterOffer({
          parentOfferId: 'offer-1',
          counterAmount: 650000,
          agentId: 'agent-1',
          role: 'agent',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws NotFoundError for unknown offer id', async () => {
      mockOfferRepo.findById.mockResolvedValue(null);

      await expect(
        offerService.counterOffer({
          parentOfferId: 'bad-id',
          counterAmount: 650000,
          agentId: 'agent-1',
          role: 'agent',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('acceptOffer', () => {
    it('accepts offer and expires pending/countered siblings atomically', async () => {
      const offer = makeOffer({ status: 'pending' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockOfferRepo.acceptOfferAtomically.mockResolvedValue({
        ...offer,
        status: 'accepted',
      } as never);

      await offerService.acceptOffer({ offerId: 'offer-1', agentId: 'agent-1', role: 'agent' });

      expect(mockOfferRepo.acceptOfferAtomically).toHaveBeenCalledWith('offer-1', 'property-1');
    });

    it('throws ForbiddenError when agent is not assigned to property', async () => {
      const offer = makeOffer({ status: 'pending' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockPropertyService.findPropertyByIdWithSeller.mockResolvedValue(
        makeProperty('other-agent') as never,
      );

      await expect(
        offerService.acceptOffer({ offerId: 'offer-1', agentId: 'agent-1', role: 'agent' }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('admin bypasses ownership check on accept', async () => {
      const offer = makeOffer({ status: 'pending' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockPropertyService.findPropertyByIdWithSeller.mockResolvedValue(
        makeProperty('other-agent') as never,
      );
      mockOfferRepo.acceptOfferAtomically.mockResolvedValue({
        ...offer,
        status: 'accepted',
      } as never);

      await offerService.acceptOffer({ offerId: 'offer-1', agentId: 'admin-1', role: 'admin' });

      expect(mockOfferRepo.acceptOfferAtomically).toHaveBeenCalled();
      expect(mockPropertyService.findPropertyByIdWithSeller).not.toHaveBeenCalled();
    });

    it('throws ValidationError when trying to accept a non-pending offer', async () => {
      const rejected = makeOffer({ status: 'rejected' });
      mockOfferRepo.findById.mockResolvedValue(rejected as never);

      await expect(
        offerService.acceptOffer({ offerId: 'offer-1', agentId: 'agent-1', role: 'agent' }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('rejectOffer', () => {
    it('rejects a pending offer', async () => {
      const offer = makeOffer({ status: 'pending' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockOfferRepo.updateStatus.mockResolvedValue({ ...offer, status: 'rejected' } as never);

      await offerService.rejectOffer({ offerId: 'offer-1', agentId: 'agent-1', role: 'agent' });

      expect(mockOfferRepo.updateStatus).toHaveBeenCalledWith('offer-1', 'rejected');
    });
  });

  describe('reviewAiAnalysis', () => {
    it('sets aiAnalysisStatus to reviewed', async () => {
      const offer = makeOffer({ aiAnalysis: 'some analysis', aiAnalysisStatus: 'generated' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockOfferRepo.updateAiAnalysisStatus.mockResolvedValue({
        ...offer,
        aiAnalysisStatus: 'reviewed',
      } as never);

      await offerService.reviewAiAnalysis({ offerId: 'offer-1', agentId: 'agent-1', role: 'agent' });

      expect(mockOfferRepo.updateAiAnalysisStatus).toHaveBeenCalledWith('offer-1', 'reviewed');
    });

    it('throws ValidationError if no AI analysis to review', async () => {
      const offer = makeOffer({ aiAnalysis: null, aiAnalysisStatus: null });
      mockOfferRepo.findById.mockResolvedValue(offer as never);

      await expect(
        offerService.reviewAiAnalysis({ offerId: 'offer-1', agentId: 'agent-1', role: 'agent' }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError if analysis is already reviewed or shared', async () => {
      const offer = makeOffer({ aiAnalysis: 'some analysis', aiAnalysisStatus: 'reviewed' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);

      await expect(
        offerService.reviewAiAnalysis({ offerId: 'offer-1', agentId: 'agent-1', role: 'agent' }),
      ).rejects.toThrow(ValidationError);
    });
    it('throws ForbiddenError when agent is not assigned to property', async () => {
      const offer = makeOffer({ aiAnalysis: 'some analysis', aiAnalysisStatus: 'generated' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockPropertyService.findPropertyByIdWithSeller.mockResolvedValue(makeProperty('other-agent') as never);
      await expect(offerService.reviewAiAnalysis({ offerId: 'offer-1', agentId: 'agent-1', role: 'agent' })).rejects.toThrow(ForbiddenError);
    });

    it('admin bypasses ownership check on review', async () => {
      const offer = makeOffer({ aiAnalysis: 'some analysis', aiAnalysisStatus: 'generated' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockPropertyService.findPropertyByIdWithSeller.mockResolvedValue(makeProperty('other-agent') as never);
      mockOfferRepo.updateAiAnalysisStatus.mockResolvedValue({ ...offer, aiAnalysisStatus: 'reviewed' } as never);
      await offerService.reviewAiAnalysis({ offerId: 'offer-1', agentId: 'admin-1', role: 'admin' });
      expect(mockOfferRepo.updateAiAnalysisStatus).toHaveBeenCalledWith('offer-1', 'reviewed');
    });
  });

  describe('shareAiAnalysis', () => {
    it('shares analysis after it has been reviewed', async () => {
      const offer = makeOffer({ aiAnalysis: 'some analysis', aiAnalysisStatus: 'reviewed' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockOfferRepo.updateAiAnalysisStatus.mockResolvedValue({
        ...offer,
        aiAnalysisStatus: 'shared',
      } as never);

      await offerService.shareAiAnalysis({
        offerId: 'offer-1',
        agentId: 'agent-1',
        role: 'agent',
        sellerId: 'seller-1',
      });

      expect(mockOfferRepo.updateAiAnalysisStatus).toHaveBeenCalledWith('offer-1', 'shared');
      expect(mockNotification.send).toHaveBeenCalledWith(
        expect.objectContaining({ templateName: 'offer_analysis_shared' }),
        'agent-1',
      );
    });

    it('throws ValidationError if analysis is not yet reviewed', async () => {
      const offer = makeOffer({ aiAnalysis: 'some analysis', aiAnalysisStatus: 'generated' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);

      await expect(
        offerService.shareAiAnalysis({
          offerId: 'offer-1',
          agentId: 'agent-1',
          role: 'agent',
          sellerId: 'seller-1',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError if no analysis exists', async () => {
      const offer = makeOffer({ aiAnalysis: null });
      mockOfferRepo.findById.mockResolvedValue(offer as never);

      await expect(
        offerService.shareAiAnalysis({
          offerId: 'offer-1',
          agentId: 'agent-1',
          role: 'agent',
          sellerId: 'seller-1',
        }),
      ).rejects.toThrow(ValidationError);
    });
    it('throws ForbiddenError when agent is not assigned to property', async () => {
      const offer = makeOffer({ aiAnalysis: 'some analysis', aiAnalysisStatus: 'reviewed' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockPropertyService.findPropertyByIdWithSeller.mockResolvedValue(makeProperty('other-agent') as never);
      await expect(offerService.shareAiAnalysis({ offerId: 'offer-1', agentId: 'agent-1', role: 'agent', sellerId: 'seller-1' })).rejects.toThrow(ForbiddenError);
    });

    it('admin bypasses ownership check on share', async () => {
      const offer = makeOffer({ aiAnalysis: 'some analysis', aiAnalysisStatus: 'reviewed' });
      mockOfferRepo.findById.mockResolvedValue(offer as never);
      mockPropertyService.findPropertyByIdWithSeller.mockResolvedValue(makeProperty('other-agent') as never);
      mockOfferRepo.updateAiAnalysisStatus.mockResolvedValue({ ...offer, aiAnalysisStatus: 'shared' } as never);
      await offerService.shareAiAnalysis({ offerId: 'offer-1', agentId: 'admin-1', role: 'admin', sellerId: 'seller-1' });
      expect(mockOfferRepo.updateAiAnalysisStatus).toHaveBeenCalledWith('offer-1', 'shared');
    });
  });
});
