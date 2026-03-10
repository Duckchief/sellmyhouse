import { Router, Request, Response, NextFunction } from 'express';
import { HdbService } from '../hdb/service';

export const publicRouter = Router();

const hdbService = new HdbService();

publicRouter.get('/', (_req: Request, res: Response) => {
  res.render('pages/public/home');
});

publicRouter.get('/market-report', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [towns, flatTypes, storeyRanges] = await Promise.all([
      hdbService.getDistinctTowns(),
      hdbService.getDistinctFlatTypes(),
      hdbService.getDistinctStoreyRanges(),
    ]);

    res.render('pages/public/market-report', { towns, flatTypes, storeyRanges });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/api/hdb/report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const town = req.query.town as string;
    const flatType = req.query.flatType as string;
    const storeyRange = (req.query.storeyRange as string) || undefined;
    const months = req.query.months ? parseInt(req.query.months as string, 10) : 24;

    if (!town || !flatType) {
      return res
        .status(400)
        .render('partials/public/report-results', { error: 'Town and flat type are required' });
    }

    const report = await hdbService.getMarketReport({ town, flatType, storeyRange, months });

    if (req.headers['hx-request']) {
      return res.render('partials/public/report-results', { report });
    }
    return res.json({ report });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/privacy', (_req: Request, res: Response) => {
  res.render('pages/public/privacy');
});

publicRouter.get('/terms', (_req: Request, res: Response) => {
  res.render('pages/public/terms');
});
