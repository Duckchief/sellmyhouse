import { logger } from '../logger';
import { purgeSensitiveDocs } from '../../domains/compliance/compliance.service';
import * as sellerDocService from '../../domains/seller/seller-document.service';
import * as settingsService from '../../domains/shared/settings.service';

export async function runPurgeSensitiveDocsJob(): Promise<void> {
  logger.info('Daily Tier 1 sensitive doc purge starting');
  const { purgedCount } = await purgeSensitiveDocs();
  logger.info({ purgedCount }, 'Daily Tier 1 sensitive doc purge complete');

  // Seller document auto-purge (7-day backstop)
  const retentionDays = await settingsService.getNumber('sensitive_doc_retention_days', 7);
  const sellerDocPurgedCount = await sellerDocService.purgeExpiredSellerDocuments(retentionDays);
  logger.info({ sellerDocPurgedCount }, 'Seller document auto-purge complete');
}
