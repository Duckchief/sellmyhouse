import * as contentRepo from './content.repository';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    testimonial: {
      create: jest.fn(),
    },
  },
}));

const { prisma } = jest.requireMock('@/infra/database/prisma');

describe('content.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createManualTestimonial', () => {
    it('inserts a testimonial with isManual true, pending_review, and null FKs', async () => {
      const input = {
        id: 'test-id',
        clientName: 'Mary L.',
        clientTown: 'Bishan',
        rating: 5,
        content: 'Excellent service from start to finish.',
        source: 'Google',
        isManual: true as const,
        status: 'pending_review' as const,
        createdByAgentId: 'agent-1',
        sellerId: null,
        buyerId: null,
        transactionId: null,
      };

      prisma.testimonial.create.mockResolvedValue({
        ...input,
        createdAt: new Date(),
        displayOnWebsite: false,
      });

      await contentRepo.createManualTestimonial(input);

      expect(prisma.testimonial.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isManual: true,
          status: 'pending_review',
          sellerId: null,
          buyerId: null,
          transactionId: null,
          createdByAgentId: 'agent-1',
        }),
      });
    });
  });
});
