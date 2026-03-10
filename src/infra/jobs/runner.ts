import cron from 'node-cron';
import { logger } from '../logger';

interface Job {
  name: string;
  schedule: string;
  handler: () => Promise<void>;
}

const jobs: Job[] = [];

export function registerJob(name: string, schedule: string, handler: () => Promise<void>) {
  jobs.push({ name, schedule, handler });
}

export function startJobs() {
  for (const job of jobs) {
    cron.schedule(job.schedule, async () => {
      logger.info(`Running job: ${job.name}`);
      try {
        await job.handler();
        logger.info(`Job completed: ${job.name}`);
      } catch (err) {
        logger.error({ err }, `Job failed: ${job.name}`);
      }
    });
    logger.info(`Registered job: ${job.name} (${job.schedule})`);
  }
}
