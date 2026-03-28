import { Router, Request, Response, NextFunction } from 'express';
import { HdbService } from '../hdb/service';
import * as contentService from '../content/content.service';
import { hdbRateLimiter } from '../../infra/http/middleware/rate-limit';
import { HDB_TOWNS, HDB_FLAT_TYPES } from '../property/property.types';

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

      if (!(HDB_TOWNS as readonly string[]).includes(town)) {
        return res.status(400).render('partials/public/report-results', { error: 'Invalid town' });
      }

      if (!(HDB_FLAT_TYPES as readonly string[]).includes(flatType)) {
        return res
          .status(400)
          .render('partials/public/report-results', { error: 'Invalid flat type' });
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

      if (!(HDB_TOWNS as readonly string[]).includes(town)) {
        return res
          .status(400)
          .render('partials/public/transaction-rows', { error: 'Invalid town' });
      }

      if (!(HDB_FLAT_TYPES as readonly string[]).includes(flatType)) {
        return res
          .status(400)
          .render('partials/public/transaction-rows', { error: 'Invalid flat type' });
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
      const rawTown = req.query.town as string | undefined;
      const town = rawTown?.trim() || undefined;

      const flatTypes = town
        ? await hdbService.getDistinctFlatTypesByTown(town)
        : await hdbService.getDistinctFlatTypes();

      return res.render('partials/public/flat-type-options', { flatTypes });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/hdb/property-info?block=123&street=TAMPINES+ST+21 — lookup town + lease year
publicRouter.get(
  '/api/hdb/property-info',
  hdbRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const block = (req.query.block as string)?.trim();
      const street = (req.query.street as string)?.trim();

      if (!block || !street) {
        return res.json({ town: null, leaseCommenceDate: null });
      }

      const result = await hdbService.getPropertyInfo(block, street);
      return res.json({
        town: result?.town ?? null,
        leaseCommenceDate: result?.leaseCommenceDate ?? null,
      });
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
