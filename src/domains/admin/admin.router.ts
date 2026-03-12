// src/domains/admin/admin.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as adminService from './admin.service';
import { validateAgentCreate, validateSettingUpdate, validateAssign } from './admin.validator';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { NotFoundError } from '@/domains/shared/errors';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

export const adminRouter = Router();

const adminAuth = [requireAuth(), requireRole('admin'), requireTwoFactor()];

// ─── Dashboard ───────────────────────────────────────────────

adminRouter.get(
  '/admin/dashboard',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const team = await adminService.getTeam();
      res.render('pages/admin/dashboard', { team });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Team Management ─────────────────────────────────────────

adminRouter.get(
  '/admin/team',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const team = await adminService.getTeam();
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-list', { team });
      }
      res.render('pages/admin/team', { team });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/team',
  ...adminAuth,
  ...validateAgentCreate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const user = req.user as AuthenticatedUser;
      const agent = await adminService.createAgent(
        {
          name: req.body.name as string,
          email: req.body.email as string,
          phone: req.body.phone as string,
          ceaRegNo: req.body.ceaRegNo as string,
        },
        user.id,
      );
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: `Agent ${agent.name} created. Credentials sent to ${agent.email}.`,
          type: 'success',
        });
      }
      res.redirect('/admin/team');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/team/:id/deactivate',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await adminService.deactivateAgent(req.params['id'] as string, user.id);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: 'Agent deactivated.',
          type: 'success',
        });
      }
      res.redirect('/admin/team');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/team/:id/reactivate',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await adminService.reactivateAgent(req.params['id'] as string, user.id);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: 'Agent reactivated.',
          type: 'success',
        });
      }
      res.redirect('/admin/team');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/team/:id/anonymise',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await adminService.anonymiseAgent(req.params['id'] as string, user.id);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: 'Agent anonymised. This action is irreversible.',
          type: 'success',
        });
      }
      res.redirect('/admin/team');
    } catch (err) {
      next(err);
    }
  },
);

// GET route for loading the anonymise confirmation modal
adminRouter.get(
  '/admin/team/:id/anonymise-confirm',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.render('partials/admin/anonymise-confirm', { agentId: req.params['id'] });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get(
  '/admin/team/:id/pipeline',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const team = await adminService.getTeam();
      const agent = team.find((a) => a.id === req.params['id']);
      if (!agent) throw new NotFoundError('Agent', req.params['id'] as string);
      res.render('pages/admin/team-pipeline', { agent });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Sellers ─────────────────────────────────────────────────

adminRouter.get(
  '/admin/sellers',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter = {
        agentId: req.query['agentId'] as string | undefined,
        status: req.query['status'] as string | undefined,
        search: req.query['search'] as string | undefined,
        page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
        limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
      };
      const [result, team] = await Promise.all([
        adminService.getAllSellers(filter),
        adminService.getTeam(),
      ]);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/seller-list', { result, team });
      }
      res.render('pages/admin/sellers', { result, team });
    } catch (err) {
      next(err);
    }
  },
);

// GET route for loading the assign/reassign modal
adminRouter.get(
  '/admin/sellers/:id/assign-modal',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const team = await adminService.getTeam();
      const sellers = await adminService.getAllSellers({});
      const seller = sellers.sellers.find((s) => s.id === req.params['id']);
      const isReassign = seller?.agent != null;
      res.render('partials/admin/assign-modal', {
        sellerId: req.params['id'],
        team,
        isReassign,
      });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/sellers/:id/assign',
  ...adminAuth,
  ...validateAssign,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const user = req.user as AuthenticatedUser;
      await adminService.assignSeller(
        req.params['id'] as string,
        req.body.agentId as string,
        user.id,
      );
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: 'Lead assigned.',
          type: 'success',
        });
      }
      res.redirect('/admin/sellers');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/sellers/:id/reassign',
  ...adminAuth,
  ...validateAssign,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const user = req.user as AuthenticatedUser;
      await adminService.reassignSeller(
        req.params['id'] as string,
        req.body.agentId as string,
        user.id,
      );
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: 'Seller reassigned.',
          type: 'success',
        });
      }
      res.redirect('/admin/sellers');
    } catch (err) {
      next(err);
    }
  },
);

// ─── Settings ────────────────────────────────────────────────

adminRouter.get(
  '/admin/settings',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const groups = await adminService.getSettingsGrouped();
      if (req.headers['hx-request']) {
        return res.render('partials/admin/settings-form', { groups });
      }
      res.render('pages/admin/settings', { groups });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/settings/:key',
  ...adminAuth,
  ...validateSettingUpdate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.headers['hx-request']) {
          return res.render('partials/admin/settings-result', {
            message: errors.array()[0]?.msg,
            type: 'error',
          });
        }
        return res.status(400).json({ errors: errors.array() });
      }
      const user = req.user as AuthenticatedUser;
      await adminService.updateSetting(
        req.params['key'] as string,
        req.body.value as string,
        user.id,
      );
      if (req.headers['hx-request']) {
        return res.render('partials/admin/settings-result', {
          message: 'Setting saved.',
          type: 'success',
        });
      }
      res.redirect('/admin/settings');
    } catch (err) {
      next(err);
    }
  },
);

// ─── HDB Management ──────────────────────────────────────────

adminRouter.get(
  '/admin/hdb',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await adminService.getHdbStatus();
      if (req.headers['hx-request']) {
        return res.render('partials/admin/hdb-status', { status });
      }
      res.render('pages/admin/hdb', { status });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/hdb/sync',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await adminService.triggerHdbSync(user.id);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: 'HDB sync triggered. Data will update shortly.',
          type: 'success',
        });
      }
      res.redirect('/admin/hdb');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/hdb/upload',
  ...adminAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      // CSV upload stubbed for SP3 — full implementation in a future sprint
      res.redirect('/admin/hdb');
    } catch (err) {
      next(err);
    }
  },
);

// ─── Compliance ───────────────────────────────────────────────

// GET /admin/compliance/deletion-queue
adminRouter.get(
  '/admin/compliance/deletion-queue',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requests = await adminService.getDeletionQueue();

      if (req.headers['hx-request']) {
        return res.render('partials/admin/compliance/deletion-queue-list', { requests });
      }

      return res.render('pages/admin/compliance/deletion-queue', {
        requests,
        title: 'Data Deletion Queue',
      });
    } catch (err) {
      return next(err);
    }
  },
);

// POST /admin/compliance/deletion-queue/:requestId/approve
adminRouter.post(
  '/admin/compliance/deletion-queue/:requestId/approve',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { requestId } = req.params;
      const { reviewNotes } = req.body as { reviewNotes?: string };

      await adminService.approveDeletion(requestId as string, user.id, reviewNotes);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/compliance/deletion-row', {
          executed: true,
          requestId,
        });
      }

      return res.redirect('/admin/compliance/deletion-queue');
    } catch (err) {
      return next(err);
    }
  },
);

// POST /admin/agents/:agentId/anonymise
adminRouter.post(
  '/admin/agents/:agentId/anonymise',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { agentId } = req.params;

      await adminService.anonymiseAgentOnDeparture(agentId as string, user.id);

      if (req.headers['hx-request']) {
        return res.json({ success: true });
      }

      return res.redirect('/admin/team');
    } catch (err) {
      return next(err);
    }
  },
);
