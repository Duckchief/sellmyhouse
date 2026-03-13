jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    listing: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { prisma } from '@/infra/database/prisma';
import { mapMcsToFrs, buildAddress, buildMarketContentLabel, approveListingDescription } from '../review.repository';

const mockPrisma = jest.mocked(prisma);

describe('mapMcsToFrs', () => {
  it('maps published to sent', () => {
    expect(mapMcsToFrs('published')).toBe('sent');
  });

  it('passes through ai_generated', () => {
    expect(mapMcsToFrs('ai_generated')).toBe('ai_generated');
  });

  it('passes through pending_review', () => {
    expect(mapMcsToFrs('pending_review')).toBe('pending_review');
  });

  it('passes through approved', () => {
    expect(mapMcsToFrs('approved')).toBe('approved');
  });

  it('passes through rejected', () => {
    expect(mapMcsToFrs('rejected')).toBe('rejected');
  });
});

describe('buildAddress', () => {
  it('combines block, street, and town', () => {
    expect(buildAddress('Bishan', 'Bishan Street 22', '123')).toBe('123 Bishan Street 22, Bishan');
  });

  it('trims extra whitespace', () => {
    expect(buildAddress('Tampines', 'Tampines Ave 4', '456')).toBe('456 Tampines Ave 4, Tampines');
  });
});

describe('buildMarketContentLabel', () => {
  it('returns "Weekly Market Summary (period)" when town is ALL', () => {
    expect(buildMarketContentLabel('ALL', 'ALL', '2026-W11')).toBe(
      'Weekly Market Summary (2026-W11)',
    );
  });

  it('returns town — flatType (period) for non-ALL records', () => {
    expect(buildMarketContentLabel('TAMPINES', '4 ROOM', '2026-W11')).toBe(
      'TAMPINES — 4 ROOM (2026-W11)',
    );
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
