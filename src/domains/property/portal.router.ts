// src/domains/property/portal.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import * as portalService from './portal.service';
import * as photoService from './photo.service';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { getHasAvatar } from '../profile/profile.service';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import archiver from 'archiver';

export const portalRouter = Router();

const agentAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];

function getAgentFilter(user: AuthenticatedUser): string | undefined {
  return user.role === 'admin' ? undefined : user.id;
}

// GET /agent/portals — portals index (all active listings)
portalRouter.get(
  '/agent/portals',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const listings = await portalService.getPortalIndex(getAgentFilter(user));

      if (req.headers['hx-request']) {
        return res.render('partials/agent/portals-index-table.njk', { listings });
      }
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/portals-index', {
        pageTitle: 'Portal Listings',
        user,
        hasAvatar,
        listings,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/listings/:listingId/portals — dedicated portal page
portalRouter.get(
  '/agent/listings/:listingId/portals',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { listingId } = req.params as { listingId: string };

      const [portalListings, listingData] = await Promise.all([
        portalService.getPortalListings(listingId, user.id, user.role),
        portalService.getListingForPortalsPage(listingId, user.id, user.role),
      ]);

      if (req.headers['hx-request']) {
        return res.render('partials/agent/portal-panels', { portalListings, listingId });
      }
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/portals', {
        pageTitle: 'Portal Listings',
        user,
        hasAvatar,
        portalListings,
        listingData,
        listingId,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/listings/:listingId/photos/download-all — download all approved photos as ZIP, then delete
portalRouter.post(
  '/agent/listings/:listingId/photos/download-all',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { listingId } = req.params as { listingId: string };

      const { files } = await portalService.downloadAndDeletePhotos(
        listingId,
        user.id,
        user.role,
      );

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="photos-${listingId}.zip"`);
      res.setHeader('Cache-Control', 'no-store');

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);
      for (const file of files) {
        archive.append(file.buffer, { name: file.filename });
      }
      await archive.finalize();
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
