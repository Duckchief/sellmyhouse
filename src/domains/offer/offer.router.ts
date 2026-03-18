// src/domains/offer/offer.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as offerService from './offer.service';
import {
  validateCreateOffer,
  validateCounterOffer,
  validateShareAnalysis,
} from './offer.validator';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { offerRateLimiter } from '@/infra/http/middleware/rate-limit';
import { getHasAvatar } from '../profile/profile.service';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

export const offerRouter = Router();

const agentAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];

// GET /agent/properties/:propertyId/offers — offer chain for a property
offerRouter.get(
  '/agent/properties/:propertyId/offers',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { propertyId } = req.params;
      const user = req.user as AuthenticatedUser;
      const offers = await offerService.getOffersForProperty(
        propertyId as string,
        user.id,
        user.role,
      );

      if (req.headers['hx-request']) {
        return res.render('partials/agent/offer-chain', { offers, propertyId });
      }
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/offers', {
        pageTitle: 'Offers',
        user,
        hasAvatar,
        offers,
        propertyId,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/offers — record new offer
offerRouter.post(
  '/agent/offers',
  ...agentAuth,
  offerRateLimiter,
  ...validateCreateOffer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const offer = await offerService.createOffer({
        propertyId: req.body.propertyId as string,
        sellerId: req.body.sellerId as string,
        town: req.body.town as string,
        flatType: req.body.flatType as string,
        buyerName: req.body.buyerName as string,
        buyerPhone: req.body.buyerPhone as string,
        buyerAgentName: req.body.buyerAgentName as string | undefined,
        buyerAgentCeaReg: req.body.buyerAgentCeaReg as string | undefined,
        offerAmount: req.body.offerAmount, // pass as-is; Prisma Decimal handles conversion
        notes: req.body.notes as string | undefined,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.status(201).render('partials/agent/offer-row', { offer });
      }
      res.status(201).json({ offer });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/offers/:id/counter
offerRouter.post(
  '/agent/offers/:id/counter',
  ...agentAuth,
  offerRateLimiter,
  ...validateCounterOffer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const child = await offerService.counterOffer({
        parentOfferId: req.params['id'] as string,
        counterAmount: req.body.counterAmount, // pass as-is; Prisma Decimal handles conversion
        notes: req.body.notes as string | undefined,
        agentId: user.id,
        role: user.role,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/offer-row', { offer: child });
      }
      res.json({ offer: child });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/offers/:id/accept
offerRouter.post(
  '/agent/offers/:id/accept',
  ...agentAuth,
  offerRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const offer = await offerService.acceptOffer({
        offerId: req.params['id'] as string,
        agentId: user.id,
        role: user.role,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/offer-row', { offer });
      }
      res.json({ offer });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/offers/:id/reject
offerRouter.post(
  '/agent/offers/:id/reject',
  ...agentAuth,
  offerRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const offer = await offerService.rejectOffer({
        offerId: req.params['id'] as string,
        agentId: user.id,
        role: user.role,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/offer-row', { offer });
      }
      res.json({ offer });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/offers/:id/analysis/review
offerRouter.post(
  '/agent/offers/:id/analysis/review',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const offer = await offerService.reviewAiAnalysis({
        offerId: req.params['id'] as string,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/offer-analysis', { offer });
      }
      res.json({ offer });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/offers/:id/analysis/share
offerRouter.post(
  '/agent/offers/:id/analysis/share',
  ...agentAuth,
  ...validateShareAnalysis,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const offer = await offerService.shareAiAnalysis({
        offerId: req.params['id'] as string,
        agentId: user.id,
        sellerId: req.body.sellerId as string,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/offer-analysis', { offer });
      }
      res.json({ offer });
    } catch (err) {
      next(err);
    }
  },
);
