import * as financialService from '../financial.service';
import * as financialRepo from '../financial.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as aiFacade from '@/domains/shared/ai/ai.facade';
import * as auditService from '@/domains/shared/audit.service';
import * as notificationService from '@/domains/notification/notification.service';
import type { FinancialCalculationInput } from '../financial.types';

jest.mock('../financial.repository');
jest.mock('@/domains/shared/settings.service');
jest.mock('@/domains/shared/ai/ai.facade');
jest.mock('@/domains/shared/audit.service');
jest.mock('@/domains/notification/notification.service');
jest.mock('@paralleldrive/cuid2', () => ({ createId: () => 'test-report-id' }));

const mockRepo = financialRepo as jest.Mocked<typeof financialRepo>;
const mockSettings = settingsService as jest.Mocked<typeof settingsService>;
const mockAI = aiFacade as jest.Mocked<typeof aiFacade>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;
const mockNotification = notificationService as jest.Mocked<typeof notificationService>;

const sampleInput: FinancialCalculationInput = {
  salePrice: 500000,
  outstandingLoan: 200000,
  owner1Cpf: { oaUsed: 100000, purchaseYear: 2016 },
  flatType: '4 ROOM',
  subsidyType: 'subsidised',
  isFirstTimer: false,
  legalFeesEstimate: 2500,
};

