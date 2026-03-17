import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import * as sellerService from './seller.service';
import * as caseFlagService from './case-flag.service';
import { validateOnboardingStep } from './seller.validator';
import { TOTAL_ONBOARDING_STEPS } from './seller.types';
import type { TimelineInput } from './seller.types';
import type { PropertyStatus, TransactionStatus, HdbApplicationStatus } from '@prisma/client';
import { requireAuth, requireRole } from '@/infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import * as propertyService from '../property/property.service';
import { HDB_TOWNS, HDB_FLAT_TYPES } from '../property/property.types';
import * as contentService from '../content/content.service';
import * as notificationService from '../notification/notification.service';

export const sellerRouter = Router();

const sellerAuth = [requireAuth(), requireRole('seller')];

// Middleware: inject currentPath and unreadCount for all seller routes
sellerRouter.use(
  '/seller',
  ...sellerAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.currentPath = req.path === '/' ? '/seller/dashboard' : `/seller${req.path}`;
      const user = req.user as AuthenticatedUser;
      res.locals.unreadCount = await notificationService.countUnreadNotifications(
        'seller',
        user.id,
      );
      next();
    } catch (err) {
      next(err);
    }
  },
);

// Dashboard overview
sellerRouter.get('/seller/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    const overview = await sellerService.getDashboardOverview(user.id);

    if (!overview.onboarding.isComplete) {
      return res.redirect('/seller/onboarding');
    }

    const timelineInput: TimelineInput = {
      sellerCddRecord: null,
      eaa: null,
      property: overview.propertyStatus
        ? { status: overview.propertyStatus as PropertyStatus, listedAt: null }
        : null,
      firstViewingAt: null,
      acceptedOffer: null,
      counterpartyCddRecord: null,
      isCoBroke: false,
      otp: null,
      transaction: overview.transactionStatus
        ? {
            status: overview.transactionStatus as TransactionStatus,
            hdbApplicationStatus: 'not_started' as HdbApplicationStatus,
            hdbAppSubmittedAt: null,
            hdbAppApprovedAt: null,
            hdbAppointmentDate: null,
            completionDate: null,
          }
        : null,
    };
    const milestones = sellerService.getTimelineMilestones(timelineInput, 'agent');

    if (req.headers['hx-request']) {
      return res.render('partials/seller/dashboard-overview', { overview, milestones });
    }
    res.render('pages/seller/dashboard', { overview, milestones });
  } catch (err) {
    next(err);
  }
});

// Dashboard stats partial (HTMX auto-refresh)
sellerRouter.get(
  '/seller/dashboard/stats',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const stats = await sellerService.getDashboardStats(user.id);
      res.render('partials/seller/dashboard-stats', { stats });
    } catch (err) {
      next(err);
    }
  },
);

// Onboarding wizard
sellerRouter.get('/seller/onboarding', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    const status = await sellerService.getOnboardingStatus(user.id);

    if (status.isComplete) {
      return res.redirect('/seller/dashboard');
    }

    res.render('pages/seller/onboarding', { status });
  } catch (err) {
    next(err);
  }
});

// Onboarding step partial (HTMX)
sellerRouter.get(
  '/seller/onboarding/step/:step',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const sellerId = user.id;
      const stepNum = parseInt(req.params['step'] as string, 10);
      if (stepNum < 1 || stepNum > TOTAL_ONBOARDING_STEPS) {
        return res.status(400).render('partials/error-message', {
          message: `Invalid step: ${stepNum}`,
        });
      }

      if (stepNum === 2) {
        const onboarding = await sellerService.getOnboardingStatus(sellerId);
        const property = await propertyService.getPropertyForSeller(sellerId);
        return res.render('partials/seller/onboarding-step-2', {
          status: onboarding,
          property,
          towns: HDB_TOWNS,
          flatTypes: HDB_FLAT_TYPES,
        });
      }

      res.render(`partials/seller/onboarding-step-${stepNum}`);
    } catch (err) {
      next(err);
    }
  },
);

