import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './infra/http/app';
import { logger } from './infra/logger';
import { registerJob, startJobs } from './infra/jobs/runner';
import { HdbSyncService } from './domains/hdb/sync.service';
import { registerViewingJobs } from './domains/viewing/viewing.jobs';
import { runRetentionScan } from './infra/jobs/retention.job';

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

// Register retention job (Saturday midnight SGT, configurable via SystemSetting 'retention_schedule')
registerJob(
  'retention-scan',
  '0 0 * * 6', // Saturday midnight
  runRetentionScan,
  'Asia/Singapore',
);

// Start cron jobs and server
startJobs();

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
