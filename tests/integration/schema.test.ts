// tests/integration/schema.test.ts
import { createId } from '@paralleldrive/cuid2';
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';

describe('Phase 1A Schema', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('creates an agent', async () => {
    const agent = await factory.agent({ name: 'David Tan', ceaRegNo: 'R123456A' });
    expect(agent.id).toBeDefined();
    expect(agent.name).toBe('David Tan');
    expect(agent.ceaRegNo).toBe('R123456A');
    expect(agent.role).toBe('agent');
    expect(agent.isActive).toBe(true);
  });

  it('creates a seller with agent relation', async () => {
    const agent = await factory.agent();
    const seller = await factory.seller({ agentId: agent.id, name: 'Jane Lim' });

    expect(seller.agentId).toBe(agent.id);
    expect(seller.name).toBe('Jane Lim');
    expect(seller.status).toBe('lead');
    expect(seller.consentService).toBe(true);
    expect(seller.consentMarketing).toBe(false);
  });

  it('creates a property with seller relation', async () => {
    const agent = await factory.agent();
    const seller = await factory.seller({ agentId: agent.id });
    const property = await factory.property({
      sellerId: seller.id,
      town: 'BEDOK',
      askingPrice: 550000,
    });

    expect(property.sellerId).toBe(seller.id);
    expect(property.town).toBe('BEDOK');
    expect(property.askingPrice?.toString()).toBe('550000');
    expect(property.status).toBe('draft');
  });

  it('creates an HDB transaction with Decimal resalePrice', async () => {
    const txn = await factory.hdbTransaction({ resalePrice: 485000.5 });

    expect(txn.id).toBeDefined();
    expect(txn.resalePrice.toString()).toBe('485000.5');
    expect(txn.source).toBe('csv_seed');
  });

  it('creates a video tutorial', async () => {
    const tutorial = await factory.videoTutorial({
      title: 'How to Photograph Your Flat',
      category: 'photography',
    });
    expect(tutorial.id).toBeDefined();
    expect(tutorial.title).toBe('How to Photograph Your Flat');
    expect(tutorial.category).toBe('photography');
  });

  it('creates a testimonial with pending_submission status and nullable content/rating', async () => {
    const agent = await factory.agent();
    const seller = await factory.seller({ agentId: agent.id });
    const property = await factory.property({ sellerId: seller.id });
    const transaction = await factory.transaction({ sellerId: seller.id, propertyId: property.id });

    const token = createId();
    const testimonial = await testPrisma.testimonial.create({
      data: {
        id: createId(),
        seller: { connect: { id: seller.id } },
        transaction: { connect: { id: transaction.id } },
        clientName: 'John T.',
        clientTown: 'Tampines',
        status: 'pending_submission',
        submissionToken: token,
        tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        content: null,
        rating: null,
      },
    });

    expect(testimonial.status).toBe('pending_submission');
    expect(testimonial.submissionToken).toBe(token);
    expect(testimonial.tokenExpiresAt).toBeDefined();
    expect(testimonial.content).toBeNull();
    expect(testimonial.rating).toBeNull();
  });

  it('creates a referral with link_generated status', async () => {
    const agent = await factory.agent();
    const seller = await factory.seller({ agentId: agent.id });

    const referral = await testPrisma.referral.create({
      data: {
        id: createId(),
        referrerSellerId: seller.id,
        referralCode: `ref-${createId().slice(0, 8)}`,
        status: 'link_generated',
        clickCount: 0,
      },
    });

    expect(referral.status).toBe('link_generated');
    expect(referral.clickCount).toBe(0);
    expect(referral.referredSellerId).toBeNull();
  });

  it('creates a market content record with ALL sentinel values', async () => {
    const marketContent = await testPrisma.marketContent.create({
      data: {
        id: createId(),
        town: 'ALL',
        flatType: 'ALL',
        period: '2026-W11',
        rawData: { topTowns: [], millionDollar: { count: 0 }, trends: {} },
        status: 'ai_generated',
      },
    });

    expect(marketContent.town).toBe('ALL');
    expect(marketContent.flatType).toBe('ALL');
    expect(marketContent.period).toBe('2026-W11');
    expect(marketContent.status).toBe('ai_generated');
    expect(marketContent.aiNarrative).toBeNull();
  });

  it('queries HDB transactions by town and flat type', async () => {
    await factory.hdbTransaction({ town: 'TAMPINES', flatType: '4 ROOM' });
    await factory.hdbTransaction({ town: 'TAMPINES', flatType: '3 ROOM' });
    await factory.hdbTransaction({ town: 'BEDOK', flatType: '4 ROOM' });

    const tampines4Room = await testPrisma.hdbTransaction.findMany({
      where: { town: 'TAMPINES', flatType: '4 ROOM' },
    });

    expect(tampines4Room).toHaveLength(1);
  });
});
