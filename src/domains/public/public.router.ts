import { Router, Request, Response, NextFunction } from 'express';
import { HdbService } from '../hdb/service';
import * as contentService from '../content/content.service';
import { hdbRateLimiter } from '../../infra/http/middleware/rate-limit';

export const publicRouter = Router();

const hdbService = new HdbService();

publicRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Referral tracking (session store + click increment) is handled by
    // the global referralTrackingMiddleware — no duplicate call here.
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

publicRouter.get(
  '/api/hdb/report',
  hdbRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const town = req.query.town as string;
      const flatType = req.query.flatType as string;
      const storeyRange = (req.query.storeyRange as string) || undefined;
      const rawMonths = parseInt(req.query.months as string, 10);
      const months = isNaN(rawMonths) || rawMonths < 0 ? 24 : Math.min(rawMonths, 240);

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
  },
);

publicRouter.get(
  '/api/hdb/transactions',
  hdbRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const town = req.query.town as string;
      const flatType = req.query.flatType as string;
      const storeyRange = (req.query.storeyRange as string) || undefined;
      const rawMonths = parseInt(req.query.months as string, 10);
      const months = isNaN(rawMonths) || rawMonths < 0 ? 24 : Math.min(rawMonths, 240);
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
  },
);

publicRouter.get(
  '/api/hdb/storey-ranges',
  hdbRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const town = req.query.town as string | undefined;
      const flatType = req.query.flatType as string | undefined;

      const storeyRanges =
        town && flatType
          ? await hdbService.getDistinctStoreyRangesByTownAndFlatType(town, flatType)
          : await hdbService.getDistinctStoreyRanges();

      return res.render('partials/public/storey-range-options', { storeyRanges });
    } catch (err) {
      next(err);
    }
  },
);

publicRouter.get(
  '/api/hdb/flat-types',
  hdbRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const town = req.query.town as string | undefined;

      const flatTypes = town
        ? await hdbService.getDistinctFlatTypesByTown(town)
        : await hdbService.getDistinctFlatTypes();

      return res.render('partials/public/flat-type-options', { flatTypes });
    } catch (err) {
      next(err);
    }
  },
);

publicRouter.get('/privacy', (_req: Request, res: Response) => {
  res.render('pages/public/privacy');
});

publicRouter.get('/terms', (_req: Request, res: Response) => {
  res.render('pages/public/terms');
});
