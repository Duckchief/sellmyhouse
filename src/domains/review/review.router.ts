import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as reviewService from './review.service';
import { validateEntityParams, validateRejectBody } from './review.validator';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import type { EntityType } from './review.types';

export const reviewRouter = Router();

const reviewAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];

function getAgentFilter(user: AuthenticatedUser): string | undefined {
  return user.role === 'admin' ? undefined : user.id;
}

// GET /agent/reviews — Review queue (tabbed)
reviewRouter.get(
  '/agent/reviews',
  ...reviewAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const queue = await reviewService.getPendingQueue(getAgentFilter(user));
      const activeTab = (req.query.tab as string) || 'all';

      if (req.headers['hx-request']) {
        return res.render('partials/agent/review-queue', { queue, activeTab });
      }
      res.render('pages/agent/reviews', { queue, activeTab });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/reviews/:entityType/:entityId/detail — Slide-out panel
reviewRouter.get(
  '/agent/reviews/:entityType/:entityId/detail',
  ...reviewAuth,
  ...validateEntityParams,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const entityType = req.params['entityType'] as EntityType;
      const entityId = req.params['entityId'] as string;
      const detail = await reviewService.getDetailForReview(entityType, entityId);

      const partialMap: Record<EntityType, string> = {
        financial_report: 'partials/agent/review-detail-financial',
        listing_description: 'partials/agent/review-detail-listing-desc',
        listing_photos: 'partials/agent/review-detail-listing-photos',
        weekly_update: 'partials/agent/review-detail-weekly-update',
        market_content: 'partials/agent/review-detail-market-content',
        document_checklist: 'partials/agent/review-detail-document-checklist',
      };

      res.render(partialMap[entityType], { detail, entityType, entityId });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/reviews/:entityType/:entityId/approve
reviewRouter.post(
  '/agent/reviews/:entityType/:entityId/approve',
  ...reviewAuth,
  ...validateEntityParams,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const entityType = req.params['entityType'] as EntityType;
      const entityId = req.params['entityId'] as string;

      await reviewService.approveItem({
        entityType,
        entityId,
        agentId: user.id,
        callerRole: user.role,
      });

      res.render('partials/agent/review-row', {
        item: null,
        entityType,
        entityId,
        approved: true,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/reviews/:entityType/:entityId/reject
reviewRouter.post(
  '/agent/reviews/:entityType/:entityId/reject',
  ...reviewAuth,
  ...validateEntityParams,
  ...validateRejectBody,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const entityType = req.params['entityType'] as EntityType;
      const entityId = req.params['entityId'] as string;
      const reviewNotes = req.body.reviewNotes as string;

      await reviewService.rejectItem({
        entityType,
        entityId,
        agentId: user.id,
        reviewNotes,
        callerRole: user.role,
      });

      res.render('partials/agent/review-row', {
        item: null,
        entityType,
        entityId,
        rejected: true,
      });
    } catch (err) {
      next(err);
    }
  },
);
