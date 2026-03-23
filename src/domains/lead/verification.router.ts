import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import * as verificationService from './verification.service';
import { ValidationError } from '../shared/errors';
import { HDB_TOWNS } from '../property/property.types';
import { HdbService } from '../hdb/service';
import {
  leadRateLimiter,
  resendVerificationRateLimiter,
} from '../../infra/http/middleware/rate-limit';

export const verificationRouter = Router();
const hdbService = new HdbService();

const VALID_TIMELINES = ['one_to_three_months', 'three_to_six_months', 'just_thinking'];
const VALID_REASONS = ['upgrading', 'downsizing', 'relocating', 'financial', 'investment', 'other'];

function signSellerId(sellerId: string): string {
  const secret = process.env.SESSION_SECRET ?? 'dev-secret';
  return crypto.createHmac('sha256', secret).update(sellerId).digest('hex');
}

function verifySellerId(sellerId: string, signature: string): boolean {
  const expected = signSellerId(sellerId);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// GET /verify-email?token=xxx — verify email and show details form
verificationRouter.get('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.query['token'] as string;
    if (!token) {
      return res.render('pages/public/verify-email-error', {
        pageTitle: 'Verification Failed',
        message: 'No verification token provided.',
      });
    }

    const { sellerId } = await verificationService.verifyEmailToken(token);
    const signature = signSellerId(sellerId);

    res.render('pages/public/verify-email', {
      pageTitle: 'Complete Your Submission',
      sellerId,
      signature,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.render('pages/public/verify-email-error', {
        pageTitle: 'Verification Failed',
        message: err.message,
      });
    }
    next(err);
  }
});

// DEV ONLY: GET /dev/lead-details/:sellerId — render details form for a verified seller
if (process.env.NODE_ENV !== 'production') {
  verificationRouter.get('/dev/lead-details/:sellerId', (req: Request, res: Response) => {
    const sellerId = req.params['sellerId'] as string;
    const signature = signSellerId(sellerId);
    res.render('pages/public/verify-email', {
      pageTitle: 'Complete Your Submission',
      sellerId,
      signature,
    });
  });
}

// POST /verify-email/details — submit lead details
verificationRouter.post(
  '/verify-email/details',
  leadRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        sellerId,
        signature,
        block,
        street,
        askingPrice,
        sellingTimeline,
        sellingReason,
        sellingReasonOther,
      } = req.body;

      if (!sellerId || !signature || !verifySellerId(sellerId, signature)) {
        throw new ValidationError('Invalid form submission');
      }

      if (!block?.trim() || !street?.trim()) {
        throw new ValidationError('Block and street are required');
      }

      // Derive town from HDB transaction data
      const info = await hdbService.getPropertyInfo(block.trim(), street.trim());
      const town = info?.town;
      if (!town || !HDB_TOWNS.includes(town as (typeof HDB_TOWNS)[number])) {
        throw new ValidationError(
          'Could not determine town from your address. Please check your block and street.',
        );
      }

      if (!VALID_TIMELINES.includes(sellingTimeline)) {
        throw new ValidationError('Please select a timeline');
      }

      if (!VALID_REASONS.includes(sellingReason)) {
        throw new ValidationError('Please select a reason');
      }

      const parsedPrice = askingPrice ? parseFloat(askingPrice) : undefined;
      if (askingPrice && (isNaN(parsedPrice!) || parsedPrice! < 0)) {
        throw new ValidationError('Please enter a valid asking price');
      }

      await verificationService.submitLeadDetails({
        sellerId,
        block: block.trim(),
        street: street.trim(),
        town,
        askingPrice: parsedPrice,
        sellingTimeline,
        sellingReason,
        sellingReasonOther: sellingReason === 'other' ? sellingReasonOther?.trim() : undefined,
      });

      res.render('pages/public/verify-email-success', {
        pageTitle: 'Submission Complete',
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.render('pages/public/verify-email-error', {
          pageTitle: 'Submission Error',
          message: err.message,
        });
      }
      next(err);
    }
  },
);

// POST /api/leads/resend-verification — seller-initiated resend
verificationRouter.post(
  '/api/leads/resend-verification',
  resendVerificationRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = req.body.email?.trim();
      if (!email) {
        throw new ValidationError('Email is required');
      }

      await verificationService.resendVerificationEmail(email);

      if (req.headers['hx-request']) {
        return res.send('<span class="text-green-600 text-xs">Verification email sent!</span>');
      }
      res.json({ success: true });
    } catch (err) {
      if (err instanceof ValidationError) {
        if (req.headers['hx-request']) {
          return res.send(`<span class="text-red-600 text-xs">${err.message}</span>`);
        }
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  },
);
