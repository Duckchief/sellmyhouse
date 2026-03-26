// tests/integration/compliance-sp1.test.ts

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
      // email must be unique — generate one per seller to avoid conflicts
      email: `seller-${id}@test.local`,
      phone: `+6591${Math.floor(Math.random() * 900000 + 100000)}`,
      consentService: true,
      consentMarketing: true,
      ...overrides,
    },
  });
}

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('Compliance SP1 — Consent + DNC (integration)', () => {
  describe('withdrawConsent — marketing', () => {
    it('creates a new ConsentRecord (does not modify existing)', async () => {
      const seller = await createTestSeller();

      // Create an existing consent record
      await testPrisma.consentRecord.create({
        data: {
          id: createId(),
          subjectType: 'seller',
          subjectId: seller.id,
          purposeService: true,
          purposeMarketing: true,
        },
      });

      const countBefore = await testPrisma.consentRecord.count({
        where: { subjectId: seller.id },
      });

      await complianceService.withdrawConsent({
        sellerId: seller.id,
        type: 'marketing',
        channel: 'web',
      });

      const countAfter = await testPrisma.consentRecord.count({
        where: { subjectId: seller.id },
      });
      expect(countAfter).toBe(countBefore + 1);

      // New record has purposeMarketing: false
      const latest = await testPrisma.consentRecord.findFirst({
        where: { subjectId: seller.id },
        orderBy: { consentGivenAt: 'desc' },
      });
      expect(latest?.purposeMarketing).toBe(false);
      expect(latest?.consentWithdrawnAt).not.toBeNull();
    });

    it('updates seller.consentMarketing to false', async () => {
      const seller = await createTestSeller();

      await complianceService.withdrawConsent({
        sellerId: seller.id,
        type: 'marketing',
        channel: 'web',
      });

      const updated = await testPrisma.seller.findUnique({ where: { id: seller.id } });
      expect(updated?.consentMarketing).toBe(false);
    });

    it('creates audit log entry', async () => {
      const seller = await createTestSeller();

      await complianceService.withdrawConsent({
        sellerId: seller.id,
        type: 'marketing',
        channel: 'web',
      });

      const log = await testPrisma.auditLog.findFirst({
        where: { entityType: 'seller', entityId: seller.id, action: 'consent.withdrawn' },
      });
      expect(log).not.toBeNull();
    });

    it('does NOT create a DataDeletionRequest for marketing withdrawal', async () => {
      const seller = await createTestSeller();

      await complianceService.withdrawConsent({
        sellerId: seller.id,
        type: 'marketing',
        channel: 'web',
      });

      const requests = await testPrisma.dataDeletionRequest.findMany({
        where: { targetId: seller.id },
      });
      expect(requests).toHaveLength(0);
    });
  });

  describe('withdrawConsent — service, no transaction', () => {
    it('creates a flagged DataDeletionRequest with 30_day_grace rule', async () => {
      const seller = await createTestSeller();

      const result = await complianceService.withdrawConsent({
        sellerId: seller.id,
        type: 'service',
        channel: 'web',
      });

      expect(result.deletionBlocked).toBe(false);
      expect(result.retentionRule).toBe('30_day_grace');

      const request = await testPrisma.dataDeletionRequest.findUnique({
        where: { id: result.deletionRequestId },
      });
      expect(request?.status).toBe('flagged');
      expect(request?.retentionRule).toBe('30_day_grace');
    });
  });

  describe('withdrawConsent — service, with completed transaction', () => {
    it('creates a flagged DataDeletionRequest with post_completion_purge rule', async () => {
      const seller = await createTestSeller();

      // flatType is a plain String field (not an enum) — use the HDB format string
      const property = await testPrisma.property.create({
        data: {
          id: createId(),
          sellerId: seller.id,
          town: 'TAMPINES',
          street: 'Tampines Street 1',
          block: '123',
          flatType: '4 ROOM',
          level: '10',
          unitNumber: '12',
          floorAreaSqm: 90,
          leaseCommenceDate: 2000,
          remainingLease: '74 years',
          askingPrice: 500000,
          status: 'completed',
        },
      });

      // TransactionStatus enum: option_issued | option_exercised | completing | completed | fallen_through
      await testPrisma.transaction.create({
        data: {
          id: createId(),
          propertyId: property.id,
          sellerId: seller.id,
          agreedPrice: 490000,
          optionFee: 1000,
          optionDate: new Date('2024-01-01'),
          exerciseDeadline: new Date('2024-01-22'),
          completionDate: new Date('2024-03-01'),
          status: 'completed',
        },
      });

      const result = await complianceService.withdrawConsent({
        sellerId: seller.id,
        type: 'service',
        channel: 'web',
      });

      expect(result.deletionBlocked).toBe(false);
      expect(result.retentionRule).toBe('post_completion_purge');

      const request = await testPrisma.dataDeletionRequest.findUnique({
        where: { id: result.deletionRequestId },
      });
      expect(request?.status).toBe('flagged');
    });
  });

  describe('checkDncAllowed', () => {
    it('blocks marketing message when seller.consentMarketing is false', async () => {
      const seller = await createTestSeller({ consentMarketing: false });
      const result = await complianceService.checkDncAllowed(seller.id, 'whatsapp', 'marketing');
      expect(result.allowed).toBe(false);
    });

    it('allows service message when only consentMarketing is false', async () => {
      const seller = await createTestSeller({ consentMarketing: false, consentService: true });
      const result = await complianceService.checkDncAllowed(seller.id, 'whatsapp', 'service');
      expect(result.allowed).toBe(true);
    });

    it('blocks all messages when consentService is false', async () => {
      const seller = await createTestSeller({ consentService: false, consentMarketing: false });
      const result = await complianceService.checkDncAllowed(seller.id, 'whatsapp', 'service');
      expect(result.allowed).toBe(false);
    });
  });
});
