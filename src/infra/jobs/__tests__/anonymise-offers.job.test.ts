import { runAnonymiseOffersJob } from '../anonymise-offers.job';
import * as offerRepo from '@/domains/offer/offer.repository';
import * as auditService from '@/domains/shared/audit.service';

jest.mock('@/domains/offer/offer.repository');
jest.mock('@/domains/shared/audit.service');
jest.mock('../../logger', () => ({ logger: { info: jest.fn(), error: jest.fn() } }));

const mockOfferRepo = jest.mocked(offerRepo);
const mockAuditService = jest.mocked(auditService);

import { logger } from '../../logger';
const mockLogger = jest.mocked(logger);

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
    retentionExpiresAt: new Date(Date.now() - 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('runAnonymiseOffersJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('anonymises offers where retentionExpiresAt is in the past', async () => {
    const offer = makeOffer();
    mockOfferRepo.findOffersForAnonymisation.mockResolvedValueOnce([offer] as never);
    mockOfferRepo.anonymiseOfferPii.mockResolvedValueOnce(undefined);
    mockAuditService.log.mockResolvedValueOnce(undefined as never);

    await runAnonymiseOffersJob();

    expect(mockOfferRepo.anonymiseOfferPii).toHaveBeenCalledWith('offer-1');
    expect(mockAuditService.log).toHaveBeenCalledWith({
      action: 'compliance.offer_pii_anonymised',
      entityType: 'offer',
      entityId: 'offer-1',
      details: { retentionExpiresAt: offer.retentionExpiresAt },
    });
    expect(mockLogger.info).toHaveBeenCalledWith({ count: 1 }, 'Offer PII anonymisation complete');
  });

  it('does NOT call anonymiseOfferPii when findOffersForAnonymisation returns empty', async () => {
    mockOfferRepo.findOffersForAnonymisation.mockResolvedValueOnce([]);

    await runAnonymiseOffersJob();

    expect(mockOfferRepo.anonymiseOfferPii).not.toHaveBeenCalled();
    expect(mockAuditService.log).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith({ count: 0 }, 'Offer PII anonymisation complete');
  });

  it('logs error and continues when anonymiseOfferPii throws for one offer', async () => {
    const offer1 = makeOffer({ id: 'offer-1' });
    const offer2 = makeOffer({ id: 'offer-2' });
    const error = new Error('DB error');

    mockOfferRepo.findOffersForAnonymisation.mockResolvedValueOnce([offer1, offer2] as never);
    mockOfferRepo.anonymiseOfferPii
      .mockRejectedValueOnce(error) // offer-1 fails
      .mockResolvedValueOnce(undefined); // offer-2 succeeds
    mockAuditService.log.mockResolvedValueOnce(undefined as never);

    await runAnonymiseOffersJob();

    expect(mockOfferRepo.anonymiseOfferPii).toHaveBeenCalledTimes(2);
    expect(mockLogger.error).toHaveBeenCalledWith(
      { err: error, offerId: 'offer-1' },
      'Failed to anonymise offer PII',
    );
    // offer-2 should still be audited
    expect(mockAuditService.log).toHaveBeenCalledTimes(1);
    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'offer-2' }),
    );
    // count should reflect only successful anonymisations
    expect(mockLogger.info).toHaveBeenCalledWith({ count: 1 }, 'Offer PII anonymisation complete');
  });
});
