import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';
import type { FinancialReportData } from '../../src/domains/property/financial.types';

// Override DATABASE_URL so the app's Prisma client uses the test DB
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST || 'postgresql://smhn:smhn_test@localhost:5433/sellmyhomenow_test';

// We test the service layer directly since financial routes require auth sessions.
// Unit tests cover route-level behavior; integration tests verify DB operations.
import * as financialService from '../../src/domains/property/financial.service';

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('Financial Engine — Integration', () => {
  async function seedRequirements() {
    // Seed required system settings
    await factory.systemSetting({ key: 'commission_amount', value: '1499' });
    await factory.systemSetting({ key: 'gst_rate', value: '0.09' });
    await factory.systemSetting({ key: 'ai_provider', value: 'anthropic' });
    await factory.systemSetting({ key: 'ai_model', value: 'claude-sonnet-4-20250514' });
    await factory.systemSetting({ key: 'ai_max_tokens', value: '2000' });
    await factory.systemSetting({ key: 'ai_temperature', value: '0.3' });

    const agent = await factory.agent();
    const seller = await factory.seller({ agentId: agent.id, status: 'active' });
    const property = await factory.property({
      sellerId: seller.id,
      askingPrice: 500000,
      town: 'TAMPINES',
      flatType: '4 ROOM',
      leaseCommenceDate: 1995,
    });

    return { agent, seller, property };
  }

  describe('calculateAndCreateReport', () => {
    it('creates a financial report in the database', async () => {
      const { seller, property } = await seedRequirements();

      const report = await financialService.calculateAndCreateReport({
        sellerId: seller.id,
        propertyId: property.id,
        calculationInput: {
          salePrice: 500000,
          outstandingLoan: 200000,
          ownerCpfs: [{ cpfRefund: 100000 }],
          flatType: '4 ROOM',
          subsidyType: 'subsidised',
          isFirstTimer: false,
          legalFeesEstimate: 2500,
        },
        metadata: { flatType: '4 ROOM', town: 'TAMPINES', leaseCommenceDate: 1995, cpfDisclaimerShownAt: new Date().toISOString() },
      });

      expect(report.id).toBeDefined();
      expect(report.version).toBe(1);

      // Verify it's in the database
      const fromDb = await testPrisma.financialReport.findUnique({
        where: { id: report.id },
      });
      expect(fromDb).not.toBeNull();
      expect(fromDb!.sellerId).toBe(seller.id);
      expect(fromDb!.propertyId).toBe(property.id);

      const reportData = fromDb!.reportData as unknown as FinancialReportData;
      expect(reportData.outputs.commission).toBe(1633.91);
      expect(reportData.outputs.netCashProceeds).toBeDefined();
    });

    it('increments version on recalculation', async () => {
      const { seller, property } = await seedRequirements();

      const input = {
        sellerId: seller.id,
        propertyId: property.id,
        calculationInput: {
          salePrice: 500000,
          outstandingLoan: 200000,
          ownerCpfs: [{ cpfRefund: 100000 }],
          flatType: '4 ROOM' as const,
          subsidyType: 'subsidised' as const,
          isFirstTimer: false,
          legalFeesEstimate: 2500,
        },
        metadata: { flatType: '4 ROOM', town: 'TAMPINES', leaseCommenceDate: 1995, cpfDisclaimerShownAt: new Date().toISOString() },
      };

      const report1 = await financialService.calculateAndCreateReport(input);
      const report2 = await financialService.calculateAndCreateReport(input);

      expect(report1.version).toBe(1);
      expect(report2.version).toBe(2);
    });
  });

  describe('Report lifecycle state machine', () => {
    it('cannot approve a report without narrative', async () => {
      const { seller, property, agent } = await seedRequirements();

      const report = await factory.financialReport({
        sellerId: seller.id,
        propertyId: property.id,
        // No aiNarrative set
      });

      await expect(
        financialService.approveReport({
          reportId: report.id,
          agentId: agent.id,
        }),
      ).rejects.toThrow('cannot be approved');
    });

    it('cannot send an unapproved report', async () => {
      const { seller, property, agent } = await seedRequirements();

      const report = await factory.financialReport({
        sellerId: seller.id,
        propertyId: property.id,
        aiNarrative: 'Some narrative',
        // Not approved
      });

      await expect(
        financialService.sendReport({
          reportId: report.id,
          agentId: agent.id,
          channel: 'whatsapp',
        }),
      ).rejects.toThrow('must be approved');
    });

    it('cannot re-send an already sent report', async () => {
      const { seller, property, agent } = await seedRequirements();

      const report = await factory.financialReport({
        sellerId: seller.id,
        propertyId: property.id,
        aiNarrative: 'Some narrative',
        approvedAt: new Date(),
        sentToSellerAt: new Date(),
        sentVia: 'whatsapp',
      });

      await expect(
        financialService.sendReport({
          reportId: report.id,
          agentId: agent.id,
          channel: 'email',
        }),
      ).rejects.toThrow('already been sent');
    });
  });

  describe('Audit logging', () => {
    it('creates audit log on report generation', async () => {
      const { seller, property } = await seedRequirements();

      const report = await financialService.calculateAndCreateReport({
        sellerId: seller.id,
        propertyId: property.id,
        calculationInput: {
          salePrice: 500000,
          outstandingLoan: 200000,
          ownerCpfs: [{ cpfRefund: 100000 }],
          flatType: '4 ROOM',
          subsidyType: 'subsidised',
          isFirstTimer: false,
        },
        metadata: { flatType: '4 ROOM', town: 'TAMPINES', leaseCommenceDate: 1995, cpfDisclaimerShownAt: new Date().toISOString() },
      });

      const logs = await testPrisma.auditLog.findMany({
        where: { action: 'financial.report_generated', entityId: report.id },
      });
      expect(logs.length).toBeGreaterThan(0);
    });

    it('creates audit log on report approval', async () => {
      const { seller, property, agent } = await seedRequirements();

      const report = await factory.financialReport({
        sellerId: seller.id,
        propertyId: property.id,
        aiNarrative: 'Narrative text',
      });

      await financialService.approveReport({
        reportId: report.id,
        agentId: agent.id,
        reviewNotes: 'Approved',
      });

      const logs = await testPrisma.auditLog.findMany({
        where: { action: 'financial.report_approved', entityId: report.id },
      });
      expect(logs.length).toBe(1);
    });
  });
});
