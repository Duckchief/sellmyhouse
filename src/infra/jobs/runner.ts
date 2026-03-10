import cron from 'node-cron';
import { logger } from '../logger';

interface Job {
  name: string;
  schedule: string;
  handler: () => Promise<void>;
  timezone?: string;
}

const jobs: Job[] = [];

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
        logger.info(`Running job: ${job.name}`);
        try {
          await job.handler();
          logger.info(`Job completed: ${job.name}`);
        } catch (err) {
          logger.error({ err }, `Job failed: ${job.name}`);
        }
      },
      options,
    );
    logger.info(`Registered job: ${job.name} (${job.schedule})`);
  }
}
