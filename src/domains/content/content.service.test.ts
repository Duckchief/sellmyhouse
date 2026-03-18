// src/domains/content/content.service.test.ts
import * as contentService from './content.service';
import * as contentRepo from './content.repository';
import * as aiFacade from '@/domains/shared/ai/ai.facade';
import * as auditService from '@/domains/shared/audit.service';
import { NotFoundError, ConflictError, ValidationError } from '@/domains/shared/errors';
import type { VideoTutorial, MarketContent, Testimonial, Referral } from '@prisma/client';
import type {
  HdbTransactionPartial,
  TestimonialSubmitInput,
  CreateManualTestimonialInput,
} from './content.types';

jest.mock('./content.repository');
jest.mock('@/domains/shared/ai/ai.facade', () => {
  const actual = jest.requireActual('@/domains/shared/ai/ai.facade');
  return {
    ...actual,
    generateText: jest.fn(),
    getProvider: jest.fn(),
  };
});
jest.mock('@/domains/shared/audit.service');

const mockedRepo = jest.mocked(contentRepo);
const mockedAi = jest.mocked(aiFacade);
const mockedAudit = jest.mocked(auditService);

beforeEach(() => jest.clearAllMocks());

// ─── Video Tutorials ─────────────────────────────────────────────────────────

describe('generateSlug', () => {
  it('lowercases and hyphenates a title', () => {
    expect(contentService.generateSlug('How to Photograph Your Flat')).toBe(
      'how-to-photograph-your-flat',
    );
  });

  it('strips special characters', () => {
    expect(contentService.generateSlug('5-Room HDB: Tips & Tricks!')).toBe(
      '5-room-hdb-tips-tricks',
    );
  });

  it('collapses multiple spaces and hyphens', () => {
    expect(contentService.generateSlug('  Forms  101  ')).toBe('forms-101');
  });
});

describe('getTutorialsGrouped', () => {
  it('groups tutorials by category in orderIndex order', async () => {
    mockedRepo.findAllTutorials.mockResolvedValue([
      { id: '1', category: 'photography', orderIndex: 0, title: 'A' } as VideoTutorial,
      { id: '2', category: 'forms', orderIndex: 0, title: 'B' } as VideoTutorial,
      { id: '3', category: 'photography', orderIndex: 1, title: 'C' } as VideoTutorial,
    ]);

    const grouped = await contentService.getTutorialsGrouped();

    expect(Object.keys(grouped)).toEqual(['photography', 'forms']);
    expect(grouped.photography).toHaveLength(2);
    expect(grouped.photography[0].title).toBe('A');
    expect(grouped.photography[1].title).toBe('C');
    expect(grouped.forms).toHaveLength(1);
  });

  it('returns empty object when no tutorials exist', async () => {
    mockedRepo.findAllTutorials.mockResolvedValue([]);
    const grouped = await contentService.getTutorialsGrouped();
    expect(grouped).toEqual({});
  });
});

describe('createTutorial', () => {
  it('generates slug from title when none provided', async () => {
    mockedRepo.findTutorialBySlug.mockResolvedValue(null);
    mockedRepo.createTutorial.mockResolvedValue({ id: 'tut-1' } as VideoTutorial);

    await contentService.createTutorial({
      title: 'Process Overview',
      youtubeUrl: 'https://youtube.com/watch?v=abc',
      category: 'process',
    });

    expect(mockedRepo.createTutorial).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'process-overview' }),
    );
  });

  it('uses provided slug when given', async () => {
    mockedRepo.findTutorialBySlug.mockResolvedValue(null);
    mockedRepo.createTutorial.mockResolvedValue({ id: 'tut-1' } as VideoTutorial);

    await contentService.createTutorial({
      title: 'Process Overview',
      slug: 'custom-slug',
      youtubeUrl: 'https://youtube.com/watch?v=abc',
      category: 'process',
    });

    expect(mockedRepo.createTutorial).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'custom-slug' }),
    );
  });

  it('throws ConflictError when slug already exists', async () => {
    mockedRepo.findTutorialBySlug.mockResolvedValue({ id: 'existing' } as VideoTutorial);

    await expect(
      contentService.createTutorial({
        title: 'Process Overview',
        youtubeUrl: 'https://youtube.com/watch?v=abc',
        category: 'process',
      }),
    ).rejects.toThrow(ConflictError);
  });
});

