import { Router, Request, Response } from 'express';
import { prisma } from '../database/prisma';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', timestamp: new Date().toISOString() });
  }
});

export { router as healthRouter };
