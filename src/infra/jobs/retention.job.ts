import { logger } from '../logger';
import { scanRetention } from '../../domains/compliance/compliance.service';

export async function runRetentionScan(): Promise<void> {
  logger.info('Retention scan starting');
  const result = await scanRetention();
  logger.info(
    { flaggedCount: result.flaggedCount, skippedCount: result.skippedCount },
    'Retention scan complete',
  );
}
