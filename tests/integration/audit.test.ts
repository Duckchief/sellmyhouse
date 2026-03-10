import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';

describe('AuditLog', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('creates an audit log entry', async () => {
    const log = await factory.auditLog({
      action: 'property.created',
      entityType: 'Property',
      entityId: 'test-prop-1',
      details: { town: 'Tampines', flatType: '4 ROOM' },
    });

    expect(log.id).toBeDefined();
    expect(log.action).toBe('property.created');
    expect(log.entityType).toBe('Property');
    expect(log.entityId).toBe('test-prop-1');
  });

  it('queries by entity type and id', async () => {
    await factory.auditLog({
      action: 'property.created',
      entityType: 'Property',
      entityId: 'prop-1',
    });
    await factory.auditLog({
      action: 'property.updated',
      entityType: 'Property',
      entityId: 'prop-1',
    });
    await factory.auditLog({
      action: 'property.created',
      entityType: 'Property',
      entityId: 'prop-2',
    });

    const logs = await testPrisma.auditLog.findMany({
      where: { entityType: 'Property', entityId: 'prop-1' },
    });

    expect(logs).toHaveLength(2);
  });
});
