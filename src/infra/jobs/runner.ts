import cron from 'node-cron';
import { logger } from '../logger';

interface Job {
  name: string;
  schedule: string;
  handler: () => Promise<void>;
  timezone?: string;
}

const jobs: Job[] = [];
const runningJobs = new Set<string>();

export function registerJob(
  name: string,
  schedule: string,
  handler: () => Promise<void>,
  timezone?: string,
) {
  jobs.push({ name, schedule, handler, timezone });
}

export function startJobs() {
  for (const job of jobs) {
    const options: { timezone?: string } = {};
    if (job.timezone) {
      options.timezone = job.timezone;
    }
    cron.schedule(
      job.schedule,
      async () => {
        if (runningJobs.has(job.name)) {
          logger.warn({ job: job.name }, 'Skipping job — previous execution still running');
          return;
        }
        runningJobs.add(job.name);
        try {
          logger.info(`Running job: ${job.name}`);
          await job.handler();
          logger.info(`Job completed: ${job.name}`);
        } catch (err) {
          logger.error({ err }, `Job failed: ${job.name}`);
        } finally {
          runningJobs.delete(job.name);
        }
      },
      options,
    );
    logger.info(`Registered job: ${job.name} (${job.schedule})`);
  }
}

/** Exposed for testing only */
export function _getRunningJobs(): Set<string> {
  return runningJobs;
}

/** Reset internal state — for testing only */
export function _resetJobs(): void {
  jobs.length = 0;
  runningJobs.clear();
}