describe('financial.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.getCommission.mockResolvedValue({
      amount: 1499,
      gstRate: 0.09,
      gstAmount: 134.91,
      total: 1633.91,
    });
  });

  describe('calculateAndCreateReport', () => {
    it('creates a report with version 1 for new property', async () => {
      mockRepo.findLatestForProperty.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue({ id: 'test-report-id', version: 1 } as any);

      const result = await financialService.calculateAndCreateReport({
        sellerId: 'seller-1',
        propertyId: 'property-1',
        calculationInput: sampleInput,
        metadata: { flatType: '4 ROOM', town: 'TAMPINES', leaseCommenceDate: 1995 },
      });

      expect(mockSettings.getCommission).toHaveBeenCalled();
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-report-id',
          sellerId: 'seller-1',
          propertyId: 'property-1',
          version: 1,
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'financial.report_generated',
          entityType: 'financial_report',
          entityId: 'test-report-id',
        }),
      );
    });

    it('increments version for existing reports', async () => {
      mockRepo.findLatestForProperty.mockResolvedValue({ version: 3 } as any);
      mockRepo.create.mockResolvedValue({ id: 'test-report-id', version: 4 } as any);

      await financialService.calculateAndCreateReport({
        sellerId: 'seller-1',
        propertyId: 'property-1',
        calculationInput: sampleInput,
        metadata: { flatType: '4 ROOM', town: 'TAMPINES', leaseCommenceDate: 1995 },
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ version: 4 }),
      );
    });

    it('uses commission from SystemSetting, never hardcoded', async () => {
      mockRepo.findLatestForProperty.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue({ id: 'test-report-id', version: 1 } as any);

      await financialService.calculateAndCreateReport({
        sellerId: 'seller-1',
        propertyId: 'property-1',
        calculationInput: sampleInput,
        metadata: { flatType: '4 ROOM', town: 'TAMPINES', leaseCommenceDate: 1995 },
      });

      expect(mockSettings.getCommission).toHaveBeenCalled();
      const createCall = mockRepo.create.mock.calls[0][0];
      const reportData = createCall.reportData as any;
      expect(reportData.outputs.commission).toBe(1633.91);
    });
  });

  describe('generateNarrative', () => {
    it('calls AI facade and stores result', async () => {
      const report = {
        id: 'report-1',
        reportData: {
          outputs: {
            salePrice: 500000,
            outstandingLoan: 200000,
            owner1Cpf: { oaUsed: 100000, accruedInterest: 28008, totalRefund: 128008, isEstimated: false },
            totalCpfRefund: 128008,
            resaleLevy: 40000,
            commission: 1633.91,
            legalFees: 2500,
            totalDeductions: 372141.91,
            netCashProceeds: 127858.09,
            warnings: [],
          },
          metadata: { town: 'TAMPINES', flatType: '4 ROOM' },
        },
      } as any;
      mockRepo.findById.mockResolvedValue(report);
      mockAI.generateText.mockResolvedValue({
        text: 'Your estimated net proceeds are...',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      });
      mockRepo.updateNarrative.mockResolvedValue({} as any);

      await financialService.generateNarrative('report-1');

      expect(mockAI.generateText).toHaveBeenCalledWith(expect.stringContaining('Singapore'));
      expect(mockRepo.updateNarrative).toHaveBeenCalledWith('report-1', {
        aiNarrative: 'Your estimated net proceeds are...',
        aiProvider: 'anthropic',
        aiModel: 'claude-sonnet-4-20250514',
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'financial.narrative_generated',
          entityType: 'financial_report',
        }),
      );
    });

    it('throws NotFoundError for missing report', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(financialService.generateNarrative('nonexistent')).rejects.toThrow(
        'FinancialReport not found',
      );
    });
  });

  describe('approveReport', () => {
    it('approves a report with narrative', async () => {
      const report = {
        id: 'report-1',
        aiNarrative: 'Some narrative',
        approvedAt: null,
        sentToSellerAt: null,
      } as any;
      mockRepo.findById.mockResolvedValue(report);
      mockRepo.approve.mockResolvedValue({} as any);

      await financialService.approveReport({
        reportId: 'report-1',
        agentId: 'agent-1',
        reviewNotes: 'Looks good',
      });

      expect(mockRepo.approve).toHaveBeenCalledWith('report-1', 'agent-1', 'Looks good');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'financial.report_approved',
          entityType: 'financial_report',
        }),
      );
    });

    it('throws if report not found', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(
        financialService.approveReport({ reportId: 'x', agentId: 'a' }),
      ).rejects.toThrow('FinancialReport not found');
    });

    it('throws if report has no narrative yet', async () => {
      mockRepo.findById.mockResolvedValue({
        id: 'report-1',
        aiNarrative: null,
        approvedAt: null,
      } as any);
      await expect(
        financialService.approveReport({ reportId: 'report-1', agentId: 'agent-1' }),
      ).rejects.toThrow('cannot be approved');
    });

    it('throws if report already sent', async () => {
      mockRepo.findById.mockResolvedValue({
        id: 'report-1',
        aiNarrative: 'text',
        approvedAt: new Date(),
        sentToSellerAt: new Date(),
      } as any);
      await expect(
        financialService.approveReport({ reportId: 'report-1', agentId: 'agent-1' }),
      ).rejects.toThrow('already been sent');
    });
  });

  describe('sendReport', () => {
    it('sends approved report via notification service', async () => {
      const report = {
        id: 'report-1',
        sellerId: 'seller-1',
        version: 1,
        aiNarrative: 'narrative',
        approvedAt: new Date(),
        sentToSellerAt: null,
        reportData: { metadata: { flatType: '4 ROOM', town: 'TAMPINES' } },
      } as any;
      mockRepo.findById.mockResolvedValue(report);
      mockRepo.markSent.mockResolvedValue({} as any);
      mockNotification.send.mockResolvedValue(undefined);

      await financialService.sendReport({
        reportId: 'report-1',
        agentId: 'agent-1',
        channel: 'whatsapp',
      });

      expect(mockNotification.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'seller',
          recipientId: 'seller-1',
          templateName: 'financial_report_ready',
        }),
        'agent-1',
      );
      expect(mockRepo.markSent).toHaveBeenCalledWith('report-1', 'whatsapp');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'financial.report_sent',
        }),
      );
    });

    it('throws if report not approved', async () => {
      mockRepo.findById.mockResolvedValue({
        id: 'report-1',
        approvedAt: null,
        sentToSellerAt: null,
      } as any);
      await expect(
        financialService.sendReport({ reportId: 'report-1', agentId: 'a', channel: 'whatsapp' }),
      ).rejects.toThrow('must be approved');
    });

    it('throws if already sent', async () => {
      mockRepo.findById.mockResolvedValue({
        id: 'report-1',
        approvedAt: new Date(),
        sentToSellerAt: new Date(),
      } as any);
      await expect(
        financialService.sendReport({ reportId: 'report-1', agentId: 'a', channel: 'email' }),
      ).rejects.toThrow('already been sent');
    });
  });

  describe('getReport', () => {
    it('returns report by id', async () => {
      const report = { id: 'report-1' } as any;
      mockRepo.findById.mockResolvedValue(report);
      const result = await financialService.getReport('report-1');
      expect(result).toEqual(report);
    });

    it('throws NotFoundError when not found', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(financialService.getReport('x')).rejects.toThrow('not found');
    });
  });

  describe('getReportsForSeller', () => {
    it('returns all reports for seller', async () => {
      const reports = [{ id: 'r1' }, { id: 'r2' }] as any[];
      mockRepo.findAllForSeller.mockResolvedValue(reports);
      const result = await financialService.getReportsForSeller('seller-1');
      expect(result).toEqual(reports);
    });
  });
});
