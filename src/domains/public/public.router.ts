import { Router, Request, Response, NextFunction } from 'express';
import { HdbService } from '../hdb/service';
import * as contentService from '../content/content.service';

export const publicRouter = Router();

const hdbService = new HdbService();

publicRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const testimonials = await contentService.getFeaturedTestimonials();
    res.render('pages/public/home', { testimonials });
  } catch (err) {
    next(err);
  }
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

    const [report, paginated] = await Promise.all([
      hdbService.getMarketReport({ town, flatType, storeyRange, months }),
      hdbService.getPaginatedTransactions({ town, flatType, storeyRange, months }, 1, 10),
    ]);

    if (req.headers['hx-request']) {
      return res.render('partials/public/report-results', { report, ...paginated });
    }
    return res.json({ report });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/api/hdb/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const town = req.query.town as string;
    const flatType = req.query.flatType as string;
    const storeyRange = (req.query.storeyRange as string) || undefined;
    const months = req.query.months ? parseInt(req.query.months as string, 10) : 24;
    const page = req.query.page ? Math.max(1, parseInt(req.query.page as string, 10)) : 1;
    const pageSize = 10;

    if (!town || !flatType) {
      return res.status(400).render('partials/public/transaction-rows', {
        error: 'Town and flat type are required',
      });
    }

    const result = await hdbService.getPaginatedTransactions(
      { town, flatType, storeyRange, months },
      page,
      pageSize,
    );

    return res.render('partials/public/transaction-rows', { ...result });
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
