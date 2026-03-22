import * as agentService from '../agent.service';
import * as agentRepo from '../agent.repository';
import * as complianceService from '@/domains/compliance/compliance.service';
import * as transactionService from '@/domains/transaction/transaction.service';
import * as viewingService from '@/domains/viewing/viewing.service';
import { NotFoundError } from '@/domains/shared/errors';

jest.mock('../agent.repository');
jest.mock('../../viewing/viewing.service');
jest.mock('@/domains/compliance/compliance.service');
jest.mock('@/domains/transaction/transaction.service');

const mockRepo = agentRepo as jest.Mocked<typeof agentRepo>;
const mockComplianceService = complianceService as jest.Mocked<typeof complianceService>;
const mockTransactionService = transactionService as jest.Mocked<typeof transactionService>;
const mockViewingService = viewingService as jest.Mocked<typeof viewingService>;

describe('agent.service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getPipelineOverview', () => {
    it('returns pipeline stages, activity, and review count for an agent', async () => {
      mockRepo.getPipelineStagesWithSellers.mockResolvedValue([
        { status: 'lead', count: 3, totalValue: 0, sellers: [] },
        { status: 'active', count: 2, totalValue: 1000000, sellers: [] },
      ]);
      mockRepo.getRecentActivity.mockResolvedValue([]);
      mockRepo.getPendingReviewCount.mockResolvedValue(5);
      mockRepo.getUnassignedLeadCount.mockResolvedValue(0);

      const result = await agentService.getPipelineOverview('agent-1');

      expect(result.stages).toHaveLength(2);
      expect(result.stages[0]).toEqual({ status: 'lead', count: 3, totalValue: 0, sellers: [] });
      expect(result.pendingReviewCount).toBe(5);
      expect(mockRepo.getPipelineStagesWithSellers).toHaveBeenCalledWith('agent-1');
    });

    it('passes no agentId for admin (sees all)', async () => {
      mockRepo.getPipelineStagesWithSellers.mockResolvedValue([]);
      mockRepo.getRecentActivity.mockResolvedValue([]);
      mockRepo.getPendingReviewCount.mockResolvedValue(0);
      mockRepo.getUnassignedLeadCount.mockResolvedValue(0);

      await agentService.getPipelineOverview(undefined);

      expect(mockRepo.getPipelineStagesWithSellers).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getPipelineOverview - enhanced', () => {
    it('returns sellers array in each pipeline stage', async () => {
      const stageSellers = [
        {
          id: 'seller-1',
          name: 'Alice Tan',
          phone: '91111111',
          askingPrice: 500000,
          status: 'lead',
        },
        {
          id: 'seller-2',
          name: 'Bob Lim',
          phone: '92222222',
          askingPrice: 600000,
          status: 'active',
        },
      ];
      mockRepo.getPipelineStagesWithSellers.mockResolvedValue([
        { status: 'lead', count: 1, totalValue: 500000, sellers: [stageSellers[0]] },
        { status: 'active', count: 1, totalValue: 600000, sellers: [stageSellers[1]] },
      ]);
      mockRepo.getRecentActivity.mockResolvedValue([]);
      mockRepo.getPendingReviewCount.mockResolvedValue(0);
      mockRepo.getUnassignedLeadCount.mockResolvedValue(3);

      const result = await agentService.getPipelineOverview('agent-1');

      expect(result.stages).toHaveLength(2);
      expect(result.stages[0].sellers).toHaveLength(1);
      expect(result.stages[0].sellers[0].name).toBe('Alice Tan');
      expect(result.unassignedLeadCount).toBe(3);
      expect(mockRepo.getPipelineStagesWithSellers).toHaveBeenCalledWith('agent-1');
      expect(mockRepo.getUnassignedLeadCount).toHaveBeenCalled();
    });
  });

  describe('getLeadQueue', () => {
    it('partitions leads into unassigned, verified, and unverified arrays', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      mockRepo.getLeadQueue.mockResolvedValue([
        {
          id: 'seller-1',
          name: 'John Tan',
          phone: '91234567',
          email: 'john@test.com',
          emailVerified: false,
          leadSource: 'website',
          createdAt: twoHoursAgo,
          agentId: null,
        } as unknown as Awaited<ReturnType<typeof agentRepo.getLeadQueue>>[0],
        {
          id: 'seller-2',
          name: 'Mary Lim',
          phone: '98765432',
          email: 'mary@test.com',
          emailVerified: true,
          leadSource: 'tiktok',
          createdAt: oneHourAgo,
          agentId: 'agent-1',
        } as unknown as Awaited<ReturnType<typeof agentRepo.getLeadQueue>>[0],
        {
          id: 'seller-3',
          name: 'Bob Lee',
          phone: '91112222',
          email: 'bob@test.com',
          emailVerified: false,
          leadSource: 'website',
          createdAt: oneHourAgo,
          agentId: 'agent-1',
        } as unknown as Awaited<ReturnType<typeof agentRepo.getLeadQueue>>[0],
      ]);
      mockRepo.getWelcomeNotificationStatus.mockResolvedValue(
        new Map([
          ['seller-1', true],
          ['seller-2', false],
          ['seller-3', false],
        ]),
      );

      const result = await agentService.getLeadQueue('agent-1');

      expect(result.unassigned).toHaveLength(1);
      expect(result.unassigned[0].id).toBe('seller-1');
      expect(result.verified).toHaveLength(1);
      expect(result.verified[0].id).toBe('seller-2');
      expect(result.unverified).toHaveLength(1);
      expect(result.unverified[0].id).toBe('seller-3');
    });

    it('returns empty unassigned when all leads are assigned', async () => {
      const now = new Date();
      mockRepo.getLeadQueue.mockResolvedValue([
        {
          id: 'seller-1',
          name: 'John Tan',
          phone: '91234567',
          email: 'john@test.com',
          emailVerified: true,
          leadSource: null,
          createdAt: now,
          agentId: 'agent-1',
        } as unknown as Awaited<ReturnType<typeof agentRepo.getLeadQueue>>[0],
      ]);
      mockRepo.getWelcomeNotificationStatus.mockResolvedValue(new Map([['seller-1', false]]));

      const result = await agentService.getLeadQueue('agent-1');

      expect(result.unassigned).toHaveLength(0);
      expect(result.verified).toHaveLength(1);
      expect(result.unverified).toHaveLength(0);
    });

    it('returns all empty arrays when no leads exist', async () => {
      mockRepo.getLeadQueue.mockResolvedValue([]);
      mockRepo.getWelcomeNotificationStatus.mockResolvedValue(new Map());

      const result = await agentService.getLeadQueue();

      expect(result.unassigned).toHaveLength(0);
      expect(result.verified).toHaveLength(0);
      expect(result.unverified).toHaveLength(0);
    });
  });

  describe('getSellerList', () => {
    it('enforces agentId filter for non-admin agents', async () => {
      mockRepo.getSellerList.mockResolvedValue({
        sellers: [],
        total: 0,
        page: 1,
        limit: 25,
        totalPages: 0,
      });

      await agentService.getSellerList({ status: 'active' }, 'agent-1');

      expect(mockRepo.getSellerList).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1' }),
      );
    });

    it('passes filter without agentId for admin', async () => {
      mockRepo.getSellerList.mockResolvedValue({
        sellers: [],
        total: 0,
        page: 1,
        limit: 25,
        totalPages: 0,
      });

      await agentService.getSellerList({ status: 'active' }, undefined);

      expect(mockRepo.getSellerList).toHaveBeenCalledWith(
        expect.not.objectContaining({ agentId: expect.anything() }),
      );
    });
  });

  describe('getSellerDetail', () => {
    it('returns seller detail when seller belongs to agent', async () => {
      mockRepo.getSellerDetail.mockResolvedValue({
        id: 'seller-1',
        name: 'John Tan',
        status: 'active',
        properties: [],
      } as unknown as Awaited<ReturnType<typeof agentRepo.getSellerDetail>>);

      const result = await agentService.getSellerDetail('seller-1', 'agent-1');

      expect(result.id).toBe('seller-1');
      expect(mockRepo.getSellerDetail).toHaveBeenCalledWith('seller-1', 'agent-1');
    });

    it('throws NotFoundError when seller not found', async () => {
      mockRepo.getSellerDetail.mockResolvedValue(null);

      await expect(agentService.getSellerDetail('nonexistent', 'agent-1')).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('getComplianceStatus', () => {
    it('returns compliance status for a seller', async () => {
      mockRepo.getComplianceStatus.mockResolvedValue({
        cdd: {
          status: 'verified',
          verifiedAt: new Date(),
          riskLevel: 'standard',
          fullName: 'Test',
          nricLast4: '567A',
        },
        eaa: {
          id: null,
          status: 'not_started',
          signedAt: null,
          signedCopyPath: null,
          expiryDate: null,
          explanationConfirmedAt: null,
          explanationMethod: null,
        },
        consent: { service: true, marketing: false, withdrawnAt: null },
        caseFlags: [],
        counterpartyCdd: null,
      } as never);

      const result = await agentService.getComplianceStatus('seller-1');

      expect(result.cdd.status).toBe('verified');
      expect(result.eaa.status).toBe('not_started');
    });

    it('passes co-broke fields through when counterpartyCdd is present', async () => {
      mockRepo.getComplianceStatus.mockResolvedValue({
        cdd: {
          status: 'verified',
          verifiedAt: new Date(),
          riskLevel: 'standard',
          fullName: 'Test',
          nricLast4: '567A',
        },
        eaa: {
          status: 'not_started',
          id: null,
          signedAt: null,
          signedCopyPath: null,
          expiryDate: null,
          explanationConfirmedAt: null,
          explanationMethod: null,
        },
        consent: { service: true, marketing: false, withdrawnAt: null },
        caseFlags: [],
        counterpartyCdd: {
          status: 'not_started',
          verifiedAt: null,
          transactionId: 'tx-1',
          isCoBroke: true,
          buyerAgentName: 'John Agent',
          buyerAgentCeaReg: 'R012345B',
        },
      } as never);

      const result = await agentService.getComplianceStatus('seller-1');

      expect(result.counterpartyCdd?.isCoBroke).toBe(true);
      expect(result.counterpartyCdd?.buyerAgentName).toBe('John Agent');
      expect(result.counterpartyCdd?.buyerAgentCeaReg).toBe('R012345B');
    });
  });

  describe('getTimelineInput', () => {
    const baseSeller = {
      id: 'seller-1',
      name: 'Alice',
      email: 'alice@test.local',
      phone: '91234567',
      status: 'active',
      leadSource: null,
      agentId: 'agent-1',
      onboardingStep: 3,
      consentService: true,
      consentMarketing: false,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      properties: [],
    };

    it('returns correct shape when all data is present', async () => {
      const createdAt = new Date('2026-02-01');
      const sellerWithProperty = {
        ...baseSeller,
        properties: [
          {
            id: 'prop-1',
            status: 'active' as const,
            listings: [],
            town: 'TAMPINES',
            street: 'TAMPINES ST 21',
            block: '123',
            flatType: '4 ROOM',
            storeyRange: '04 TO 06',
            floorAreaSqm: 90,
            flatModel: 'Improved',
            leaseCommenceDate: 1998,
            askingPrice: null,
            priceHistory: [],
          },
        ],
      };

      mockRepo.getSellerDetail.mockResolvedValue(sellerWithProperty as never);
      mockRepo.getComplianceStatus.mockResolvedValue({
        cdd: {
          status: 'verified',
          verifiedAt: createdAt,
          riskLevel: 'standard',
          fullName: 'Alice',
          nricLast4: '567A',
        },
        eaa: {
          id: 'eaa-1',
          status: 'signed',
          signedAt: createdAt,
          signedCopyPath: '/docs/eaa.pdf',
          expiryDate: null,
          explanationConfirmedAt: null,
          explanationMethod: null,
        },
        consent: { service: true, marketing: false, withdrawnAt: null },
        caseFlags: [],
        counterpartyCdd: {
          transactionId: 'tx-1',
          status: 'verified',
          verifiedAt: createdAt,
          isCoBroke: false,
          buyerAgentName: null,
          buyerAgentCeaReg: null,
        },
      } as never);
      mockTransactionService.findTransactionBySellerId.mockResolvedValue({
        id: 'tx-1',
        status: 'active',
        hdbApplicationStatus: 'not_submitted',
        hdbAppSubmittedAt: null,
        hdbAppApprovedAt: null,
        hdbAppointmentDate: null,
        completionDate: null,
        createdAt,
      } as never);
      mockComplianceService.findLatestSellerCddRecord.mockResolvedValue({ createdAt } as never);
      mockComplianceService.findEaaBySellerId.mockResolvedValue({
        videoCallConfirmedAt: createdAt,
        signedCopyPath: '/docs/eaa.pdf',
      } as never);
      mockViewingService.findFirstViewingDateForProperty.mockResolvedValue(new Date('2026-02-10'));
      mockTransactionService.findOtpByTransactionId.mockResolvedValue({
        status: 'issued',
        agentReviewedAt: null,
        issuedAt: new Date('2026-02-15'),
        exercisedAt: null,
      } as never);
      mockComplianceService.findCddRecordByTransactionAndSubjectType.mockResolvedValue({
        createdAt,
      } as never);

      const result = await agentService.getTimelineInput('seller-1', 'agent-1');

      expect(result.sellerCddRecord).toEqual({ createdAt });
      expect(result.eaa).toEqual({
        videoCallConfirmedAt: createdAt,
        signedCopyPath: '/docs/eaa.pdf',
      });
      expect(result.property).toEqual({ status: 'active', listedAt: null });
      expect(result.firstViewingAt).toEqual(new Date('2026-02-10'));
      expect(result.acceptedOffer).toEqual({ createdAt });
      expect(result.counterpartyCddRecord).toEqual({ createdAt });
      expect(result.isCoBroke).toBe(false);
      expect(result.otp?.status).toBe('issued');
      expect(result.transaction?.status).toBe('active');
    });

    it('returns nulls for optional fields when no transaction, otp, or property', async () => {
      mockRepo.getSellerDetail.mockResolvedValue({ ...baseSeller, properties: [] } as never);
      mockRepo.getComplianceStatus.mockResolvedValue({
        cdd: {
          status: 'not_started',
          verifiedAt: null,
          riskLevel: null,
          fullName: null,
          nricLast4: null,
        },
        eaa: {
          id: null,
          status: 'not_started',
          signedAt: null,
          signedCopyPath: null,
          expiryDate: null,
          explanationConfirmedAt: null,
          explanationMethod: null,
        },
        consent: { service: false, marketing: false, withdrawnAt: null },
        caseFlags: [],
        counterpartyCdd: null,
      } as never);
      mockTransactionService.findTransactionBySellerId.mockResolvedValue(null);
      mockComplianceService.findLatestSellerCddRecord.mockResolvedValue(null);
      mockComplianceService.findEaaBySellerId.mockResolvedValue(null);

      const result = await agentService.getTimelineInput('seller-1', 'agent-1');

      expect(result.sellerCddRecord).toBeNull();
      expect(result.eaa).toBeNull();
      expect(result.property).toBeNull();
      expect(result.firstViewingAt).toBeNull();
      expect(result.acceptedOffer).toBeNull();
      expect(result.counterpartyCddRecord).toBeNull();
      expect(result.isCoBroke).toBe(false);
      expect(result.otp).toBeNull();
      expect(result.transaction).toBeNull();
      expect(mockTransactionService.findOtpByTransactionId).not.toHaveBeenCalled();
      expect(mockComplianceService.findCddRecordByTransactionAndSubjectType).not.toHaveBeenCalled();
    });

    it('skips counterparty CDD fetch when isCoBroke is true', async () => {
      const createdAt = new Date('2026-02-01');
      mockRepo.getSellerDetail.mockResolvedValue({ ...baseSeller, properties: [] } as never);
      mockRepo.getComplianceStatus.mockResolvedValue({
        cdd: {
          status: 'verified',
          verifiedAt: createdAt,
          riskLevel: 'standard',
          fullName: 'Alice',
          nricLast4: '567A',
        },
        eaa: {
          id: null,
          status: 'not_started',
          signedAt: null,
          signedCopyPath: null,
          expiryDate: null,
          explanationConfirmedAt: null,
          explanationMethod: null,
        },
        consent: { service: true, marketing: false, withdrawnAt: null },
        caseFlags: [],
        counterpartyCdd: {
          transactionId: 'tx-1',
          status: 'not_started',
          verifiedAt: null,
          isCoBroke: true,
          buyerAgentName: 'Bob',
          buyerAgentCeaReg: 'R012345B',
        },
      } as never);
      mockTransactionService.findTransactionBySellerId.mockResolvedValue(null);
      mockComplianceService.findLatestSellerCddRecord.mockResolvedValue(null);
      mockComplianceService.findEaaBySellerId.mockResolvedValue(null);

      const result = await agentService.getTimelineInput('seller-1', 'agent-1');

      expect(result.counterpartyCddRecord).toBeNull();
      expect(result.isCoBroke).toBe(true);
      expect(mockComplianceService.findCddRecordByTransactionAndSubjectType).not.toHaveBeenCalled();
    });

    it('returns isCoBroke false when counterpartyCdd is absent', async () => {
      mockRepo.getSellerDetail.mockResolvedValue({ ...baseSeller, properties: [] } as never);
      mockRepo.getComplianceStatus.mockResolvedValue({
        cdd: {
          status: 'not_started',
          verifiedAt: null,
          riskLevel: null,
          fullName: null,
          nricLast4: null,
        },
        eaa: {
          id: null,
          status: 'not_started',
          signedAt: null,
          signedCopyPath: null,
          expiryDate: null,
          explanationConfirmedAt: null,
          explanationMethod: null,
        },
        consent: { service: false, marketing: false, withdrawnAt: null },
        caseFlags: [],
        counterpartyCdd: null,
      } as never);
      mockTransactionService.findTransactionBySellerId.mockResolvedValue(null);
      mockComplianceService.findLatestSellerCddRecord.mockResolvedValue(null);
      mockComplianceService.findEaaBySellerId.mockResolvedValue(null);

      const result = await agentService.getTimelineInput('seller-1');

      expect(result.isCoBroke).toBe(false);
      expect(result.counterpartyCddRecord).toBeNull();
    });
  });

  describe('getSellerStatusCounts (repo boundary)', () => {
    it('returns zero-filled counts when no sellers exist', async () => {
      mockRepo.getSellerStatusCounts.mockResolvedValue({
        lead: 0, engaged: 0, active: 0, completed: 0, archived: 0,
      });

      const result = await agentService.getSellerStatusCounts('agent-1');

      expect(mockRepo.getSellerStatusCounts).toHaveBeenCalledWith('agent-1');
      expect(result).toEqual({ lead: 0, engaged: 0, active: 0, completed: 0, archived: 0 });
    });

    it('passes undefined agentId for admin (no filter)', async () => {
      mockRepo.getSellerStatusCounts.mockResolvedValue({
        lead: 5, engaged: 2, active: 3, completed: 1, archived: 0,
      });

      await agentService.getSellerStatusCounts(undefined);

      expect(mockRepo.getSellerStatusCounts).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getNotificationHistory', () => {
    it('returns paginated result with items, total, page, totalPages', async () => {
      const item = {
        id: 'n1',
        channel: 'email',
        templateName: 'welcome',
        content: 'Hello',
        status: 'sent',
        sentAt: new Date('2026-01-01'),
        deliveredAt: null,
        createdAt: new Date('2026-01-01'),
      };
      mockRepo.getNotificationHistory.mockResolvedValue({ items: [item] as never, total: 25 });

      const result = await agentService.getNotificationHistory('seller-1', 'agent-1', {
        page: 2,
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('n1');
      expect(result.total).toBe(25);
      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(3);
      expect(mockRepo.getNotificationHistory).toHaveBeenCalledWith('seller-1', 'agent-1', {
        skip: 10,
        take: 10,
      });
    });

    it('defaults to page 1 with limit 10 when opts omitted', async () => {
      mockRepo.getNotificationHistory.mockResolvedValue({ items: [], total: 0 });

      const result = await agentService.getNotificationHistory('seller-1');

      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(0);
      expect(mockRepo.getNotificationHistory).toHaveBeenCalledWith('seller-1', undefined, {
        skip: 0,
        take: 10,
      });
    });

    it('returns totalPages 1 when total equals limit', async () => {
      mockRepo.getNotificationHistory.mockResolvedValue({ items: [], total: 10 });

      const result = await agentService.getNotificationHistory('seller-1', undefined, {
        page: 1,
        limit: 10,
      });

      expect(result.totalPages).toBe(1);
    });
  });
});
