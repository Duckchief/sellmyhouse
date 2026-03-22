import * as leadRepo from '../lead.repository';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    seller: {
      update: jest.fn(),
      create: jest.fn(),
    },
    consentRecord: {
      create: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
      fn({
        seller: { create: jest.fn().mockResolvedValue({ id: 'seller-1' }) },
        consentRecord: { create: jest.fn() },
      }),
    ),
  },
  createId: jest.fn().mockReturnValue('test-id'),
}));

const { prisma: mockPrisma } = jest.requireMock('@/infra/database/prisma');

describe('lead.repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('submitLeadAtomically', () => {
    it('passes email to seller.create', async () => {
      const input = {
        name: 'John Tan',
        email: 'grogu@example.com',
        countryCode: '+65',
        nationalNumber: '91234567',
        phone: '+6591234567',
        consentService: true,
        consentMarketing: false,
        leadSource: 'website',
      };

      await leadRepo.submitLeadAtomically(input);

      // The $transaction mock calls fn with a tx that has seller.create
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      const txFn = mockPrisma.$transaction.mock.calls[0][0];
      const mockTx = {
        seller: { create: jest.fn().mockResolvedValue({ id: 'seller-1' }) },
        consentRecord: { create: jest.fn() },
      };
      await txFn(mockTx);

      expect(mockTx.seller.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'grogu@example.com' }),
        }),
      );
    });
  });

  describe('assignAgent', () => {
    it('updates seller agentId', async () => {
      mockPrisma.seller.update.mockResolvedValue({ id: 'seller-1', agentId: 'agent-1' } as any);
      await leadRepo.assignAgent('seller-1', 'agent-1');
      expect(mockPrisma.seller.update).toHaveBeenCalledWith({
        where: { id: 'seller-1' },
        data: { agentId: 'agent-1' },
      });
    });
  });
});