// Complete onboarding step
sellerRouter.post(
  '/seller/onboarding/step/:step',
  ...validateOnboardingStep,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render('partials/error-message', {
          message: Object.values(errors.mapped())[0].msg,
        });
      }

      const user = req.user as AuthenticatedUser;
      const sellerId = user.id;
      const step = parseInt(req.params['step'] as string, 10);

      if (step === 2) {
        const {
          town,
          street,
          block,
          flatType,
          storeyRange,
          floorAreaSqm,
          flatModel,
          leaseCommenceDate,
        } = req.body;

        if (
          !town ||
          !street ||
          !block ||
          !flatType ||
          !storeyRange ||
          !floorAreaSqm ||
          !flatModel ||
          !leaseCommenceDate
        ) {
          return res.status(400).render('partials/seller/onboarding-step-2', {
            towns: HDB_TOWNS,
            flatTypes: HDB_FLAT_TYPES,
            error: 'All property fields are required.',
          });
        }

        const existing = await propertyService.getPropertyForSeller(sellerId);
        if (existing) {
          await propertyService.updateProperty(existing.id, sellerId, {
            town,
            street,
            block,
            flatType,
            storeyRange,
            floorAreaSqm: parseFloat(floorAreaSqm),
            flatModel,
            leaseCommenceDate: parseInt(leaseCommenceDate, 10),
          });
        } else {
          await propertyService.createProperty({
            sellerId,
            town,
            street,
            block,
            flatType,
            storeyRange,
            floorAreaSqm: parseFloat(floorAreaSqm),
            flatModel,
            leaseCommenceDate: parseInt(leaseCommenceDate, 10),
          });
        }
      }

      const result = await sellerService.completeOnboardingStep({
        sellerId,
        step,
      });

      if (result.onboardingStep >= TOTAL_ONBOARDING_STEPS) {
        if (req.headers['hx-request']) {
          res.set('HX-Redirect', '/seller/dashboard');
          return res.sendStatus(200);
        }
        return res.redirect('/seller/dashboard');
      }

      const nextStep = step + 1;
      if (req.headers['hx-request']) {
        return res.render(`partials/seller/onboarding-step-${nextStep}`, {
          currentStep: nextStep,
        });
      }
      res.redirect('/seller/onboarding');
    } catch (err) {
      next(err);
    }
  },
);

// Notification feed
sellerRouter.get(
  '/seller/notifications',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const notifications = await notificationService.getUnreadNotifications('seller', user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/notification-list', { notifications });
      }
      res.render('pages/seller/notifications', { notifications });
    } catch (err) {
      next(err);
    }
  },
);

// Testimonial removal (PDPA request)
sellerRouter.post(
  '/seller/testimonial/remove',
  ...sellerAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await contentService.removeTestimonial(user.id);
      return res.redirect('/seller/my-data');
    } catch (err) {
      next(err);
    }
  },
);

// My Data (PDPA)
sellerRouter.get('/seller/my-data', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    const myData = await sellerService.getMyData(user.id);

    if (req.headers['hx-request']) {
      return res.render('partials/seller/my-data-content', { myData });
    }
    res.render('pages/seller/my-data', { myData });
  } catch (err) {
    next(err);
  }
});

// Document checklist
sellerRouter.get('/seller/documents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    const overview = await sellerService.getDashboardOverview(user.id);
    const checklist = sellerService.getDocumentChecklist(overview.propertyStatus);

    if (req.headers['hx-request']) {
      return res.render('partials/seller/document-checklist', { checklist });
    }
    res.render('pages/seller/documents', { checklist });
  } catch (err) {
    next(err);
  }
});

// Video tutorials
sellerRouter.get('/seller/tutorials', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const grouped = await sellerService.getTutorialsGrouped();

    if (req.headers['hx-request']) {
      return res.render('partials/seller/tutorials-content', { grouped });
    }
    res.render('pages/seller/tutorials', { grouped });
  } catch (err) {
    next(err);
  }
});

// GET /seller/settings — settings page
sellerRouter.get('/seller/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    const settings = await sellerService.getSellerSettings(user.id);

    if (req.headers['hx-request']) {
      return res.render('partials/seller/settings-notifications', { settings });
    }
    res.render('pages/seller/settings', { settings });
  } catch (err) {
    next(err);
  }
});

// PUT /seller/settings/notifications — update notification preference
const validateNotificationPreference = [
  body('preference')
    .isIn(['whatsapp_and_email', 'email_only'])
    .withMessage('preference must be whatsapp_and_email or email_only'),
];

sellerRouter.put(
  '/seller/settings/notifications',
  ...validateNotificationPreference,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const updated = await sellerService.updateNotificationPreference({
        sellerId: user.id,
        preference: req.body.preference as 'whatsapp_and_email' | 'email_only',
      });

      if (req.headers['hx-request']) {
        return res.render('partials/seller/settings-notifications', {
          settings: updated,
          successMessage: true,
        });
      }
      res.redirect('/seller/settings');
    } catch (err) {
      next(err);
    }
  },
);

// Case flags — view special circumstances and guidance
sellerRouter.get('/seller/case-flags', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    const flags = await caseFlagService.getCaseFlagsForSeller(user.id);
    const flagsWithChecklist = flags.map((flag) => ({
      ...flag,
      checklist: caseFlagService.getChecklistForType(flag.flagType),
    }));

    if (req.headers['hx-request']) {
      return res.render('partials/seller/case-flags-content', { flags: flagsWithChecklist });
    }
    res.render('pages/seller/case-flags', { flags: flagsWithChecklist });
  } catch (err) {
    next(err);
  }
});

// Referral programme
sellerRouter.get(
  '/seller/referral',
  ...sellerAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const referral = await contentService.sendReferralLinks(user.id);
      if (req.headers['hx-request']) {
        return res.render('partials/seller/referral-content', { referral });
      }
      return res.render('pages/seller/referral', { referral });
    } catch (err) {
      next(err);
    }
  },
);
