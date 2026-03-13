// src/domains/property/portal.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import * as portalService from './portal.service';
import * as photoService from './photo.service';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

export const portalRouter = Router();

const agentAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];

// GET /agent/listings/:listingId/portals — dedicated portal page
portalRouter.get(
  '/agent/listings/:listingId/portals',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { listingId } = req.params;
      const portalListings = await portalService.getPortalListings(
        listingId as string,
        user.id,
        user.role,
      );

      if (req.headers['hx-request']) {
        return res.render('partials/agent/portal-panels', { portalListings, listingId });
      }
      res.render('pages/agent/portals', { portalListings, listingId });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/listings/:listingId/photos/:photoId — agent views a listing photo (auth-gated, ownership-checked)
portalRouter.get(
  '/agent/listings/:listingId/photos/:photoId',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { listingId, photoId } = req.params;
      const { buffer } = await photoService.getPhotoForAgent(
        listingId as string,
        photoId as string,
        user.id,
        user.role,
      );

      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/portal-listings/:id/mark-posted — agent marks listing as posted + provides URL
portalRouter.post(
  '/agent/portal-listings/:id/mark-posted',
  ...agentAuth,
  [body('url').notEmpty().isURL().withMessage('A valid portal URL is required')],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const portalListing = await portalService.markAsPosted(
        req.params['id'] as string,
        req.body.url as string,
      );

      if (req.headers['hx-request']) {
        return res.render('partials/agent/portal-panel', { portalListing });
      }
      res.json({ portalListing });
    } catch (err) {
      next(err);
    }
  },
);
