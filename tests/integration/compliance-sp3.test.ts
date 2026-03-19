// tests/integration/compliance-sp3.test.ts

// Override DATABASE_URL so the app's Prisma client uses the test DB
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST || 'postgresql://smhn:smhn_test@localhost:5433/sellmyhomenow_test';

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

describe('Compliance SP3 — Retention + Deletion + Anonymisation (integration)', () => {
  describe('scanRetention — leads', () => {
    it('flags stale lead (inactive 13 months)', async () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 13);
      const seller = await createTestSeller({ status: 'lead' });

      await testPrisma.seller.update({
        where: { id: seller.id },
        data: { updatedAt: oldDate },
      });

      const result = await complianceService.scanRetention();
      expect(result.flaggedCount).toBeGreaterThanOrEqual(1);

      const request = await testPrisma.dataDeletionRequest.findFirst({
        where: { targetId: seller.id, targetType: 'lead' },
      });
      expect(request?.status).toBe('flagged');
      expect(request?.retentionRule).toBe('lead_12_month');
    });

    it('does not flag lead active 6 months ago', async () => {
      const recentDate = new Date();
      recentDate.setMonth(recentDate.getMonth() - 6);
      const seller = await createTestSeller({ status: 'lead' });

      await testPrisma.seller.update({
        where: { id: seller.id },
        data: { updatedAt: recentDate },
      });

      await complianceService.scanRetention();

      const request = await testPrisma.dataDeletionRequest.findFirst({
        where: { targetId: seller.id },
      });
      expect(request).toBeNull();
    });
  });

  describe('executeHardDelete', () => {
    it('deletes seller record and its data after admin approval', async () => {
      const seller = await createTestSeller({ status: 'lead' });
      const agent = await createTestAgent();

      const deletionRequest = await testPrisma.dataDeletionRequest.create({
        data: {
          id: createId(),
          targetType: 'lead',
          targetId: seller.id,
          reason: 'Test deletion',
          retentionRule: 'lead_12_month',
          status: 'flagged',
          details: { sellerName: seller.name },
        },
      });

      await complianceService.executeHardDelete({
        requestId: deletionRequest.id,
        agentId: agent.id,
        reviewNotes: 'Confirmed no retention obligation',
      });

      const deleted = await testPrisma.seller.findUnique({ where: { id: seller.id } });
      expect(deleted).toBeNull();

      const auditLog = await testPrisma.auditLog.findFirst({
        where: { action: 'data.hard_deleted', entityId: seller.id },
      });
      expect(auditLog).not.toBeNull();

      const executed = await testPrisma.dataDeletionRequest.findUnique({
        where: { id: deletionRequest.id },
      });
      expect(executed?.status).toBe('executed');
    });

    it('throws ComplianceError for already-executed deletion request', async () => {
      const seller = await createTestSeller();
      const agent = await createTestAgent();

      const executedRequest = await testPrisma.dataDeletionRequest.create({
        data: {
          id: createId(),
          targetType: 'lead',
          targetId: seller.id,
          reason: 'Service consent withdrawn',
          retentionRule: 'post_completion_purge',
          status: 'executed',
          details: {},
        },
      });

      await expect(
        complianceService.executeHardDelete({
          requestId: executedRequest.id,
          agentId: agent.id,
        }),
      ).rejects.toThrow('not in a reviewable state');
    });
  });

  describe('anonymiseAgent', () => {
    it('replaces agent PII with anonymised values', async () => {
      const agent = await createTestAgent();
      const admin = await createTestAgent();

      // Deactivate agent first (required by service guard)
      await testPrisma.agent.update({ where: { id: agent.id }, data: { isActive: false } });

      await complianceService.anonymiseAgent({
        agentId: agent.id,
        requestedByAgentId: admin.id,
      });

      const anonymised = await testPrisma.agent.findUnique({ where: { id: agent.id } });
      expect(anonymised?.name).toBe(`Former Agent ${agent.id}`);
      expect(anonymised?.email).toBe(`anonymised-${agent.id}@deleted.local`);
      // phone is non-nullable in schema, so it's set to an anonymised string value
      expect(anonymised?.phone).toMatch(/anonymised/);

      // Agent record still exists (for audit log referential integrity)
      expect(anonymised).not.toBeNull();

      // Audit log created
      const log = await testPrisma.auditLog.findFirst({
        where: { action: 'agent.anonymised', entityId: agent.id },
      });
      expect(log).not.toBeNull();
    });

    it('throws ComplianceError if agent is still active', async () => {
      const agent = await createTestAgent();
      const admin = await createTestAgent();

      // Agent is active by default
      await expect(
        complianceService.anonymiseAgent({
          agentId: agent.id,
          requestedByAgentId: admin.id,
        }),
      ).rejects.toThrow('active');
    });
  });
});
