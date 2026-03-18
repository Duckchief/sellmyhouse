import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './infra/http/app';
import { logger } from './infra/logger';
import { getKeyProvider } from './infra/security/key-provider';

// E1: Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
  logger.error(err, 'Uncaught exception — shutting down');
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'Unhandled rejection');
});
import { registerJob, startJobs } from './infra/jobs/runner';
import { HdbSyncService } from './domains/hdb/sync.service';
import { registerViewingJobs } from './domains/viewing/viewing.jobs';
import { registerTransactionJobs } from './domains/transaction/transaction.jobs';
import { registerContentJobs } from './domains/content/content.jobs';
import { runRetentionScan } from './infra/jobs/retention.job';
import { runAnonymiseOffersJob } from './infra/jobs/anonymise-offers.job';
import { initVirusScanner } from './infra/security/virus-scanner';
import * as sellerService from './domains/seller/seller.service';

const app = createApp();
const port = parseInt(process.env.PORT || '3000', 10);

// Register cron jobs
registerJob(
  'hdb-data-sync',
  '0 3 * * 0', // Every Sunday at 3am
  async () => {
    const syncService = new HdbSyncService();
    await syncService.sync();
  },
  'Asia/Singapore',
);

registerViewingJobs();
registerTransactionJobs();
registerContentJobs();

// Register retention job (Saturday midnight SGT, configurable via SystemSetting 'retention_schedule')
registerJob(
  'retention-scan',
  '0 0 * * 6', // Saturday midnight
  runRetentionScan,
  'Asia/Singapore',
);

// Register offer PII anonymisation job (daily at 2:30am SGT)
registerJob(
  'anonymise-offers',
  '30 2 * * *', // 2:30am daily
  runAnonymiseOffersJob,
  'Asia/Singapore',
);

// Register seller inactive check (Monday 9am SGT)
registerJob(
  'seller:inactive-check',
  '0 9 * * 1',
  async () => {
    await sellerService.checkInactiveSellers();
  },
  'Asia/Singapore',
);

// Initialize virus scanner (graceful if ClamAV unavailable)
initVirusScanner().catch(() => {
  // Initialization failure is already logged inside initVirusScanner
});

// Log active key provider at startup (env or aws)
try {
  getKeyProvider(); // initializes singleton + validates config
  logger.info({ keyProvider: process.env['KEY_PROVIDER'] ?? 'env' }, 'KeyProvider initialized');
} catch (err) {
  logger.error({ err }, 'KeyProvider initialization failed — CDD document encryption unavailable');
  process.exit(1);
}

// Start cron jobs and server
startJobs();

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
