// src/domains/admin/admin.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as adminService from './admin.service';
import { validateAgentCreate, validateSettingUpdate, validateAssign } from './admin.validator';
import {
  validateTutorialCreate,
  validateTutorialUpdate,
  validateManualTestimonialCreate,
} from '@/domains/content/content.validator';
import * as contentService from '@/domains/content/content.service';
import * as reviewService from '@/domains/review/review.service';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { NotFoundError, ConflictError } from '@/domains/shared/errors';
import { logger } from '@/infra/logger';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import { getHasAvatar } from '../profile/profile.service';

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
        preset: req.query['preset'] as string | undefined,
      };
      const analytics = await adminService.getAnalytics(filter);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/analytics', { analytics, filter });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/dashboard', { pageTitle: 'Dashboard', user, hasAvatar, analytics, filter, currentPath: '/admin/dashboard' });
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
      const [pipeline, stageCounts] = await Promise.all([
        adminService.getAdminPipeline(stage),
        adminService.getAdminPipelineCounts(),
      ]);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/pipeline-table', { pipeline, stage });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/pipeline', {
        pageTitle: 'Pipeline',
        user,
        hasAvatar,
        pipeline,
        stageCounts,
        stage,
        currentPath: '/admin/pipeline',
      });
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
      const { unassigned, all } = await adminService.getAdminLeadQueue(page);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/lead-list', { unassigned, all });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/leads', { pageTitle: 'Leads', user, hasAvatar, unassigned, all, currentPath: '/admin/leads' });
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
      const queue = await reviewService.getPendingQueue();
      const activeTab = (req.query.tab as string) || 'all';

      if (req.headers['hx-request']) {
        return res.render('partials/agent/review-queue', { queue, activeTab });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/review-queue', { pageTitle: 'Review Queue', user, hasAvatar, queue, activeTab, currentPath: '/admin/review' });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Audit Log ──────────────────────────────────────────────
// Export route MUST come before /admin/audit to avoid path matching issues
adminRouter.get(
  '/admin/audit/export',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const filter = {
        action: req.query['action'] as string | undefined,
        entityType: req.query['entityType'] as string | undefined,
        dateFrom: req.query['dateFrom'] ? new Date(req.query['dateFrom'] as string) : undefined,
        dateTo: req.query['dateTo'] ? new Date(req.query['dateTo'] as string) : undefined,
      };
      const entries = await adminService.exportAuditLogCsv(filter, user.id);

      const today = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-log-${today}.csv"`);

      res.write('Timestamp,Action,Entity Type,Entity ID,Agent ID,IP Address,Details\n');

      for (const entry of entries) {
        const details = JSON.stringify(entry.details ?? {}).replace(/"/g, '""');
        res.write(
          `"${entry.createdAt.toISOString()}","${entry.action}","${entry.entityType}","${entry.entityId}","${entry.agentId ?? ''}","${entry.ipAddress ?? ''}","${details}"\n`,
        );
      }

      res.end();
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get(
  '/admin/audit',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter = {
        action: req.query['action'] as string | undefined,
        entityType: req.query['entityType'] as string | undefined,
        dateFrom: req.query['dateFrom'] ? new Date(req.query['dateFrom'] as string) : undefined,
        dateTo: req.query['dateTo'] ? new Date(req.query['dateTo'] as string) : undefined,
        page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
      };
      const result = await adminService.getAuditLog(filter);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/audit-list', { result, filter });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/audit-log', { pageTitle: 'Audit Log', user, hasAvatar, result, filter, currentPath: '/admin/audit' });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Notifications ──────────────────────────────────────────
adminRouter.get(
  '/admin/notifications',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter = {
        channel: req.query['channel'] as string | undefined,
        status: req.query['status'] as string | undefined,
        dateFrom: req.query['dateFrom'] as string | undefined,
        dateTo: req.query['dateTo'] as string | undefined,
        page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
      };
      const result = await adminService.getNotifications(filter);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/notification-list', { result, filter });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/notifications', {
        pageTitle: 'Notifications',
        user,
        hasAvatar,
        result,
        filter,
        currentPath: '/admin/notifications',
      });
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
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/team', { pageTitle: 'Team', user, hasAvatar, team, currentPath: '/admin/team' });
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
      const [team, sellersResult] = await Promise.all([
        adminService.getTeam(),
        adminService.getAllSellers({ agentId: req.params['id'] as string, limit: 200 }),
      ]);
      const agent = team.find((a) => a.id === req.params['id']);
      if (!agent) throw new NotFoundError('Agent', req.params['id'] as string);
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/team-pipeline', {
        pageTitle: 'Team Pipeline',
        user,
        hasAvatar,
        agent,
        sellers: sellersResult.sellers,
        sellersTotal: sellersResult.total,
        currentPath: '/admin/team',
      });
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
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/sellers', { pageTitle: 'Sellers', user, hasAvatar, result, team, currentPath: '/admin/sellers' });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get(
  '/admin/sellers/:id',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const detail = await adminService.getAdminSellerDetail(req.params['id'] as string);
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/seller-detail', { pageTitle: 'Seller Detail', user, hasAvatar, detail });
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
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/settings', { pageTitle: 'Settings', user, hasAvatar, groups, currentPath: '/admin/settings' });
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
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/hdb', { pageTitle: 'HDB', user, hasAvatar, status, currentPath: '/admin/hdb' });
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

      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/compliance/deletion-queue', {
        pageTitle: 'Deletion Queue',
        user,
        hasAvatar,
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

const VALID_TUTORIAL_TABS = ['photography', 'forms', 'process', 'financial'] as const;
type TutorialTab = (typeof VALID_TUTORIAL_TABS)[number];

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
        const tutorials = await contentService.getTutorialsGrouped();
        const rawTab = req.query['tab'] as string | undefined;
        const activeTab: TutorialTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
          ? (rawTab as TutorialTab)
          : 'photography';
        const activeItems = tutorials[activeTab] ?? [];
        return res.render('partials/admin/tutorial-list', { tutorials: activeItems, activeTab });
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
      const rawTab = req.query['tab'] as string | undefined;
      const activeTab: TutorialTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
        ? (rawTab as TutorialTab)
        : 'photography';
      const tabCounts: Record<TutorialTab, number> = {
        photography: (tutorials['photography'] ?? []).length,
        forms: (tutorials['forms'] ?? []).length,
        process: (tutorials['process'] ?? []).length,
        financial: (tutorials['financial'] ?? []).length,
      };
      const activeItems = tutorials[activeTab] ?? [];
      if (req.headers['hx-request']) {
        return res.render('partials/admin/tutorial-list', { tutorials: activeItems, activeTab });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/tutorials', {
        pageTitle: 'Tutorials',
        user,
        hasAvatar,
        tutorials: activeItems,
        activeTab,
        tabCounts,
        currentPath: '/admin/tutorials',
      });
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.get(
  '/admin/tutorials/new',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const VALID_CATEGORIES = ['photography', 'forms', 'process', 'financial'];
      const rawCategory = req.query['category'] as string | undefined;
      const preselectedCategory = VALID_CATEGORIES.includes(rawCategory ?? '') ? rawCategory : '';
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/tutorial-form', {
        pageTitle: 'New Tutorial',
        user,
        hasAvatar,
        tutorial: null,
        errors: [],
        preselectedCategory,
        currentPath: '/admin/tutorials',
      });
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
    const user = req.user as AuthenticatedUser;
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(400).render('pages/admin/tutorial-form', {
          pageTitle: 'New Tutorial',
          user,
          hasAvatar,
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
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(409).render('pages/admin/tutorial-form', {
          pageTitle: 'New Tutorial',
          user,
          hasAvatar,
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
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/tutorial-form', {
        pageTitle: 'Edit Tutorial',
        user,
        hasAvatar,
        tutorial,
        errors: [],
        currentPath: '/admin/tutorials',
      });
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
    const user = req.user as AuthenticatedUser;
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const tutorial = await contentService.getTutorialById(req.params['id'] as string);
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(400).render('pages/admin/tutorial-form', {
          pageTitle: 'Edit Tutorial',
          user,
          hasAvatar,
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
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(409).render('pages/admin/tutorial-form', {
          pageTitle: 'Edit Tutorial',
          user,
          hasAvatar,
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
    const user = req.user as AuthenticatedUser;
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
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(409).render('pages/admin/market-content', {
          pageTitle: 'Market Content',
          user,
          hasAvatar,
          records,
          error: err.message,
          currentPath: '/admin/content/market',
        });
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
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/market-content', {
        pageTitle: 'Market Content',
        user,
        hasAvatar,
        records,
        error: notice,
        currentPath: '/admin/content/market',
      });
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
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/market-content-detail', {
        pageTitle: 'Market Content',
        user,
        hasAvatar,
        record,
        currentPath: '/admin/content/market',
      });
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

// Drawer form partial for manual testimonial creation
adminRouter.get(
  '/admin/content/testimonials/new',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      return res.render('partials/admin/testimonial-add-drawer');
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.get(
  '/admin/content/testimonials',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await contentService.listTestimonials();
      if (req.headers['hx-request']) {
        return res.render('partials/admin/testimonial-list', { records });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/testimonials', {
        pageTitle: 'Testimonials',
        user,
        hasAvatar,
        records,
        currentPath: '/admin/content/testimonials',
      });
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.post(
  '/admin/content/testimonials',
  ...adminAuth,
  ...validateManualTestimonialCreate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.headers['hx-request']) {
          return res.status(422).render('partials/admin/testimonial-add-drawer', {
            errors: errors.array(),
            values: req.body,
          });
        }
        return res.redirect('/admin/content/testimonials');
      }

      const user = req.user as AuthenticatedUser;
      await contentService.createManualTestimonial(user.id, {
        clientName: req.body.clientName as string,
        clientTown: req.body.clientTown as string,
        rating: Number(req.body.rating),
        content: req.body.content as string,
        source: (req.body.source as string) || undefined,
      });

      if (req.headers['hx-request']) {
        const records = await contentService.listTestimonials();
        return res.render('partials/admin/testimonial-list', { records });
      }
      return res.redirect('/admin/content/testimonials');
    } catch (err) {
      return next(err);
    }
  },
);

// Detail drawer partial — loads testimonial into the slide-in drawer
adminRouter.get(
  '/admin/content/testimonials/:id',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await contentService.getTestimonialById(req.params['id'] as string);
      if (!req.headers['hx-request']) {
        return res.redirect('/admin/content/testimonials');
      }
      return res.render('partials/admin/testimonial-detail-drawer', { record });
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
      if (req.headers['hx-request']) {
        const records = await contentService.listTestimonials();
        return res.render('partials/admin/testimonial-list', { records });
      }
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
      if (req.headers['hx-request']) {
        const records = await contentService.listTestimonials();
        return res.render('partials/admin/testimonial-list', { records });
      }
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
      const baseUrl = process.env['SITE_URL'] ?? 'https://www.sellmyhomenow.sg';
      if (req.headers['hx-request']) {
        return res.render('partials/admin/referral-funnel', { funnel, topReferrers, baseUrl });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/referrals', {
        pageTitle: 'Referrals',
        user,
        hasAvatar,
        records,
        funnel,
        topReferrers,
        baseUrl,
        currentPath: '/admin/content/referrals',
      });
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
