// src/domains/admin/admin.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as adminService from './admin.service';
import { validateAgentCreate, validateSettingUpdate, validateAssign } from './admin.validator';
import {
  validateTutorialCreate,
  validateTutorialUpdate,
} from '@/domains/content/content.validator';
import * as contentService from '@/domains/content/content.service';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { NotFoundError, ConflictError } from '@/domains/shared/errors';
import { logger } from '@/infra/logger';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

export const adminRouter = Router();

const adminAuth = [requireAuth(), requireRole('admin'), requireTwoFactor()];

// ─── Dashboard (Analytics) ─────────────────────────────────────
adminRouter.get(
  '/admin/dashboard',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter = {
        dateFrom: req.query['dateFrom'] as string | undefined,
        dateTo: req.query['dateTo'] as string | undefined,
      };
      const analytics = await adminService.getAnalytics(filter);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/analytics', { analytics, filter });
      }
      res.render('pages/admin/dashboard', { analytics, filter, currentPath: '/admin/dashboard' });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Pipeline ────────────────────────────────────────────────
adminRouter.get(
  '/admin/pipeline',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stage = req.query['stage'] as string | undefined;
      const pipeline = await adminService.getAdminPipeline(stage);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/pipeline-table', { pipeline, stage });
      }
      res.render('pages/admin/pipeline', { pipeline, stage, currentPath: '/admin/pipeline' });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Leads ───────────────────────────────────────────────────
adminRouter.get(
  '/admin/leads',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined;
      const result = await adminService.getUnassignedLeads(page);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/lead-list', { result });
      }
      res.render('pages/admin/leads', { result, currentPath: '/admin/leads' });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Review Queue ────────────────────────────────────────────
adminRouter.get(
  '/admin/review',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await adminService.getReviewQueue();

      if (req.headers['hx-request']) {
        return res.render('partials/admin/review-list', { items });
      }
      res.render('pages/admin/review-queue', { items, currentPath: '/admin/review' });
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
      res.render('pages/admin/team', { team, currentPath: '/admin/team' });
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
      res.render('pages/admin/team-pipeline', { agent, currentPath: '/admin/team' });
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
      res.render('pages/admin/sellers', { result, team, currentPath: '/admin/sellers' });
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
      res.render('pages/admin/settings', { groups, currentPath: '/admin/settings' });
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
      res.render('pages/admin/hdb', { status, currentPath: '/admin/hdb' });
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
        currentPath: '/admin/compliance/deletion-queue',
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

// ─── Video Tutorial Management ───────────────────────────────────────────────

// IMPORTANT: /reorder must be registered before /:id routes to avoid
// "reorder" being matched as an id parameter.

adminRouter.post(
  '/admin/tutorials/reorder',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = req.body.items as Array<{ id: string; orderIndex: string }> | undefined;
      const items = (raw ?? []).map((item) => ({
        id: item.id,
        orderIndex: parseInt(item.orderIndex, 10),
      }));
      await contentService.reorderTutorials(items);
      if (req.headers['hx-request']) {
        return res.status(200).send('');
      }
      return res.redirect('/admin/tutorials');
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.get(
  '/admin/tutorials',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tutorials = await contentService.getTutorialsGrouped();
      if (req.headers['hx-request']) {
        return res.render('partials/admin/tutorial-list', { tutorials });
      }
      return res.render('pages/admin/tutorials', { tutorials, currentPath: '/admin/tutorials' });
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.get(
  '/admin/tutorials/new',
  ...adminAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      return res.render('pages/admin/tutorial-form', { tutorial: null, errors: [], currentPath: '/admin/tutorials' });
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.post(
  '/admin/tutorials',
  ...adminAuth,
  ...validateTutorialCreate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render('pages/admin/tutorial-form', {
          tutorial: null,
          errors: errors.array(),
          values: req.body,
          currentPath: '/admin/tutorials',
        });
      }
      await contentService.createTutorial({
        title: req.body.title as string,
        slug: req.body.slug as string | undefined,
        description: req.body.description as string | undefined,
        youtubeUrl: req.body.youtubeUrl as string,
        category: req.body.category as 'photography' | 'forms' | 'process' | 'financial',
        orderIndex: req.body.orderIndex !== undefined ? Number(req.body.orderIndex) : 0,
      });
      return res.redirect('/admin/tutorials');
    } catch (err) {
      if (err instanceof ConflictError) {
        return res.status(409).render('pages/admin/tutorial-form', {
          tutorial: null,
          errors: [{ msg: err.message }],
          values: req.body,
          currentPath: '/admin/tutorials',
        });
      }
      return next(err);
    }
  },
);

adminRouter.get(
  '/admin/tutorials/:id/edit',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tutorial = await contentService.getTutorialById(req.params['id'] as string);
      return res.render('pages/admin/tutorial-form', { tutorial, errors: [], currentPath: '/admin/tutorials' });
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.post(
  '/admin/tutorials/:id',
  ...adminAuth,
  ...validateTutorialUpdate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const tutorial = await contentService.getTutorialById(req.params['id'] as string);
        return res.status(400).render('pages/admin/tutorial-form', {
          tutorial,
          errors: errors.array(),
          values: req.body,
          currentPath: '/admin/tutorials',
        });
      }
      await contentService.updateTutorial(req.params['id'] as string, {
        title: req.body.title as string,
        slug: req.body.slug as string | undefined,
        description: req.body.description as string | undefined,
        youtubeUrl: req.body.youtubeUrl as string,
        category: req.body.category as 'photography' | 'forms' | 'process' | 'financial',
        orderIndex: req.body.orderIndex !== undefined ? Number(req.body.orderIndex) : undefined,
      });
      return res.redirect('/admin/tutorials');
    } catch (err) {
      if (err instanceof ConflictError) {
        return res.status(409).render('pages/admin/tutorial-form', {
          tutorial: { id: req.params['id'] as string },
          errors: [{ msg: err.message }],
          values: req.body,
          currentPath: '/admin/tutorials',
        });
      }
      return next(err);
    }
  },
);

