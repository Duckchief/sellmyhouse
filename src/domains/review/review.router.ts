import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as reviewService from './review.service';
import {
  validateEntityParams,
  validateRejectBody,
  validateApproveDescriptionBody,
} from './review.validator';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { getHasAvatar } from '../profile/profile.service';
import { localStorage } from '@/infra/storage/local-storage';
import { NotFoundError } from '../shared/errors';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import type { EntityType } from './review.types';
import type { PhotoRecord } from '../property/property.types';

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
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/reviews', {
        pageTitle: 'Reviews',
        user,
        hasAvatar,
        queue,
        activeTab,
      });
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

      // Prisma returns listing.photos as a JSON string — parse it for the template
      if (
        entityType === 'listing_photos' &&
        detail &&
        'photos' in detail &&
        typeof detail.photos === 'string'
      ) {
        (detail as unknown as Record<string, unknown>).photos = JSON.parse(
          detail.photos,
        ) as PhotoRecord[];
      }

      const partialMap: Record<EntityType, string> = {
        financial_report: 'partials/agent/review-detail-financial',
        listing_description: 'partials/agent/review-detail-listing-desc',
        listing_photos: 'partials/agent/review-detail-listing-photos',
        weekly_update: 'partials/agent/review-detail-weekly-update',
        document_checklist: 'partials/agent/review-detail-document-checklist',
      };

      res.render(partialMap[entityType], { detail, entityType, entityId });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/reviews/listing_photos/:listingId/photos/:photoId — serve photo for agent review
reviewRouter.get(
  '/agent/reviews/listing_photos/:listingId/photos/:photoId',
  ...reviewAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const listingId = req.params['listingId'] as string;
      const photoId = req.params['photoId'] as string;

      const listing = await reviewService.getDetailForReview('listing_photos', listingId);
      if (!listing || !('photos' in listing) || !listing.photos) {
        throw new NotFoundError('Listing', listingId);
      }

      const photos = JSON.parse(listing.photos as string) as PhotoRecord[];
      const photo = photos.find((p) => p.id === photoId);
      if (!photo) {
        throw new NotFoundError('Photo', photoId);
      }

      const buffer = await localStorage.read(photo.optimizedPath);
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
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
  ...validateApproveDescriptionBody,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const entityType = req.params['entityType'] as EntityType;
      const entityId = req.params['entityId'] as string;
      const text = req.body.text as string | undefined;

      await reviewService.approveItem({
        entityType,
        entityId,
        agentId: user.id,
        callerRole: user.role,
        text,
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
