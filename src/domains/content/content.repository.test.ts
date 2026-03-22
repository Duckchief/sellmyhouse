import * as contentRepo from './content.repository';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    testimonial: {
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const { prisma } = jest.requireMock('@/infra/database/prisma');

describe('content.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('reissueTestimonialToken', () => {
    it('updates status, submissionToken, and tokenExpiresAt on the correct record', async () => {
      const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      prisma.testimonial.update.mockResolvedValue({
        id: 't-1',
        status: 'pending_submission',
        submissionToken: 'new-token',
        tokenExpiresAt: expiry,
      });

      await contentRepo.reissueTestimonialToken('t-1', 'new-token', expiry);

      expect(prisma.testimonial.update).toHaveBeenCalledWith({
        where: { id: 't-1' },
        data: {
          status: 'pending_submission',
          submissionToken: 'new-token',
          tokenExpiresAt: expiry,
        },
      });
    });
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