adminRouter.post(
  '/admin/tutorials/:id/delete',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await contentService.deleteTutorial(req.params['id'] as string);
      return res.redirect('/admin/tutorials');
    } catch (err) {
      return next(err);
    }
  },
);

// ─── Market Content ───────────────────────────────────────────────────────────

// POST /run MUST be before /:id to avoid "run" being treated as an id param
adminRouter.post(
  '/admin/content/market/run',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const period = contentService.getIsoWeekPeriod();
      const result = await contentService.generateMarketContent(period);
      if (!result) {
        return res.redirect('/admin/content/market?notice=no_data');
      }
      return res.redirect('/admin/content/market');
    } catch (err) {
      if (err instanceof ConflictError) {
        logger.warn({ err }, 'Market content run blocked: duplicate period');
        const records = await contentService.listMarketContent();
        return res
          .status(409)
          .render('pages/admin/market-content', { records, error: err.message, currentPath: '/admin/content/market' });
      }
      return next(err);
    }
  },
);

adminRouter.get(
  '/admin/content/market',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await contentService.listMarketContent();
      const notice =
        req.query['notice'] === 'no_data' ? 'Insufficient HDB data for the current period.' : null;
      if (req.headers['hx-request']) {
        return res.render('partials/admin/market-content-list', { records });
      }
      return res.render('pages/admin/market-content', { records, error: notice, currentPath: '/admin/content/market' });
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.get(
  '/admin/content/market/:id',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await contentService.getMarketContentById(req.params['id'] as string);
      return res.render('pages/admin/market-content-detail', { record, currentPath: '/admin/content/market' });
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.post(
  '/admin/content/market/:id/approve',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await contentService.approveMarketContent(req.params['id'] as string, user.id);
      return res.redirect('/admin/content/market');
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.post(
  '/admin/content/market/:id/reject',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await contentService.rejectMarketContent(req.params['id'] as string);
      return res.redirect('/admin/content/market');
    } catch (err) {
      return next(err);
    }
  },
);

// ─── Testimonial Management ───────────────────────────────────────────────────

adminRouter.get(
  '/admin/content/testimonials',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await contentService.listTestimonials();
      if (req.headers['hx-request']) {
        return res.render('partials/admin/testimonial-list', { records });
      }
      return res.render('pages/admin/testimonials', { records, currentPath: '/admin/content/testimonials' });
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.post(
  '/admin/content/testimonials/:id/approve',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await contentService.approveTestimonial(req.params['id'] as string, user.id);
      return res.redirect('/admin/content/testimonials');
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.post(
  '/admin/content/testimonials/:id/reject',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await contentService.rejectTestimonial(req.params['id'] as string, user.id);
      return res.redirect('/admin/content/testimonials');
    } catch (err) {
      return next(err);
    }
  },
);

// ─── Referral Management ─────────────────────────────────────────────────────

adminRouter.get(
  '/admin/content/referrals',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [records, funnel, topReferrers] = await Promise.all([
        contentService.listReferrals(),
        contentService.getReferralFunnel(),
        contentService.getTopReferrers(),
      ]);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/referral-funnel', { funnel, topReferrers });
      }
      return res.render('pages/admin/referrals', { records, funnel, topReferrers, currentPath: '/admin/content/referrals' });
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.post(
  '/admin/content/testimonials/:id/feature',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const display = req.body.displayOnWebsite === 'true';
      await contentService.featureTestimonial(req.params['id'] as string, display);
      return res.redirect('/admin/content/testimonials');
    } catch (err) {
      return next(err);
    }
  },
);
