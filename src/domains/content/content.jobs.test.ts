// src/domains/content/content.jobs.test.ts
import * as contentRepo from './content.repository';
import * as contentService from './content.service';
import { registerReferralJobs } from './content.jobs';

jest.mock('./content.repository');
jest.mock('./content.service');
jest.mock('@/infra/jobs/runner');
jest.mock('@/infra/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockRepo = jest.mocked(contentRepo);
const mockService = jest.mocked(contentService);

describe('registerReferralJobs — referral-completion-daily', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marks referral complete when referred seller has a completed transaction', async () => {
    mockRepo.findReferralsWithCompletedTransactions.mockResolvedValue([
      { id: 'ref-1', referredSellerId: 'seller-referred', status: 'lead_created' },
    ] as never);
    mockService.markReferralTransactionComplete.mockResolvedValue(undefined);

    // Manually invoke the job callback by triggering the registered job
    // We extract the callback from the runner mock
    const { registerJob } = jest.requireMock('@/infra/jobs/runner');
    registerReferralJobs();
    // registerJob(name, schedule, callback, timezone) — callback is index 2
    const jobCallback = (registerJob as jest.Mock).mock.calls.find(
      ([name]: [string]) => name === 'referral-completion-daily',
    )?.[2] as (() => Promise<void>) | undefined;

    expect(jobCallback).toBeDefined();
    await jobCallback?.();

    expect(mockRepo.findReferralsWithCompletedTransactions).toHaveBeenCalledTimes(1);
    expect(mockService.markReferralTransactionComplete).toHaveBeenCalledWith('seller-referred');
  });

  it('does NOT call markReferralTransactionComplete when no eligible referrals exist', async () => {
    mockRepo.findReferralsWithCompletedTransactions.mockResolvedValue([]);

    const { registerJob } = jest.requireMock('@/infra/jobs/runner');
    registerReferralJobs();
    const jobCallback = (registerJob as jest.Mock).mock.calls.find(
      ([name]: [string]) => name === 'referral-completion-daily',
    )?.[2] as (() => Promise<void>) | undefined;

    await jobCallback?.();

    expect(mockService.markReferralTransactionComplete).not.toHaveBeenCalled();
  });
});
