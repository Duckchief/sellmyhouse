// src/domains/admin/__tests__/admin.analytics.test.ts
import * as adminService from '../admin.service';
import * as adminRepo from '../admin.repository';
import * as settingsService from '@/domains/shared/settings.service';

jest.mock('../admin.repository');
jest.mock('@/domains/shared/settings.service');

const mockRepo = adminRepo as jest.Mocked<typeof adminRepo>;
const mockSettings = settingsService as jest.Mocked<typeof settingsService>;

beforeEach(() => jest.clearAllMocks());

describe('getAnalytics', () => {
  it('returns analytics data with default date range (last 30 days)', async () => {
    mockRepo.getRevenueMetrics.mockResolvedValue({
      totalRevenue: 0,
      completedCount: 3,
      pipelineValue: 1500000,
      activeTransactions: 2,
      pendingInvoices: 1,
    });
    (mockSettings.getCommission as jest.Mock).mockResolvedValue({
      amount: 1499,
      gstRate: 0.09,
      gstAmount: 134.91,
      total: 1633.91,
    });
    mockRepo.getTransactionFunnel.mockResolvedValue({
      lead: 10,
      engaged: 5,
      active: 3,
      option_exercised: 1,
      completed: 3,
    });
    mockRepo.getTimeToClose.mockResolvedValue({
      averageDays: 45,
      count: 3,
      byFlatType: { '4 ROOM': { averageDays: 42, count: 2 } },
    });
    mockRepo.getLeadSourceMetrics.mockResolvedValue({
      website: { total: 20, conversionRate: 15 },
      referral: { total: 5, conversionRate: 40 },
    });
    mockRepo.getViewingMetrics.mockResolvedValue({
      totalViewings: 50,
      completed: 40,
      noShowRate: 10,
      cancellationRate: 5,
    });
    mockRepo.getReferralMetrics.mockResolvedValue({
      totalLinks: 30,
      totalClicks: 100,
      leadsCreated: 5,
      transactionsCompleted: 1,
      conversionRate: 16.67,
      topReferrers: [{ name: 'Jane', clicks: 20, status: 'active' }],
    });

    const result = await adminService.getAnalytics({});

    expect(result.revenue.totalRevenue).toBe(4901.73);
    expect(result.revenue.commissionPerTransaction).toBe(1633.91);
    expect(result.funnel).toHaveProperty('lead', 10);
    expect(result.timeToClose.averageDays).toBe(45);
    expect(result.leadSources).toHaveProperty('website');
    expect(result.viewings.totalViewings).toBe(50);
    expect(result.referrals.topReferrers).toHaveLength(1);
  });
});