describe('updateTutorial', () => {
  it('throws NotFoundError when tutorial does not exist', async () => {
    mockedRepo.findTutorialById.mockResolvedValue(null);

    await expect(contentService.updateTutorial('bad-id', { title: 'New Title' })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('throws ConflictError when new slug already taken by another tutorial', async () => {
    mockedRepo.findTutorialById.mockResolvedValue({
      id: 'tut-1',
      slug: 'old-slug',
    } as VideoTutorial);
    mockedRepo.findTutorialBySlug.mockResolvedValue({
      id: 'tut-2',
      slug: 'new-slug',
    } as VideoTutorial);

    await expect(contentService.updateTutorial('tut-1', { slug: 'new-slug' })).rejects.toThrow(
      ConflictError,
    );
  });

  it('allows keeping the same slug on the same tutorial', async () => {
    mockedRepo.findTutorialById.mockResolvedValue({
      id: 'tut-1',
      slug: 'same-slug',
    } as VideoTutorial);
    mockedRepo.findTutorialBySlug.mockResolvedValue({
      id: 'tut-1',
      slug: 'same-slug',
    } as VideoTutorial);
    mockedRepo.updateTutorial.mockResolvedValue({ id: 'tut-1' } as VideoTutorial);

    await expect(
      contentService.updateTutorial('tut-1', { slug: 'same-slug' }),
    ).resolves.not.toThrow();
  });
});

describe('deleteTutorial', () => {
  it('throws NotFoundError when tutorial does not exist', async () => {
    mockedRepo.findTutorialById.mockResolvedValue(null);

    await expect(contentService.deleteTutorial('bad-id')).rejects.toThrow(NotFoundError);
  });

  it('calls repo delete when tutorial exists', async () => {
    mockedRepo.findTutorialById.mockResolvedValue({ id: 'tut-1' } as VideoTutorial);
    mockedRepo.deleteTutorial.mockResolvedValue();

    await contentService.deleteTutorial('tut-1');

    expect(mockedRepo.deleteTutorial).toHaveBeenCalledWith('tut-1');
  });
});

describe('reorderTutorials', () => {
  it('calls repo with reorder items', async () => {
    mockedRepo.reorderTutorials.mockResolvedValue();

    await contentService.reorderTutorials([
      { id: 'tut-1', orderIndex: 0 },
      { id: 'tut-2', orderIndex: 1 },
    ]);

    expect(mockedRepo.reorderTutorials).toHaveBeenCalledWith([
      { id: 'tut-1', orderIndex: 0 },
      { id: 'tut-2', orderIndex: 1 },
    ]);
  });
});

// ─── Market Content ───────────────────────────────────────────────────────────

function makeTxn(overrides?: {
  month?: string;
  town?: string;
  flatType?: string;
  resalePrice?: number;
}): HdbTransactionPartial {
  return {
    month: overrides?.month ?? '2026-01',
    town: overrides?.town ?? 'TAMPINES',
    flatType: overrides?.flatType ?? '4 ROOM',
    resalePrice: { toNumber: () => overrides?.resalePrice ?? 500_000 },
  };
}

describe('aggregateHdbInsights', () => {
  it('returns null when fewer than 10 transactions', () => {
    const txns = Array.from({ length: 9 }, () => makeTxn());
    expect(contentService.aggregateHdbInsights(txns)).toBeNull();
  });

  it('returns top 5 towns sorted by median resale price descending', () => {
    // 6 towns each with 3 transactions at fixed prices
    const towns = ['TAMPINES', 'BISHAN', 'BUONA VISTA', 'CLEMENTI', 'KALLANG', 'SENGKANG'];
    const prices = [500_000, 700_000, 650_000, 600_000, 550_000, 450_000];
    const txns = towns.flatMap((town, i) =>
      Array.from({ length: 3 }, () => makeTxn({ town, resalePrice: prices[i] })),
    );

    const insights = contentService.aggregateHdbInsights(txns);

    expect(insights?.topTowns).toHaveLength(5);
    expect(insights?.topTowns[0].town).toBe('BISHAN'); // 700k
    expect(insights?.topTowns[1].town).toBe('BUONA VISTA'); // 650k
    expect(insights?.topTowns[4].town).toBe('TAMPINES'); // 500k
    // SENGKANG (450k) excluded
  });

  it('counts million-dollar flats correctly', () => {
    const txns = [
      ...Array.from({ length: 3 }, () => makeTxn({ resalePrice: 1_200_000 })),
      ...Array.from({ length: 3 }, () => makeTxn({ resalePrice: 1_500_000 })),
      ...Array.from({ length: 4 }, () => makeTxn({ resalePrice: 800_000 })),
    ];
    const insights = contentService.aggregateHdbInsights(txns);
    expect(insights?.millionDollar.count).toBe(6);
    expect(insights?.millionDollar.examples.length).toBeLessThanOrEqual(3);
  });

  it('marks flat type as rising when recent median increases by ≥ 5%', () => {
    // Older month: 500k, newer month: 600k (+20%)
    const txns = [
      ...Array.from({ length: 5 }, () =>
        makeTxn({ month: '2025-09', flatType: '4 ROOM', resalePrice: 500_000 }),
      ),
      ...Array.from({ length: 5 }, () =>
        makeTxn({ month: '2026-01', flatType: '4 ROOM', resalePrice: 600_000 }),
      ),
    ];
    const insights = contentService.aggregateHdbInsights(txns);
    const trend = insights?.trends.find((t) => t.flatType === '4 ROOM');
    expect(trend?.direction).toBe('rising');
    expect(trend?.changePercent).toBeGreaterThanOrEqual(5);
  });

  it('marks flat type as falling when recent median decreases by ≥ 5%', () => {
    // Older: 600k, newer: 500k (-17%)
    const txns = [
      ...Array.from({ length: 5 }, () =>
        makeTxn({ month: '2025-09', flatType: '5 ROOM', resalePrice: 600_000 }),
      ),
      ...Array.from({ length: 5 }, () =>
        makeTxn({ month: '2026-01', flatType: '5 ROOM', resalePrice: 500_000 }),
      ),
    ];
    const insights = contentService.aggregateHdbInsights(txns);
    const trend = insights?.trends.find((t) => t.flatType === '5 ROOM');
    expect(trend?.direction).toBe('falling');
    expect(trend?.changePercent).toBeLessThanOrEqual(-5);
  });

  it('marks flat type as stable when price change is under 5%', () => {
    // Older: 400k, newer: 402k (+0.5%)
    const txns = [
      ...Array.from({ length: 5 }, () =>
        makeTxn({ month: '2025-09', flatType: '3 ROOM', resalePrice: 400_000 }),
      ),
      ...Array.from({ length: 5 }, () =>
        makeTxn({ month: '2026-01', flatType: '3 ROOM', resalePrice: 402_000 }),
      ),
    ];
    const insights = contentService.aggregateHdbInsights(txns);
    const trend = insights?.trends.find((t) => t.flatType === '3 ROOM');
    expect(trend?.direction).toBe('stable');
  });
});

describe('trimToCharLimit', () => {
  it('trims text that exceeds the character limit', () => {
    const long = 'A'.repeat(200);
    const trimmed = contentService.trimToCharLimit(long, 150);
    expect(trimmed.length).toBeLessThanOrEqual(150);
  });

  it('returns text unchanged when within the limit', () => {
    const short = 'Short text here';
    expect(contentService.trimToCharLimit(short, 150)).toBe(short);
  });
});

describe('generateMarketContent', () => {
  it('throws ConflictError when a non-rejected record already exists for the period', async () => {
    mockedRepo.findMarketContentByPeriod.mockResolvedValue({
      id: 'mc-1',
      status: 'pending_review',
    } as MarketContent);

    await expect(contentService.generateMarketContent('2026-W11')).rejects.toThrow(ConflictError);
  });

  it('returns null and does not call AI when fewer than 10 transactions exist', async () => {
    mockedRepo.findMarketContentByPeriod.mockResolvedValue(null);
    const shortTxns = Array.from({ length: 5 }, () => makeTxn());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedRepo.findHdbTransactionsForMonths.mockResolvedValue(shortTxns as any);

    const result = await contentService.generateMarketContent('2026-W11');

    expect(result).toBeNull();
    expect(mockedAi.generateText).not.toHaveBeenCalled();
  });

  it('creates a pending_review record when AI generation succeeds', async () => {
    mockedRepo.findMarketContentByPeriod.mockResolvedValue(null);
    const longTxns = Array.from({ length: 12 }, (_, i) =>
      makeTxn({ town: i < 6 ? 'TAMPINES' : 'BISHAN', resalePrice: 500_000 }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedRepo.findHdbTransactionsForMonths.mockResolvedValue(longTxns as any);
    mockedAi.generateText.mockResolvedValue({
      text: JSON.stringify({
        narrative: 'Test narrative.',
        tiktok: 'HDB up! #HDB #SG #Property',
        instagram: 'Prices rose. Based on HDB resale data — sellmyhomenow.sg #HDB',
        linkedin: 'Professional summary. Based on HDB resale data — sellmyhomenow.sg',
      }),
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
    });
    mockedRepo.createMarketContent.mockResolvedValue({
      id: 'mc-new',
      status: 'pending_review',
    } as MarketContent);

    const result = await contentService.generateMarketContent('2026-W11');

    expect(result).not.toBeNull();
    expect(mockedRepo.createMarketContent).toHaveBeenCalledWith(
      expect.objectContaining({ period: '2026-W11', town: 'ALL', flatType: 'ALL' }),
    );
  });

  it('calls the AI facade with the period and aggregated HDB insights serialized in the prompt', async () => {
    mockedRepo.findMarketContentByPeriod.mockResolvedValue(null);
    // 10 transactions split across two months so the trend computation has both older/recent buckets.
    // 2025-09: 5 × TAMPINES 4-ROOM @500k  →  2026-01: 5 × BISHAN 4-ROOM @700k
    const txns = [
      ...Array.from({ length: 5 }, () =>
        makeTxn({ month: '2025-09', town: 'TAMPINES', flatType: '4 ROOM', resalePrice: 500_000 }),
      ),
      ...Array.from({ length: 5 }, () =>
        makeTxn({ month: '2026-01', town: 'BISHAN', flatType: '4 ROOM', resalePrice: 700_000 }),
      ),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedRepo.findHdbTransactionsForMonths.mockResolvedValue(txns as any);
    mockedAi.generateText.mockResolvedValue({
      text: '{"narrative":"","tiktok":"","instagram":"","linkedin":""}',
      provider: 'stub',
      model: 'stub',
    });
    mockedRepo.createMarketContent.mockResolvedValue({
      id: 'mc-1',
      status: 'pending_review',
    } as MarketContent);

    await contentService.generateMarketContent('2026-W11');

    expect(mockedAi.generateText).toHaveBeenCalledTimes(1);
    const prompt = mockedAi.generateText.mock.calls[0][0] as string;

    // Prompt must embed the period
    expect(prompt).toContain('2026-W11');
    // Prompt must contain both top towns (BISHAN has higher median → listed first)
    expect(prompt).toContain('"BISHAN"');
    expect(prompt).toContain('"TAMPINES"');
    // Prompt must reflect the rising 4-ROOM trend (40 % change: 500k → 700k)
    expect(prompt).toContain('"rising"');
    expect(prompt).toContain('40');
    // Prompt must note zero million-dollar transactions
    expect(prompt).toContain('"count": 0');
  });

  it('stores all AI response fields — narrative, social formats trimmed to char limits, provider, model and raw insights', async () => {
    mockedRepo.findMarketContentByPeriod.mockResolvedValue(null);
    const txns = [
      ...Array.from({ length: 5 }, () =>
        makeTxn({ month: '2025-09', town: 'TAMPINES', flatType: '4 ROOM', resalePrice: 500_000 }),
      ),
      ...Array.from({ length: 5 }, () =>
        makeTxn({ month: '2026-01', town: 'BISHAN', flatType: '4 ROOM', resalePrice: 700_000 }),
      ),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedRepo.findHdbTransactionsForMonths.mockResolvedValue(txns as any);

    const overlong = 'X'.repeat(800); // exceeds tiktok(150), instagram(300) and linkedin(700) limits
    mockedAi.generateText.mockResolvedValue({
      text: JSON.stringify({
        narrative: 'BISHAN leads with $700k median. 4-room flats rose 40%.',
        tiktok: overlong, // trimmed to 150
        instagram: overlong, // trimmed to 300
        linkedin: overlong, // trimmed to 700
      }),
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
    });
    mockedRepo.createMarketContent.mockResolvedValue({
      id: 'mc-1',
      status: 'pending_review',
    } as MarketContent);

    await contentService.generateMarketContent('2026-W11');

    expect(mockedRepo.createMarketContent).toHaveBeenCalledWith(
      expect.objectContaining({
        // AI text fields
        aiNarrative: 'BISHAN leads with $700k median. 4-room flats rose 40%.',
        tiktokFormat: 'X'.repeat(150),
        instagramFormat: 'X'.repeat(300),
        linkedinFormat: 'X'.repeat(700),
        aiProvider: 'anthropic',
        aiModel: 'claude-3-5-sonnet',
        // rawData must be the computed insights object, not raw transaction rows
        rawData: {
          topTowns: [
            { town: 'BISHAN', medianPrice: 700_000, transactionCount: 5 },
            { town: 'TAMPINES', medianPrice: 500_000, transactionCount: 5 },
          ],
          millionDollar: { count: 0, examples: [] },
          trends: [{ flatType: '4 ROOM', direction: 'rising', changePercent: 40 }],
        },
      }),
    );
  });
});

describe('approveMarketContent', () => {
  it('calls repo updateMarketContentStatus with approved + agentId', async () => {
    mockedRepo.updateMarketContentStatus.mockResolvedValue({
      id: 'mc-1',
      status: 'approved',
    } as MarketContent);

    await contentService.approveMarketContent('mc-1', 'agent-42');

    expect(mockedRepo.updateMarketContentStatus).toHaveBeenCalledWith(
      'mc-1',
      'approved',
      'agent-42',
    );
  });
});

describe('rejectMarketContent', () => {
  it('calls repo updateMarketContentStatus with rejected', async () => {
    mockedRepo.updateMarketContentStatus.mockResolvedValue({
      id: 'mc-1',
      status: 'rejected',
    } as MarketContent);

    await contentService.rejectMarketContent('mc-1');

    expect(mockedRepo.updateMarketContentStatus).toHaveBeenCalledWith(
      'mc-1',
      'rejected',
      undefined,
    );
  });
});

describe('listMarketContent', () => {
  it('calls repo with no filter when no status provided', async () => {
    mockedRepo.findAllMarketContent.mockResolvedValue([]);
    await contentService.listMarketContent();
    expect(mockedRepo.findAllMarketContent).toHaveBeenCalledWith(undefined);
  });

  it('calls repo with status filter when status provided', async () => {
    mockedRepo.findAllMarketContent.mockResolvedValue([]);
    await contentService.listMarketContent('pending_review');
    expect(mockedRepo.findAllMarketContent).toHaveBeenCalledWith('pending_review');
  });
});

// ─── Testimonials ─────────────────────────────────────────────────────────────

describe('formatDisplayName', () => {
  it('abbreviates the last name for a two-word name', () => {
    expect(contentService.formatDisplayName('John Thomas')).toBe('John T.');
  });

  it('abbreviates the last name for a multi-word name', () => {
    expect(contentService.formatDisplayName('Mary Jane Watson')).toBe('Mary W.');
  });

  it('returns single-word name unchanged', () => {
    expect(contentService.formatDisplayName('Priya')).toBe('Priya');
  });
});

describe('createManualTestimonial', () => {
  it('creates testimonial with isManual true and pending_review status', async () => {
    const input: CreateManualTestimonialInput = {
      clientName: 'Mary L.',
      clientTown: 'Bishan',
      rating: 5,
      content: 'Excellent service from start to finish.',
      source: 'Google',
    };
    const mockRecord = {
      id: 'test-id',
      clientName: 'Mary L.',
      clientTown: 'Bishan',
      rating: 5,
      content: 'Excellent service from start to finish.',
      source: 'Google',
      isManual: true,
      status: 'pending_review',
      createdByAgentId: 'agent-1',
      sellerId: null,
      buyerId: null,
      transactionId: null,
    };
    mockedRepo.createManualTestimonial.mockResolvedValue(mockRecord as any);

    const result = await contentService.createManualTestimonial('agent-1', input);

    expect(mockedRepo.createManualTestimonial).toHaveBeenCalledWith(
      expect.objectContaining({
        isManual: true,
        status: 'pending_review',
        createdByAgentId: 'agent-1',
        sellerId: null,
        buyerId: null,
        transactionId: null,
        clientName: 'Mary L.',
        clientTown: 'Bishan',
        rating: 5,
        content: 'Excellent service from start to finish.',
        source: 'Google',
      }),
    );
    expect(result.isManual).toBe(true);
    expect(result.status).toBe('pending_review');
  });
});

describe('submitTestimonial', () => {
  const validInput: TestimonialSubmitInput = {
    content: 'Great service!',
    rating: 5,
    clientName: 'John Thomas',
    clientTown: 'Tampines',
  };

  it('throws NotFoundError when token does not exist', async () => {
    mockedRepo.findTestimonialByToken.mockResolvedValue(null);

    await expect(contentService.submitTestimonial('bad-token', validInput)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('throws ValidationError when token is expired', async () => {
    mockedRepo.findTestimonialByToken.mockResolvedValue({
      id: 't-1',
      status: 'pending_submission',
      tokenExpiresAt: new Date(Date.now() - 1000),
    } as Testimonial);

    await expect(contentService.submitTestimonial('expired-token', validInput)).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when testimonial already submitted', async () => {
    mockedRepo.findTestimonialByToken.mockResolvedValue({
      id: 't-1',
      status: 'pending_review',
      tokenExpiresAt: new Date(Date.now() + 86_400_000),
    } as Testimonial);

    await expect(contentService.submitTestimonial('used-token', validInput)).rejects.toThrow(
      ValidationError,
    );
  });

  it('updates testimonial and returns pending_review record on success', async () => {
    mockedRepo.findTestimonialByToken.mockResolvedValue({
      id: 't-1',
      status: 'pending_submission',
      tokenExpiresAt: new Date(Date.now() + 86_400_000),
    } as Testimonial);
    mockedRepo.updateTestimonialSubmission.mockResolvedValue({
      id: 't-1',
      status: 'pending_review',
    } as Testimonial);

    const result = await contentService.submitTestimonial('valid-token', validInput);

    expect(mockedRepo.updateTestimonialSubmission).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({
        content: 'Great service!',
        rating: 5,
        status: 'pending_review',
      }),
    );
    expect(result).toMatchObject({ id: 't-1', status: 'pending_review' });
  });
});

describe('removeTestimonial', () => {
  it('hard-deletes testimonial and writes audit log with sellerId and reason', async () => {
    mockedRepo.findTestimonialBySeller.mockResolvedValue({
      id: 't-1',
      sellerId: 'seller-1',
    } as Testimonial);
    mockedRepo.hardDeleteTestimonial.mockResolvedValue();
    mockedAudit.log.mockResolvedValue();

    await contentService.removeTestimonial('seller-1');

    expect(mockedRepo.hardDeleteTestimonial).toHaveBeenCalledWith('t-1');
    expect(mockedAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'testimonial_removed',
        entityType: 'testimonial',
        entityId: 't-1',
        details: { sellerId: 'seller-1', reason: 'seller_requested' },
      }),
    );
  });

  it('is a no-op when no testimonial exists for the seller', async () => {
    mockedRepo.findTestimonialBySeller.mockResolvedValue(null);

    await contentService.removeTestimonial('seller-no-testimonial');

    expect(mockedRepo.hardDeleteTestimonial).not.toHaveBeenCalled();
    expect(mockedAudit.log).not.toHaveBeenCalled();
  });
});

// ─── Referrals ────────────────────────────────────────────────────────────────

describe('generateReferralCode', () => {
  it('returns an 8-character URL-safe string', () => {
    const code = contentService.generateReferralCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('generates unique codes on repeated calls', () => {
    const codes = new Set(Array.from({ length: 100 }, () => contentService.generateReferralCode()));
    expect(codes.size).toBeGreaterThan(95);
  });
});

describe('sendReferralLinks', () => {
  it('creates a new referral when none exists for the seller', async () => {
    mockedRepo.findReferralBySellerId.mockResolvedValue(null);
    mockedRepo.createReferral.mockResolvedValue({
      id: 'ref-1',
      referralCode: 'ABC12345',
    } as Referral);

    const result = await contentService.sendReferralLinks('seller-1');

    expect(mockedRepo.createReferral).toHaveBeenCalledWith(
      expect.objectContaining({ referrerSellerId: 'seller-1' }),
    );
    expect(result).toMatchObject({ referralCode: 'ABC12345' });
  });

  it('returns existing referral without creating a new one', async () => {
    mockedRepo.findReferralBySellerId.mockResolvedValue({
      id: 'ref-1',
      referralCode: 'EXISTING',
    } as Referral);

    const result = await contentService.sendReferralLinks('seller-1');

    expect(mockedRepo.createReferral).not.toHaveBeenCalled();
    expect(result).toMatchObject({ referralCode: 'EXISTING' });
  });
});

describe('trackReferralClick', () => {
  it('atomically increments click count', async () => {
    mockedRepo.incrementClickCount.mockResolvedValue({
      id: 'ref-1',
      clickCount: 1,
      status: 'link_generated',
    } as Referral);
    mockedRepo.updateReferralStatus.mockResolvedValue({
      id: 'ref-1',
      status: 'clicked',
    } as Referral);

    await contentService.trackReferralClick('CODE1234');

    expect(mockedRepo.incrementClickCount).toHaveBeenCalledWith('CODE1234');
  });

  it('transitions status link_generated → clicked on first click', async () => {
    mockedRepo.incrementClickCount.mockResolvedValue({
      id: 'ref-1',
      clickCount: 1,
      status: 'link_generated',
    } as Referral);
    mockedRepo.updateReferralStatus.mockResolvedValue({
      id: 'ref-1',
      status: 'clicked',
    } as Referral);

    await contentService.trackReferralClick('CODE1234');

    expect(mockedRepo.updateReferralStatus).toHaveBeenCalledWith('ref-1', 'clicked');
  });

  it('does not re-transition status on subsequent clicks', async () => {
    mockedRepo.incrementClickCount.mockResolvedValue({
      id: 'ref-1',
      clickCount: 5,
      status: 'clicked',
    } as Referral);

    await contentService.trackReferralClick('CODE1234');

    expect(mockedRepo.updateReferralStatus).not.toHaveBeenCalled();
  });

  it('is a no-op for unknown referral code', async () => {
    mockedRepo.incrementClickCount.mockResolvedValue(null);

    await contentService.trackReferralClick('UNKNOWN1');

    expect(mockedRepo.updateReferralStatus).not.toHaveBeenCalled();
  });
});

describe('linkReferralToLead', () => {
  it('links the referred seller when referral code matches', async () => {
    mockedRepo.findReferralByCode.mockResolvedValue({ id: 'ref-1', status: 'clicked' } as Referral);
    mockedRepo.linkReferredSeller.mockResolvedValue({
      id: 'ref-1',
      status: 'lead_created',
    } as Referral);

    await contentService.linkReferralToLead('CODE1234', 'new-seller-id');

    expect(mockedRepo.linkReferredSeller).toHaveBeenCalledWith('ref-1', 'new-seller-id');
  });

  it('is a no-op when referral code not found', async () => {
    mockedRepo.findReferralByCode.mockResolvedValue(null);

    await contentService.linkReferralToLead('UNKNOWN1', 'new-seller-id');

    expect(mockedRepo.linkReferredSeller).not.toHaveBeenCalled();
  });
});

describe('markReferralTransactionComplete', () => {
  it('updates referral status to transaction_completed for the referred seller', async () => {
    mockedRepo.findReferralByReferredSeller.mockResolvedValue({
      id: 'ref-1',
      status: 'lead_created',
    } as Referral);
    mockedRepo.updateReferralStatus.mockResolvedValue({
      id: 'ref-1',
      status: 'transaction_completed',
    } as Referral);

    await contentService.markReferralTransactionComplete('referred-seller-id');

    expect(mockedRepo.updateReferralStatus).toHaveBeenCalledWith('ref-1', 'transaction_completed');
  });

  it('is a no-op when no referral found for the referred seller', async () => {
    mockedRepo.findReferralByReferredSeller.mockResolvedValue(null);

    await contentService.markReferralTransactionComplete('seller-no-referral');

    expect(mockedRepo.updateReferralStatus).not.toHaveBeenCalled();
  });
});

// ─── Self-referral guard ──────────────────────────────────────────────────────

describe('linkReferralToLead — self-referral prevention', () => {
  it('does not link when referralCode belongs to the same seller (self-referral)', async () => {
    mockedRepo.findReferralByCode.mockResolvedValue({
      id: 'ref-1',
      referrerSellerId: 'seller-1',
      status: 'clicked',
    } as Referral);

    await contentService.linkReferralToLead('CODE1234', 'seller-1');

    expect(mockedRepo.linkReferredSeller).not.toHaveBeenCalled();
  });

  it('links normally when referrer and referee are different sellers', async () => {
    mockedRepo.findReferralByCode.mockResolvedValue({
      id: 'ref-1',
      referrerSellerId: 'seller-A',
      status: 'clicked',
    } as Referral);
    mockedRepo.linkReferredSeller.mockResolvedValue({
      id: 'ref-1',
      status: 'lead_created',
    } as Referral);

    await contentService.linkReferralToLead('CODE1234', 'seller-B');

    expect(mockedRepo.linkReferredSeller).toHaveBeenCalledWith('ref-1', 'seller-B');
  });
});

// ─── featureTestimonial — approved status guard ───────────────────────────────

describe('featureTestimonial — approved status guard', () => {
  it('throws ValidationError when testimonial is not approved', async () => {
    mockedRepo.findTestimonialById.mockResolvedValue({
      id: 't-1',
      status: 'pending_review',
    } as Testimonial);

    await expect(contentService.featureTestimonial('t-1', true)).rejects.toMatchObject({
      name: 'ValidationError',
    });

    expect(mockedRepo.setTestimonialDisplay).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when testimonial does not exist', async () => {
    mockedRepo.findTestimonialById.mockResolvedValue(null);

    await expect(contentService.featureTestimonial('bad-id', true)).rejects.toMatchObject({
      name: 'NotFoundError',
    });
  });

  it('sets displayOnWebsite when testimonial is approved', async () => {
    mockedRepo.findTestimonialById.mockResolvedValue({
      id: 't-1',
      status: 'approved',
    } as Testimonial);
    mockedRepo.setTestimonialDisplay.mockResolvedValue({ id: 't-1' } as Testimonial);

    await contentService.featureTestimonial('t-1', true);

    expect(mockedRepo.setTestimonialDisplay).toHaveBeenCalledWith('t-1', true);
  });
});

// ─── getTestimonialById ───────────────────────────────────────────────────────

describe('getTestimonialById', () => {
  it('returns the testimonial when found', async () => {
    const mock = { id: 't-1', clientName: 'Mary L.', status: 'approved' } as Testimonial;
    mockedRepo.findTestimonialById.mockResolvedValue(mock);

    const result = await contentService.getTestimonialById('t-1');

    expect(mockedRepo.findTestimonialById).toHaveBeenCalledWith('t-1');
    expect(result).toEqual(mock);
  });

  it('throws NotFoundError when not found', async () => {
    mockedRepo.findTestimonialById.mockResolvedValue(null);

    await expect(contentService.getTestimonialById('missing')).rejects.toThrow(NotFoundError);
  });
});

// ─── rejectTestimonial — notification to seller ───────────────────────────────

jest.mock('@/domains/notification/notification.service');
const mockedNotification = jest.mocked(
  jest.requireMock(
    '@/domains/notification/notification.service',
  ) as typeof import('@/domains/notification/notification.service'),
);

describe('rejectTestimonial — seller notification', () => {
  beforeEach(() => {
    mockedNotification.send = jest.fn().mockResolvedValue(undefined);
  });

  it('sends testimonial_rejected notification to seller after rejection', async () => {
    mockedRepo.updateTestimonialStatus.mockResolvedValue({
      id: 't-1',
      sellerId: 'seller-1',
      status: 'rejected',
    } as Testimonial);

    await contentService.rejectTestimonial('t-1', 'agent-1');

    // Fire-and-forget — wait for the microtask queue to flush
    await Promise.resolve();

    expect(mockedNotification.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientType: 'seller',
        recipientId: 'seller-1',
        templateName: 'testimonial_rejected',
      }),
      'agent-1',
    );
  });

  it('uses system as agentId when none provided', async () => {
    mockedRepo.updateTestimonialStatus.mockResolvedValue({
      id: 't-1',
      sellerId: 'seller-1',
      status: 'rejected',
    } as Testimonial);

    await contentService.rejectTestimonial('t-1');
    await Promise.resolve();

    expect(mockedNotification.send).toHaveBeenCalledWith(expect.anything(), 'system');
  });

  it('does not send notification when sellerId is null (manual testimonial)', async () => {
    mockedRepo.updateTestimonialStatus.mockResolvedValue({
      id: 't-2',
      sellerId: null,
      status: 'rejected',
    } as unknown as Testimonial);

    await contentService.rejectTestimonial('t-2', 'agent-1');
    await Promise.resolve();

    expect(mockedNotification.send).not.toHaveBeenCalled();
  });
});
