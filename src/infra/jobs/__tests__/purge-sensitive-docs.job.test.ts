import { runPurgeSensitiveDocsJob } from '../purge-sensitive-docs.job';
import * as complianceService from '@/domains/compliance/compliance.service';

jest.mock('@/domains/compliance/compliance.service');
jest.mock('../../logger', () => ({ logger: { info: jest.fn(), error: jest.fn() } }));
jest.mock('@/domains/shared/settings.service', () => ({
  getNumber: jest.fn().mockResolvedValue(7),
}));
jest.mock('@/domains/seller/seller-document.service', () => ({
  purgeExpiredSellerDocuments: jest.fn().mockResolvedValue(0),
}));

const mockComplianceService = jest.mocked(complianceService);

import { logger } from '../../logger';
const mockLogger = jest.mocked(logger);

describe('runPurgeSensitiveDocsJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls purgeSensitiveDocs and logs purgedCount', async () => {
    mockComplianceService.purgeSensitiveDocs.mockResolvedValueOnce({ purgedCount: 3 });

    await runPurgeSensitiveDocsJob();

    expect(mockComplianceService.purgeSensitiveDocs).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith(
      { purgedCount: 3 },
      'Daily Tier 1 sensitive doc purge complete',
    );
  });

  it('logs purgedCount 0 when no transactions qualify', async () => {
    mockComplianceService.purgeSensitiveDocs.mockResolvedValueOnce({ purgedCount: 0 });

    await runPurgeSensitiveDocsJob();

    expect(mockLogger.info).toHaveBeenCalledWith(
      { purgedCount: 0 },
      'Daily Tier 1 sensitive doc purge complete',
    );
  });
});
