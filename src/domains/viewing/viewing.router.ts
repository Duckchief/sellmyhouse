import { Router, Request, Response, NextFunction } from 'express';
import * as viewingService from './viewing.service';
import * as propertyService from '@/domains/property/property.service';
import {
  validateCreateSlot,
  validateCreateBulkSlots,
  validateScheduleDays,
  validateBookingForm,
  validateOtp,
  validateFeedback,
} from './viewing.validator';
import { requireAuth, requireRole } from '@/infra/http/middleware/require-auth';
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

// ─── Rate limiter for OTP verification ───────────────────
// 10 attempts per 15 minutes per IP — prevents brute-force of 6-digit codes
const otpVerifyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many verification attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => process.env.NODE_ENV === 'test',
});

// ─── Seller Routes ───────────────────────────────────────

viewingRouter.get(
  '/seller/viewings',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      let propertyId = req.query.propertyId as string | undefined;

      // Auto-resolve property from seller when not provided
      if (!propertyId) {
        const property = await propertyService.getPropertyForSeller(user.id);
        propertyId = (property as { id: string } | null)?.id;
      }

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const pageSize = 20;

      const dashboard = propertyId
        ? await viewingService.getSellerDashboard(propertyId, user.id, page, pageSize)
        : { stats: null, slots: [], totalSlots: 0, page: 1, pageSize, slotsByDate: {} };

      const { stats, slots, totalSlots, slotsByDate } = dashboard;
      const hasMore = page * pageSize < (totalSlots ?? 0);

      const recurringSchedule = propertyId
        ? await viewingService.getRecurringSchedule(propertyId)
        : null;

      // HTMX "load more" request — return just the slot rows + next button
      if (req.headers['hx-request'] && page > 1) {
        return res.render('partials/seller/slots-page', {
          slots,
          propertyId,
          page,
          hasMore,
        });
      }

      if (req.headers['hx-request']) {
        return res.render('partials/seller/viewings-dashboard', {
          stats,
          slots,
          propertyId,
          slotsByDate,
          page,
          hasMore,
          totalSlots,
          recurringSchedule,
        });
      }

      return res.render('pages/seller/viewings', {
        stats,
        slots,
        propertyId,
        slotsByDate,
        page,
        hasMore,
        totalSlots,
        recurringSchedule,
      });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.get(
  '/seller/viewings/slots/date-sidebar',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const date = req.query.date as string;
      const propertyId = req.query.propertyId as string;

      if (!date || !propertyId) {
        return res.status(400).json({ error: 'date and propertyId are required' });
      }

      const data = await viewingService.getSlotsForDate(propertyId, date, user.id);
      return res.render('partials/seller/viewing-date-sidebar', { ...data, propertyId });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.get(
  '/seller/viewings/slots/month-meta',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const monthStr = req.query.month as string;
      const propertyId = req.query.propertyId as string;

      if (!propertyId || !monthStr) {
        return res.status(400).json({ error: 'month and propertyId are required' });
      }

      const match = monthStr.match(/^(\d{4})-(\d{2})$/);
      if (!match) {
        return res.status(400).json({ error: 'month must be YYYY-MM format' });
      }

      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const meta = await viewingService.getMonthSlotMeta(propertyId, year, month, user.id);
      return res.json(meta);
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/seller/viewings/slots/bulk-delete',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const slotIds = req.body.slotIds as string[];

      if (!Array.isArray(slotIds) || slotIds.length === 0) {
        return res.status(400).json({ error: 'slotIds array is required' });
      }

      if (!slotIds.every((id) => typeof id === 'string' && id.length > 0)) {
        return res.status(400).json({ error: 'slotIds must be an array of non-empty strings' });
      }

      const result = await viewingService.bulkCancelSlots(slotIds, user.id);

      if (req.headers['hx-request']) {
        return res.json({ success: true, cancelled: result.cancelled });
      }
      return res.json({ success: true, cancelled: result.cancelled });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/seller/viewings/schedule',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const days = validateScheduleDays(req.body.days);
      const schedule = await viewingService.saveSchedule(days, user.id);
      return res.status(200).json({ success: true, schedule });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.delete(
  '/seller/viewings/schedule',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await viewingService.deleteSchedule(user.id);
      return res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/seller/viewings/slots',
  requireAuth(),
  requireRole('seller'),
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
  requireRole('seller'),
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
  requireRole('seller'),
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
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await viewingService.markNoShow(req.params.id as string, user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/viewing-status', {
          viewingId: req.params.id as string,
          status: 'no_show',
        });
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
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await viewingService.markCompleted(req.params.id as string, user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/viewing-status', {
          viewingId: req.params.id as string,
          status: 'completed',
        });
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
      const result = await viewingService.initiateBooking(input, {
        ipAddress: req.ip || undefined,
        userAgent: req.headers['user-agent'] ?? undefined,
      });

      if ('spam' in result) {
        // Return fake success to avoid giving bots feedback
        if (req.headers['hx-request']) {
          return res.render('partials/public/booking-success');
        }
        return res.json({ success: true, message: 'Booking submitted' });
      }

      if (result.status === 'pending_otp') {
        if (req.headers['hx-request']) {
          return res.render('partials/public/otp-form', {
            bookingId: result.viewingId,
            phone: input.phone,
            verifyUrl: `/view/${req.params.propertySlug}/verify-otp`,
          });
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
  otpVerifyRateLimiter,
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
      const viewing = await viewingService.getViewingByCancelToken(
        req.params.cancelToken as string,
      );
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
      await viewingService.cancelViewing(
        req.params.viewingId as string,
        req.params.cancelToken as string,
      );

      return res.render('public/cancel-success');
    } catch (err) {
      next(err);
    }
  },
);
