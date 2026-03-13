import * as offerRepo from '../offer.repository';
import type { OfferStatus } from '@prisma/client';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    offer: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn('mock-tx')),
  },
}));

import { prisma } from '@/infra/database/prisma';

const mockPrisma = jest.mocked(prisma);

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    propertyId: 'property-1',
    buyerName: 'Test Buyer',
    buyerPhone: '91234567',
    buyerAgentName: null,
    buyerAgentCeaReg: null,
    isCoBroke: false,
    offerAmount: '600000' as unknown as import('@prisma/client').Prisma.Decimal,
    counterAmount: null,
    status: 'pending' as OfferStatus,
    notes: null,
    parentOfferId: null,
    aiAnalysis: null,
    aiAnalysisProvider: null,
    aiAnalysisModel: null,
    aiAnalysisStatus: null,
    retentionExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('offer.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findOffersForAnonymisation', () => {
    it('returns offers where retentionExpiresAt is in the past and buyerName is not null', async () => {
      const pastDate = new Date(Date.now() - 1000);
      const expired = makeOffer({ retentionExpiresAt: pastDate });
      (mockPrisma.offer.findMany as jest.Mock).mockResolvedValueOnce([expired]);

      const result = await offerRepo.findOffersForAnonymisation();

      expect(mockPrisma.offer.findMany).toHaveBeenCalledWith({
        where: {
          retentionExpiresAt: { lt: expect.any(Date) },
          OR: [
            { buyerName: { not: null } },
            { buyerPhone: { not: null } },
          ],
        },
      });
      expect(result).toEqual([expired]);
    });

    it('does NOT return offers where retentionExpiresAt is in the future (findMany returns empty)', async () => {
      (mockPrisma.offer.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await offerRepo.findOffersForAnonymisation();

      expect(result).toEqual([]);
    });
  });

  describe('anonymiseOfferPii', () => {
    it('calls update with buyerName and buyerPhone set to null', async () => {
      (mockPrisma.offer.update as jest.Mock).mockResolvedValueOnce(
        makeOffer({ buyerName: null, buyerPhone: null }),
      );

      await offerRepo.anonymiseOfferPii('offer-1');

      expect(mockPrisma.offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { buyerName: null, buyerPhone: null },
      });
    });
  });
});
