// tests/integration/compliance-sp2.test.ts

// Override DATABASE_URL so the app's Prisma client uses the test DB
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST || 'postgresql://smh:smh_test@localhost:5433/smh_test';

import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { createId } from '@paralleldrive/cuid2';
import * as complianceService from '../../src/domains/compliance/compliance.service';

// Helpers
async function createTestSeller(overrides: Record<string, unknown> = {}) {
  const id = createId();
  return testPrisma.seller.create({
    data: {
      id,
      name: 'Test Seller',
      email: `seller-${id}@test.local`,
      phone: `+6591${Math.floor(Math.random() * 900000 + 100000)}`,
      consentService: true,
      consentMarketing: true,
      ...overrides,
    },
  });
}

async function createTestAgent() {
  const id = createId();
  return testPrisma.agent.create({
    data: {
      id,
      name: 'Test Agent',
      email: `agent-${id}@test.local`,
      phone: `+6598${Math.floor(Math.random() * 900000 + 100000)}`,
      ceaRegNo: `R${id.slice(0, 7)}`,
      passwordHash: 'hash',
      role: 'agent',
    },
  });
}

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('Compliance SP2 — My Data + Corrections (integration)', () => {
  describe('getMyData', () => {
    it('returns seller personal data', async () => {
      const seller = await createTestSeller({ name: 'Alice Tan' });
      const data = await complianceService.getMyData(seller.id);

      expect(data.seller.name).toBe('Alice Tan');
      expect(data.seller.consentService).toBe(true);
      expect(data.correctionRequests).toHaveLength(0);
      expect(data.consentHistory).toHaveLength(0);
    });

    it('throws NotFoundError for unknown seller', async () => {
      await expect(complianceService.getMyData('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('createCorrectionRequest', () => {
    it('creates a pending correction request', async () => {
      const seller = await createTestSeller();

      await complianceService.createCorrectionRequest({
        sellerId: seller.id,
        fieldName: 'name',
        currentValue: 'Old Name',
        requestedValue: 'New Name',
        reason: 'Legal name change',
      });

      const requests = await testPrisma.dataCorrectionRequest.findMany({
        where: { sellerId: seller.id },
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].status).toBe('pending');
      expect(requests[0].fieldName).toBe('name');
    });

    it('creates audit log for correction request', async () => {
      const seller = await createTestSeller();

      await complianceService.createCorrectionRequest({
        sellerId: seller.id,
        fieldName: 'email',
        requestedValue: 'new@test.com',
      });

      const log = await testPrisma.auditLog.findFirst({
        where: { action: 'data_correction.requested', entityType: 'data_correction_request' },
      });
      expect(log).not.toBeNull();
    });
  });

  describe('processCorrectionRequest — approve auto-apply', () => {
    it('updates seller name when agent approves name correction', async () => {
      const seller = await createTestSeller({ name: 'Old Name' });
      const agent = await createTestAgent();

      const request = await testPrisma.dataCorrectionRequest.create({
        data: {
          id: createId(),
          sellerId: seller.id,
          fieldName: 'name',
          requestedValue: 'New Name',
          status: 'pending',
        },
      });

      await complianceService.processCorrectionRequest({
        requestId: request.id,
        agentId: agent.id,
        decision: 'approve',
      });

      const updated = await testPrisma.seller.findUnique({ where: { id: seller.id } });
      expect(updated?.name).toBe('New Name');

      const updatedRequest = await testPrisma.dataCorrectionRequest.findUnique({
        where: { id: request.id },
      });
      expect(updatedRequest?.status).toBe('completed');
    });
  });

  describe('processCorrectionRequest — reject', () => {
    it('marks request rejected with process notes', async () => {
      const seller = await createTestSeller();
      const agent = await createTestAgent();

      const request = await testPrisma.dataCorrectionRequest.create({
        data: {
          id: createId(),
          sellerId: seller.id,
          fieldName: 'nricLast4',
          requestedValue: '123A',
          status: 'pending',
        },
      });

      await complianceService.processCorrectionRequest({
        requestId: request.id,
        agentId: agent.id,
        decision: 'reject',
        processNotes: 'Cannot verify identity claim',
      });

      const updatedRequest = await testPrisma.dataCorrectionRequest.findUnique({
        where: { id: request.id },
      });
      expect(updatedRequest?.status).toBe('rejected');
      expect(updatedRequest?.processNotes).toBe('Cannot verify identity claim');
    });
  });

  describe('generateDataExport', () => {
    it('returns a JSON export with seller fields', async () => {
      const seller = await createTestSeller({ name: 'Export Seller' });
      const exportData = await complianceService.generateDataExport(seller.id);

      expect(exportData.exportedAt).toBeDefined();
      expect((exportData.seller as { name: string }).name).toBe('Export Seller');
      expect(exportData.properties).toBeDefined();
      expect(exportData.consentHistory).toBeDefined();
    });
  });
});
