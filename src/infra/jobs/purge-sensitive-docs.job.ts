import { logger } from '../logger';
import { purgeSensitiveDocs } from '../../domains/compliance/compliance.service';

export async function runPurgeSensitiveDocsJob(): Promise<void> {
  logger.info('Daily Tier 1 sensitive doc purge starting');
  const { purgedCount } = await purgeSensitiveDocs();
  logger.info({ purgedCount }, 'Daily Tier 1 sensitive doc purge complete');
}
