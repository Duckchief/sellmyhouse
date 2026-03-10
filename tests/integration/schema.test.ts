// tests/integration/schema.test.ts
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
