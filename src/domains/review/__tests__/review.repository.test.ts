jest.mock('@/infra/database/prisma', () => {
  const mockPrismaObj = {
    listing: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockPrismaObj)),
  } as Record<string, unknown>;
  return { prisma: mockPrismaObj };
});

import { prisma } from '@/infra/database/prisma';
import { buildAddress, approveListingDescription } from '../review.repository';

const mockPrisma = jest.mocked(prisma);

describe('buildAddress', () => {
  it('combines block, street, and town', () => {
    expect(buildAddress('Bishan', 'Bishan Street 22', '123')).toBe('123 Bishan Street 22, Bishan');
  });

  it('trims extra whitespace', () => {
    expect(buildAddress('Tampines', 'Tampines Ave 4', '456')).toBe('456 Tampines Ave 4, Tampines');
  });
});

describe('approveListingDescription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets aiDescriptionStatus to approved and copies aiDescription to description', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue({
      aiDescription: 'AI generated text',
    } as never);
    mockPrisma.listing.update.mockResolvedValue({} as never);

    await approveListingDescription('listing-1', 'agent-1');

    expect(mockPrisma.listing.update).toHaveBeenCalledWith({
      where: { id: 'listing-1' },
      data: expect.objectContaining({
        aiDescriptionStatus: 'approved',
        description: 'AI generated text',
        descriptionApprovedAt: expect.any(Date),
        descriptionApprovedByAgentId: 'agent-1',
      }),
    });
  });

  it('sets descriptionApprovedAt on approval', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue({ aiDescription: 'text' } as never);
    mockPrisma.listing.update.mockResolvedValue({} as never);

    await approveListingDescription('listing-1', 'agent-1');

    const callData = mockPrisma.listing.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(callData.descriptionApprovedAt).toBeInstanceOf(Date);
  });

  it('does not overwrite description when aiDescription is null', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue({ aiDescription: null } as never);
    mockPrisma.listing.update.mockResolvedValue({} as never);

    await approveListingDescription('listing-1', 'agent-1');

    const callData = mockPrisma.listing.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(callData).not.toHaveProperty('description');
  });

  it('does not overwrite description when listing is not found', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(null as never);
    mockPrisma.listing.update.mockResolvedValue({} as never);

    await approveListingDescription('listing-1', 'agent-1');

    const callData = mockPrisma.listing.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(callData).not.toHaveProperty('description');
  });
});
