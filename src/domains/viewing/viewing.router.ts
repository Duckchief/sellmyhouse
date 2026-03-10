import { Router, Request, Response, NextFunction } from 'express';
import * as viewingService from './viewing.service';
import {
  validateCreateSlot,
  validateCreateBulkSlots,
  validateBookingForm,
  validateOtp,
  validateFeedback,
} from './viewing.validator';
import { requireAuth } from '@/infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import { BOOKING_ATTEMPTS_PER_IP_PER_HOUR } from './viewing.types';
import rateLimit from 'express-rate-limit';

export const viewingRouter = Router();

// ─── Rate limiter for public booking ─────────────────────
const bookingRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: BOOKING_ATTEMPTS_PER_IP_PER_HOUR,
  message: { error: 'Too many booking attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Seller Routes ───────────────────────────────────────

viewingRouter.get(
  '/seller/viewings',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const propertyId = req.query.propertyId as string;

      const dashboard = propertyId
        ? await viewingService.getSellerDashboard(propertyId, user.id)
        : { stats: null, slots: [] };

      const { stats, slots } = dashboard;

      if (req.headers['hx-request']) {
        return res.render('partials/seller/viewings-dashboard', { stats, slots, propertyId });
      }
      return res.json({ success: true, stats, slots });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/seller/viewings/slots',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;

      if (req.body.bulk === 'true' || req.body.bulk === true) {
        const input = validateCreateBulkSlots(req.body);
        const result = await viewingService.createBulkSlots(input, user.id);

        if (req.headers['hx-request']) {
          return res.render('partials/seller/slots-created', { count: result.count });
        }
        return res.status(201).json({ success: true, ...result });
      }

      const input = validateCreateSlot(req.body);
      const slot = await viewingService.createSlot(input, user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/slot-row', { slot });
      }
      return res.status(201).json({ success: true, slot });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.delete(
  '/seller/viewings/slots/:id',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await viewingService.cancelSlot(req.params.id as string, user.id);

      if (req.headers['hx-request']) {
        return res.send(''); // HTMX removes the element
      }
      return res.json({ success: true, message: 'Slot cancelled' });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/seller/viewings/:id/feedback',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const input = validateFeedback(req.body);
      await viewingService.submitFeedback(req.params.id as string, user.id, input);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/feedback-saved', { viewingId: req.params.id as string });
      }
      return res.json({ success: true, message: 'Feedback saved' });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/seller/viewings/:id/no-show',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await viewingService.markNoShow(req.params.id as string, user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/viewing-status', { viewingId: req.params.id as string, status: 'no_show' });
      }
      return res.json({ success: true, message: 'Marked as no-show' });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/seller/viewings/:id/complete',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await viewingService.markCompleted(req.params.id as string, user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/viewing-status', { viewingId: req.params.id as string, status: 'completed' });
      }
      return res.json({ success: true, message: 'Marked as completed' });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Public Routes ───────────────────────────────────────

viewingRouter.get(
  '/view/:propertySlug',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pageData = await viewingService.getPublicBookingPage(req.params.propertySlug as string);
      if (!pageData) return res.status(404).render('404');

      return res.render('public/viewing-booking', {
        property: pageData.property,
        slots: pageData.availableSlots,
        formLoadedAt: Date.now(),
      });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/view/:propertySlug/book',
  bookingRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = validateBookingForm(req.body);
      const result = await viewingService.initiateBooking(input, req.ip || '');

      if ('spam' in result) {
        // Return fake success to avoid giving bots feedback
        if (req.headers['hx-request']) {
          return res.render('partials/public/booking-success');
        }
        return res.json({ success: true, message: 'Booking submitted' });
      }

      if (result.status === 'pending_otp') {
        if (req.headers['hx-request']) {
          return res.render('partials/public/otp-form', { bookingId: result.viewingId, phone: input.phone });
        }
        return res.json({ success: true, requiresOtp: true, bookingId: result.viewingId });
      }

      // Returning viewer — booked immediately
      if (req.headers['hx-request']) {
        return res.render('partials/public/booking-success', { viewingId: result.viewingId });
      }
      return res.json({ success: true, viewingId: result.viewingId });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/view/:propertySlug/verify-otp',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = validateOtp(req.body);
      await viewingService.verifyOtp(input);

      if (req.headers['hx-request']) {
        return res.render('partials/public/booking-success', { bookingId: input.bookingId });
      }
      return res.json({ success: true, message: 'Booking confirmed' });
    } catch (err) {
      next(err);
    }
  },
);

// Cancel confirmation page (GET) and actual cancel (POST)
viewingRouter.get(
  '/view/cancel/:viewingId/:cancelToken',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const viewing = await viewingService.getViewingByCancelToken(req.params.cancelToken as string);
      if (!viewing) return res.status(404).render('404');

      return res.render('public/cancel-confirmation', {
        viewing,
        viewingId: req.params.viewingId as string,
        cancelToken: req.params.cancelToken as string,
      });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/view/cancel/:viewingId/:cancelToken',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await viewingService.cancelViewing(req.params.viewingId as string, req.params.cancelToken as string);

      return res.render('public/cancel-success');
    } catch (err) {
      next(err);
    }
  },
);
