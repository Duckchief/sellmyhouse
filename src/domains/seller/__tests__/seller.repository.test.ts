import * as sellerRepo from '../seller.repository';

jest.mock('../../../infra/database/prisma', () => ({
  prisma: {
    seller: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    consentRecord: {
      findMany: jest.fn(),
    },
    videoTutorial: {
      findMany: jest.fn(),
    },
  },
  createId: jest.fn().mockReturnValue('test-seller-id'),
}));

const { prisma } = jest.requireMock('../../../infra/database/prisma');

describe('seller.repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('findById', () => {
    it('returns seller when found', async () => {
      const mockSeller = {
        id: 'seller-1',
        name: 'Test Seller',
        email: 'test@test.local',
        phone: '91234567',
        onboardingStep: 0,
        status: 'lead',
      };
      prisma.seller.findUnique.mockResolvedValue(mockSeller);

      const result = await sellerRepo.findById('seller-1');

      expect(result).toEqual(mockSeller);
      expect(prisma.seller.findUnique).toHaveBeenCalledWith({
        where: { id: 'seller-1' },
      });
    });

    it('returns null when not found', async () => {
      prisma.seller.findUnique.mockResolvedValue(null);

      const result = await sellerRepo.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('updateOnboardingStep', () => {
    it('updates the onboarding step', async () => {
      const updated = { id: 'seller-1', onboardingStep: 2 };
      prisma.seller.update.mockResolvedValue(updated);

      const result = await sellerRepo.updateOnboardingStep('seller-1', 2);

      expect(result).toEqual(updated);
      expect(prisma.seller.update).toHaveBeenCalledWith({
        where: { id: 'seller-1' },
        data: { onboardingStep: 2 },
      });
    });
  });

  describe('getSellerWithRelations', () => {
    it('includes properties, transactions, consent records, and case flags', async () => {
      const mockSeller = {
        id: 'seller-1',
        name: 'Test',
        properties: [{ id: 'prop-1', status: 'draft' }],
        transactions: [],
        consentRecords: [],
        caseFlags: [],
      };
      prisma.seller.findUnique.mockResolvedValue(mockSeller);

      const result = await sellerRepo.getSellerWithRelations('seller-1');

      expect(result).toEqual(mockSeller);
      expect(prisma.seller.findUnique).toHaveBeenCalledWith({
        where: { id: 'seller-1' },
        include: {
          properties: true,
          transactions: true,
          consentRecords: { orderBy: { consentGivenAt: 'desc' } },
          caseFlags: { where: { status: { not: 'resolved' } } },
        },
      });
    });
  });

  describe('updateNotificationPreference', () => {
    it('calls prisma.seller.update with the preference', async () => {
      const updated = { id: 'seller-1', notificationPreference: 'email_only' };
      prisma.seller.update.mockResolvedValue(updated);

      await sellerRepo.updateNotificationPreference('seller-1', 'email_only');

      expect(prisma.seller.update).toHaveBeenCalledWith({
        where: { id: 'seller-1' },
        data: { notificationPreference: 'email_only' },
      });
    });
  });

  describe('getConsentHistory', () => {
    it('returns consent records for seller', async () => {
      const records = [{ id: 'cr-1', purposeService: true }];
      prisma.consentRecord.findMany.mockResolvedValue(records);

      const result = await sellerRepo.getConsentHistory('seller-1');

      expect(result).toEqual(records);
      expect(prisma.consentRecord.findMany).toHaveBeenCalledWith({
        where: { sellerId: 'seller-1' },
        orderBy: { consentGivenAt: 'desc' },
      });
    });
  });
});
