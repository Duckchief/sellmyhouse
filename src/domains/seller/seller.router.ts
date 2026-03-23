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
import * as accountDeleteService from './account-delete.service';
import * as complianceService from '../compliance/compliance.service';
import * as complianceRepo from '../compliance/compliance.repository';
import { UnauthorizedError, ValidationError } from '../shared/errors';
import * as settingsService from '../shared/settings.service';
import { HdbService } from '../hdb/service';

export const sellerRouter = Router();
const hdbService = new HdbService();

const sellerAuth = [requireAuth(), requireRole('seller')];

// Middleware: inject currentPath and unreadCount for all seller routes
sellerRouter.use(
  '/seller',
  ...sellerAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.currentPath = req.path === '/' ? '/seller/dashboard' : `/seller${req.path}`;
      const user = req.user as AuthenticatedUser;
      res.locals.user = user;
      res.locals.hasAvatar = false;
      const [unreadCount, onboardingStatus] = await Promise.all([
        notificationService.countUnreadNotifications('seller', user.id),
        sellerService.getOnboardingStatus(user.id),
      ]);
      res.locals.unreadCount = unreadCount;
      res.locals.onboardingComplete = onboardingStatus.isComplete;
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
    const milestones = sellerService.getTimelineMilestones(timelineInput, 'seller');

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
          flatTypes: HDB_FLAT_TYPES,
        });
      }

      if (stepNum === 3) {
        const commission = await settingsService.getCommission();
        const saleProceeds = await sellerService.getSaleProceeds(sellerId);
        const property = await propertyService.getPropertyForSeller(sellerId);
        return res.render('partials/seller/onboarding-step-3', {
          commission,
          saleProceeds,
          askingPrice: property?.askingPrice ? Number(property.askingPrice) : null,
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
          street,
          block,
          flatType,
          level,
          unitNumber,
          floorAreaSqm,
          leaseCommenceDate,
        } = req.body;

        if (
          !street ||
          !block ||
          !flatType ||
          !level ||
          !unitNumber ||
          !floorAreaSqm ||
          !leaseCommenceDate
        ) {
          return res.status(400).render('partials/seller/onboarding-step-2', {
            flatTypes: HDB_FLAT_TYPES,
            error: 'All property fields are required.',
          });
        }

        // Derive town from HDB data; fall back to form hidden field
        let town = req.body.town?.trim();
        if (!town) {
          const info = await hdbService.getPropertyInfo(block, street);
          town = info?.town;
        }
        if (!town || !HDB_TOWNS.includes(town)) {
          return res.status(400).render('partials/seller/onboarding-step-2', {
            flatTypes: HDB_FLAT_TYPES,
            error: 'Could not determine town from your address. Please check your block and street.',
          });
        }

        const existing = await propertyService.getPropertyForSeller(sellerId);
        if (existing) {
          await propertyService.updateProperty(existing.id, sellerId, {
            town,
            street,
            block,
            flatType,
            level,
            unitNumber,
            floorAreaSqm: parseFloat(floorAreaSqm),
            leaseCommenceDate: parseInt(leaseCommenceDate, 10),
          });
        } else {
          await propertyService.createProperty({
            sellerId,
            town,
            street,
            block,
            flatType,
            level,
            unitNumber,
            floorAreaSqm: parseFloat(floorAreaSqm),
            leaseCommenceDate: parseInt(leaseCommenceDate, 10),
          });
        }
      }

      if (step === 3) {
        const {
          sellingPrice,
          outstandingLoan,
          cpfSeller1,
          cpfSeller2,
          cpfSeller3,
          cpfSeller4,
          resaleLevy,
          otherDeductions,
        } = req.body;

        if (!sellingPrice || !outstandingLoan || !cpfSeller1) {
          const commission = await settingsService.getCommission();
          return res.status(400).render('partials/seller/onboarding-step-3', {
            error: 'Selling price, outstanding loan, and CPF (Seller 1) are required.',
            commission,
          });
        }

        const commission = await settingsService.getCommission();

        await sellerService.saveSaleProceeds({
          sellerId,
          sellingPrice: parseFloat(sellingPrice),
          outstandingLoan: parseFloat(outstandingLoan),
          cpfSeller1: parseFloat(cpfSeller1),
          cpfSeller2: cpfSeller2 ? parseFloat(cpfSeller2) : undefined,
          cpfSeller3: cpfSeller3 ? parseFloat(cpfSeller3) : undefined,
          cpfSeller4: cpfSeller4 ? parseFloat(cpfSeller4) : undefined,
          resaleLevy: parseFloat(resaleLevy || '0'),
          otherDeductions: parseFloat(otherDeductions || '0'),
          commission: commission.total,
        });
      }

      if (step === 4) {
        const { marketingConsent } = req.body as { marketingConsent?: string };
        if (marketingConsent === 'on') {
          await complianceService.grantMarketingConsent({
            sellerId,
            channel: 'web',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] as string | undefined,
          });
        }
      }

      if (step === 5) {
        await complianceService.recordHuttonsTransferConsent(sellerId);
      }

      // Only advance onboarding if this is the next expected step;
      // if the user went back and re-submitted a completed step, just save data and show next step
      const status = await sellerService.getOnboardingStatus(sellerId);
      if (step === status.currentStep + 1) {
        await sellerService.completeOnboardingStep({ sellerId, step });
      }

      // Only redirect to dashboard when completing the final step
      if (step === TOTAL_ONBOARDING_STEPS) {
        if (req.headers['hx-request']) {
          res.set('HX-Redirect', '/seller/dashboard');
          return res.sendStatus(200);
        }
        return res.redirect('/seller/dashboard');
      }

      const nextStep = step + 1;
      if (req.headers['hx-request']) {
        const stepData: Record<string, unknown> = { currentStep: nextStep };
        if (nextStep === 2) {
          stepData['flatTypes'] = HDB_FLAT_TYPES;
        }
        if (nextStep === 3) {
          const commission = await settingsService.getCommission();
          const property = await propertyService.getPropertyForSeller(sellerId);
          stepData['commission'] = commission;
          stepData['askingPrice'] = property?.askingPrice ? Number(property.askingPrice) : null;
        }
        return res.render(`partials/seller/onboarding-step-${nextStep}`, stepData);
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
    res.render('pages/seller/my-data', {
      myData,
      consentService: myData.consentStatus.service,
      consentMarketing: myData.consentStatus.marketing,
      consentHistory: myData.consentHistory,
    });
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
    const [settings, consent] = await Promise.all([
      sellerService.getSellerSettings(user.id),
      complianceRepo.findSellerConsent(user.id),
    ]);

    if (req.headers['hx-request']) {
      return res.render('partials/seller/settings-notifications', { settings });
    }
    res.render('pages/seller/settings', {
      settings,
      consentMarketing: consent?.consentMarketing ?? false,
    });
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

// GET /seller/account/delete — confirmation page
sellerRouter.get('/seller/account/delete', (req: Request, res: Response) => {
  res.render('pages/seller/account-delete-confirm');
});

// POST /seller/account/delete — process deletion
sellerRouter.post(
  '/seller/account/delete',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { confirm, password } = req.body as { confirm?: string; password?: string };
      const user = req.user as AuthenticatedUser;

      if (!password?.trim()) {
        return res.status(400).render('pages/seller/account-delete-confirm', {
          error: 'Password is required',
        });
      }
      if (confirm !== 'true') {
        return res.status(400).render('pages/seller/account-delete-confirm', {
          error: 'You must confirm that you understand this action cannot be undone',
        });
      }

      await accountDeleteService.deleteSellerAccount(user.id, password);

      // Destroy session AFTER deletion is audited — redirect to homepage
      req.logout(() => {
        req.session?.destroy(() => {
          res.redirect('/?account_deleted=1');
        });
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return res.status(400).render('pages/seller/account-delete-confirm', {
          error: err.message,
        });
      }
      next(err);
    }
  },
);
