import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as sellerService from './seller.service';
import { validateOnboardingStep } from './seller.validator';
import { TOTAL_ONBOARDING_STEPS } from './seller.types';
import { requireAuth, requireRole } from '@/infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

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
      const notificationRepo = await import('../notification/notification.repository');
      res.locals.unreadCount = await notificationRepo.countUnreadForRecipient('seller', user.id);
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

    const milestones = sellerService.getTimelineMilestones(
      overview.propertyStatus,
      overview.transactionStatus,
    );

    if (req.headers['hx-request']) {
      return res.render('partials/seller/dashboard-overview', { overview, milestones });
    }
    res.render('pages/seller/dashboard', { overview, milestones });
  } catch (err) {
    next(err);
  }
});

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
      const step = parseInt(req.params['step'] as string, 10);
      if (step < 1 || step > TOTAL_ONBOARDING_STEPS) {
        return res.status(400).render('partials/error-message', {
          message: `Invalid step: ${step}`,
        });
      }
      res.render(`partials/seller/onboarding-step-${step}`);
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
      const step = parseInt(req.params['step'] as string, 10);

      const result = await sellerService.completeOnboardingStep({
        sellerId: user.id,
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
      const notificationRepo = await import('../notification/notification.repository');
      const notifications = await notificationRepo.findUnreadForRecipient('seller', user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/notification-list', { notifications });
      }
      res.render('pages/seller/notifications', { notifications });
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
