import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as agentService from './agent.service';
import * as agentRepo from './agent.repository';
import * as caseFlagService from '@/domains/seller/case-flag.service';
import { validateSellerListQuery } from './agent.validator';
import { validateCreateCaseFlag, validateUpdateCaseFlag } from '@/domains/seller/case-flag.validator';
import { processCorrectionValidator } from '../compliance/compliance.validator';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { ValidationError } from '@/domains/shared/errors';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import type { SellerListFilter } from './agent.types';

export const agentRouter = Router();

const agentAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];

/** Helper: returns agentId for RBAC filtering, or undefined for admin (sees all) */
function getAgentFilter(user: AuthenticatedUser): string | undefined {
  return user.role === 'admin' ? undefined : user.id;
}

// GET /agent/dashboard — Pipeline overview
agentRouter.get(
  '/agent/dashboard',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const overview = await agentService.getPipelineOverview(getAgentFilter(user));

      if (req.headers['hx-request']) {
        return res.render('partials/agent/pipeline', { overview });
      }
      res.render('pages/agent/dashboard', { overview });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/leads — Lead queue
agentRouter.get(
  '/agent/leads',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const leads = await agentService.getLeadQueue(getAgentFilter(user));

      if (req.headers['hx-request']) {
        return res.render('partials/agent/lead-queue', { leads });
      }
      res.render('pages/agent/leads', { leads });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/sellers — Seller list with filters
agentRouter.get(
  '/agent/sellers',
  ...agentAuth,
  ...validateSellerListQuery,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const user = req.user as AuthenticatedUser;
      const filter: SellerListFilter = {
        status: req.query['status'] as SellerListFilter['status'],
        town: req.query['town'] as string | undefined,
        dateFrom: req.query['dateFrom'] as string | undefined,
        dateTo: req.query['dateTo'] as string | undefined,
        leadSource: req.query['leadSource'] as SellerListFilter['leadSource'],
        search: req.query['search'] as string | undefined,
        page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
        limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
      };

      const result = await agentService.getSellerList(filter, getAgentFilter(user));

      if (req.headers['hx-request']) {
        return res.render('partials/agent/seller-list', { result });
      }
      res.render('pages/agent/sellers', { result });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/sellers/:id — Seller detail
agentRouter.get(
  '/agent/sellers/:id',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const seller = await agentService.getSellerDetail(
        req.params['id'] as string,
        getAgentFilter(user),
      );

      if (req.headers['hx-request']) {
        return res.render('partials/agent/seller-overview', { seller });
      }
      res.render('pages/agent/seller-detail', { seller });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/sellers/:id/timeline — HTMX partial
agentRouter.get(
  '/agent/sellers/:id/timeline',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const seller = await agentService.getSellerDetail(
        req.params['id'] as string,
        getAgentFilter(user),
      );
      const milestones = agentService.getTimeline(seller.property?.status ?? null, null);

      res.render('partials/agent/seller-timeline', { milestones });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/sellers/:id/compliance — HTMX partial
agentRouter.get(
  '/agent/sellers/:id/compliance',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const compliance = await agentService.getComplianceStatus(
        req.params['id'] as string,
        getAgentFilter(user),
      );

      res.render('partials/agent/seller-compliance', { compliance });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/sellers/:id/notifications — HTMX partial
agentRouter.get(
  '/agent/sellers/:id/notifications',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const notifications = await agentService.getNotificationHistory(
        req.params['id'] as string,
        getAgentFilter(user),
      );

      res.render('partials/agent/seller-notifications', { notifications });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/corrections — Correction request review queue
agentRouter.get(
  '/agent/corrections',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requests = await agentRepo.getPendingCorrectionRequests();
      return res.render('pages/agent/correction-requests', {
        requests,
        title: 'Data Correction Requests',
      });
    } catch (err) {
      return next(err);
    }
  },
);

// POST /agent/corrections/:requestId — Approve or reject
agentRouter.post(
  '/agent/corrections/:requestId',
  ...agentAuth,
  processCorrectionValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const fields = Object.fromEntries(
        Object.entries(errors.mapped()).map(([k, v]) => [k, v.msg as string]),
      );
      return next(new ValidationError('Invalid request', fields));
    }

    try {
      const agentId = (req.user as { id: string }).id;
      const { requestId } = req.params as { requestId: string };
      const { decision, processNotes } = req.body as { decision: string; processNotes?: string };

      await agentService.processCorrectionRequest({
        requestId,
        agentId,
        decision: decision as 'approve' | 'reject',
        processNotes,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/correction-review-modal', {
          success: true,
          decision,
          requestId,
        });
      }

      return res.redirect('/agent/corrections');
    } catch (err) {
      return next(err);
    }
  },
);

// POST /agent/sellers/:id/case-flags — agent creates case flag
agentRouter.post(
  '/agent/sellers/:id/case-flags',
  ...agentAuth,
  ...validateCreateCaseFlag,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const flag = await caseFlagService.createCaseFlag({
        sellerId: req.params['id'] as string,
        flagType: req.body.flagType,
        description: req.body.description as string,
        agentId: user.id,
      });

      res.status(201).json({ flag });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /agent/sellers/:id/case-flags/:flagId — agent updates case flag
agentRouter.put(
  '/agent/sellers/:id/case-flags/:flagId',
  ...agentAuth,
  ...validateUpdateCaseFlag,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const flag = await caseFlagService.updateCaseFlag({
        flagId: req.params['flagId'] as string,
        status: req.body.status,
        guidanceProvided: req.body.guidanceProvided as string | undefined,
        agentId: user.id,
      });

      res.status(200).json({ flag });
    } catch (err) {
      next(err);
    }
  },
);
