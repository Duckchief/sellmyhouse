import * as agentService from '../agent.service';
import * as agentRepo from '../agent.repository';
import { NotFoundError } from '@/domains/shared/errors';

jest.mock('../agent.repository');
jest.mock('../../viewing/viewing.service');

const mockRepo = agentRepo as jest.Mocked<typeof agentRepo>;

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
    it('partitions leads into unassigned and all arrays', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      mockRepo.getLeadQueue.mockResolvedValue([
        {
          id: 'seller-1',
          name: 'John Tan',
          phone: '91234567',
          leadSource: 'website',
          createdAt: twoHoursAgo,
          agentId: null,
          status: 'lead',
        } as unknown as Awaited<ReturnType<typeof agentRepo.getLeadQueue>>[0],
        {
          id: 'seller-2',
          name: 'Mary Lim',
          phone: '98765432',
          leadSource: 'tiktok',
          createdAt: oneHourAgo,
          agentId: 'agent-1',
          status: 'lead',
        } as unknown as Awaited<ReturnType<typeof agentRepo.getLeadQueue>>[0],
      ]);
      mockRepo.getWelcomeNotificationStatus.mockResolvedValue(
        new Map([['seller-1', true], ['seller-2', false]]),
      );

      const result = await agentService.getLeadQueue('agent-1');

      expect(result.unassigned).toHaveLength(1);
      expect(result.unassigned[0].id).toBe('seller-1');
      expect(result.unassigned[0].agentId).toBeNull();
      expect(result.all).toHaveLength(2);
      expect(result.all[0].id).toBe('seller-1');
      expect(result.all[1].id).toBe('seller-2');
    });

    it('returns empty unassigned when all leads are assigned', async () => {
      const now = new Date();
      mockRepo.getLeadQueue.mockResolvedValue([
        {
          id: 'seller-1',
          name: 'John Tan',
          phone: '91234567',
          leadSource: null,
          createdAt: now,
          agentId: 'agent-1',
          status: 'lead',
        } as unknown as Awaited<ReturnType<typeof agentRepo.getLeadQueue>>[0],
      ]);
      mockRepo.getWelcomeNotificationStatus.mockResolvedValue(new Map([['seller-1', false]]));

      const result = await agentService.getLeadQueue('agent-1');

      expect(result.unassigned).toHaveLength(0);
      expect(result.all).toHaveLength(1);
    });

    it('returns both empty arrays when no leads exist', async () => {
      mockRepo.getLeadQueue.mockResolvedValue([]);
      mockRepo.getWelcomeNotificationStatus.mockResolvedValue(new Map());

      const result = await agentService.getLeadQueue();

      expect(result.unassigned).toHaveLength(0);
      expect(result.all).toHaveLength(0);
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
        cdd: { status: 'verified', verifiedAt: new Date() },
        eaa: { status: 'not_started', signedAt: null },
        consent: { service: true, marketing: false, withdrawnAt: null },
        caseFlags: [],
      });

      const result = await agentService.getComplianceStatus('seller-1');

      expect(result.cdd.status).toBe('verified');
      expect(result.eaa.status).toBe('not_started');
    });
  });
});
