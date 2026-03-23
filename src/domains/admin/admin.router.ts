// src/domains/admin/admin.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import * as adminService from './admin.service';
import {
  validateAgentCreate,
  validateSettingUpdate,
  validateAssign,
  validateBulkAssign,
} from './admin.validator';
import {
  validateTutorialCreate,
  validateTutorialUpdate,
  validateManualTestimonialCreate,
} from '@/domains/content/content.validator';
import * as contentService from '@/domains/content/content.service';
import * as reviewService from '@/domains/review/review.service';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { NotFoundError, ConflictError, ValidationError } from '@/domains/shared/errors';
import { logger } from '@/infra/logger';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import { getHasAvatar } from '../profile/profile.service';
import { HDB_TOWNS } from '@/domains/property/property.types';

export const adminRouter = Router();

const adminAuth = [requireAuth(), requireRole('admin'), requireTwoFactor()];

// ─── Market Content ─────────────────────────────────────────────
const MARKET_CONTENT_STATUS_COLORS: Record<string, string> = {
  ai_generated: 'bg-gray-100 text-gray-700',
  pending_review: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  published: 'bg-blue-100 text-blue-800',
};

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
      res.render('pages/admin/dashboard', {
        pageTitle: 'Dashboard',
        user,
        hasAvatar,
        analytics,
        filter,
        currentPath: '/admin/dashboard',
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Pipeline ────────────────────────────────────────────────
adminRouter.get('/admin/pipeline', ...adminAuth, (_req: Request, res: Response) => {
  res.redirect('/admin/sellers');
});

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
      res.render('pages/admin/leads', {
        pageTitle: 'Leads',
        user,
        hasAvatar,
        unassigned,
        all,
        currentPath: '/admin/leads',
      });
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
      res.render('pages/admin/review-queue', {
        pageTitle: 'Review Queue',
        user,
        hasAvatar,
        queue,
        activeTab,
        currentPath: '/admin/review',
      });
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
      res.render('pages/admin/audit-log', {
        pageTitle: 'Audit Log',
        user,
        hasAvatar,
        result,
        filter,
        currentPath: '/admin/audit',
      });
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
      const [team, defaultAgentId] = await Promise.all([
        adminService.getTeam(),
        adminService.getDefaultAgentId(),
      ]);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-list', { team, defaultAgentId });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/team', {
        pageTitle: 'Team',
        user,
        hasAvatar,
        team,
        defaultAgentId,
        currentPath: '/admin/team',
      });
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
      const agentId = req.params['id'] as string;
      const newDefaultAgentId = req.body?.newDefaultAgentId as string | undefined;

      // Guard: if this agent is the default, require a replacement first
      const currentDefault = await adminService.getDefaultAgentId();
      if (currentDefault === agentId && !newDefaultAgentId) {
        const team = await adminService.getTeam();
        const activeAgents = team.filter((a) => a.isActive && a.id !== agentId);
        return res.render('partials/admin/reassign-default-modal', {
          agentId,
          action: 'deactivate',
          activeAgents,
        });
      }

      // Handle default replacement
      if (currentDefault === agentId && newDefaultAgentId) {
        if (newDefaultAgentId === 'unassigned') {
          await adminService.clearDefaultAgent(user.id);
        } else {
          // Basic UUID format check before hitting the service
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (!uuidRegex.test(newDefaultAgentId)) {
            throw new ValidationError('Invalid agent ID format');
          }
          await adminService.setDefaultAgent(newDefaultAgentId, user.id);
        }
      }

      await adminService.deactivateAgent(agentId, user.id);
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
  '/admin/team/:id/set-default',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await adminService.setDefaultAgent(req.params['id'] as string, user.id);
      const [team, defaultAgentId] = await Promise.all([
        adminService.getTeam(),
        adminService.getDefaultAgentId(),
      ]);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-list', { team, defaultAgentId });
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
      const agentId = req.params['id'] as string;
      const newDefaultAgentId = req.body?.newDefaultAgentId as string | undefined;

      const currentDefault = await adminService.getDefaultAgentId();
      if (currentDefault === agentId && !newDefaultAgentId) {
        const team = await adminService.getTeam();
        const activeAgents = team.filter((a) => a.isActive && a.id !== agentId);
        return res.render('partials/admin/reassign-default-modal', {
          agentId,
          action: 'anonymise',
          activeAgents,
        });
      }

      if (currentDefault === agentId && newDefaultAgentId) {
        if (newDefaultAgentId === 'unassigned') {
          await adminService.clearDefaultAgent(user.id);
        } else {
          // Basic UUID format check before hitting the service
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (!uuidRegex.test(newDefaultAgentId)) {
            throw new ValidationError('Invalid agent ID format');
          }
          await adminService.setDefaultAgent(newDefaultAgentId, user.id);
        }
      }

      await adminService.anonymiseAgent(agentId, user.id);
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
      const [result, team, statusCounts] = await Promise.all([
        adminService.getAllSellers(filter),
        adminService.getTeam(),
        adminService.getAdminSellerStatusCounts(),
      ]);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/seller-list', {
          result,
          team,
          statusCounts,
          currentAgentId: filter.agentId ?? '',
        });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/sellers', {
        pageTitle: 'Sellers',
        user,
        hasAvatar,
        result,
        team,
        statusCounts,
        currentStatus: filter.status ?? '',
        currentAgentId: filter.agentId ?? '',
        currentSearch: filter.search ?? '',
        currentPath: '/admin/sellers',
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET route for loading the bulk assign modal
adminRouter.get(
  '/admin/sellers/bulk-assign-modal',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sellerIds = (req.query['sellerIds'] as string) || '';
      const team = await adminService.getTeam();
      const count = sellerIds.split(',').filter(Boolean).length;
      res.render('partials/admin/assign-bulk-modal', {
        team,
        sellerIds,
        sellerCount: count,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST route for bulk assigning sellers
adminRouter.post(
  '/admin/sellers/bulk-assign',
  ...adminAuth,
  ...validateBulkAssign,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const user = req.user as AuthenticatedUser;
      const sellerIds = (req.body.sellerIds as string).split(',').filter(Boolean);
      const agentId = req.body.agentId as string;

      // Fetch all sellers to determine assign vs reassign
      const { sellers } = await adminService.getAllSellers({});
      const sellerMap = new Map(sellers.map((s) => [s.id, s]));

      let successCount = 0;
      for (const sellerId of sellerIds) {
        try {
          const seller = sellerMap.get(sellerId);
          if (seller?.agent) {
            await adminService.reassignSeller(sellerId, agentId, user.id);
          } else {
            await adminService.assignSeller(sellerId, agentId, user.id);
          }
          successCount++;
        } catch {
          // Continue on individual failure
        }
      }

      if (req.headers['hx-request']) {
        res.setHeader('HX-Trigger', 'sellerAssigned');
        return res.render('partials/admin/team-action-result', {
          message: `${successCount} of ${sellerIds.length} sellers assigned.`,
          type: 'success',
        });
      }
      res.redirect('/admin/sellers');
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
      res.render('pages/admin/seller-detail', {
        pageTitle: 'Seller Detail',
        user,
        hasAvatar,
        detail,
      });
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
        res.setHeader('HX-Trigger', 'sellerAssigned');
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
        res.setHeader('HX-Trigger', 'sellerAssigned');
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
      res.render('pages/admin/settings', {
        pageTitle: 'Settings',
        user,
        hasAvatar,
        groups,
        currentPath: '/admin/settings',
      });
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
      res.render('pages/admin/hdb', {
        pageTitle: 'HDB',
        user,
        hasAvatar,
        status,
        currentPath: '/admin/hdb',
      });
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
        return res.render('partials/admin/hdb-sync-progress', {
          since: new Date().toISOString(),
        });
      }
      res.redirect('/admin/hdb');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get(
  '/admin/hdb/sync/poll',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { since } = req.query as { since?: string };
      if (!since) {
        return res.status(400).send('Missing since param');
      }
      const sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        return res.status(400).send('Invalid since param');
      }
      const status = await adminService.getHdbStatus();

      const syncComplete =
        status.lastSync !== null && new Date(status.lastSync.syncedAt) > sinceDate;

      if (syncComplete) {
        return res.render('partials/admin/hdb-sync-complete', {
          status,
          success: status.lastSync!.status === 'success',
          recordsAdded: status.lastSync!.recordsAdded,
          errorMessage: status.lastSync!.error ?? null,
        });
      }

      return res.render('partials/admin/hdb-sync-progress', { since });
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
  body('reviewNotes').optional().isString().trim().isLength({ max: 1000 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
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
      if (req.headers['hx-request']) {
        return res.render('partials/admin/tutorial-form-drawer', {
          tutorial: null,
          errors: [],
          activeTab: preselectedCategory || 'photography',
        });
      }
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

adminRouter.get(
  '/admin/tutorials/:id/drawer',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tutorial = await contentService.getTutorialById(req.params['id'] as string);
      const rawTab = req.query['tab'] as string | undefined;
      const activeTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
        ? (rawTab as TutorialTab)
        : tutorial.category;
      return res.render('partials/admin/tutorial-form-drawer', {
        tutorial,
        errors: [],
        activeTab,
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
        if (req.headers['hx-request']) {
          const rawTab = (req.body.activeTab as string) ?? 'photography';
          const activeTab: TutorialTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
            ? (rawTab as TutorialTab)
            : 'photography';
          return res.status(422).render('partials/admin/tutorial-form-drawer', {
            tutorial: null,
            errors: errors.array(),
            values: req.body,
            activeTab,
          });
        }
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
      if (req.headers['hx-request']) {
        const rawTab = (req.body.activeTab as string) ?? 'photography';
        const activeTab: TutorialTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
          ? (rawTab as TutorialTab)
          : 'photography';
        const allTutorials = await contentService.getTutorialsGrouped();
        const activeItems = allTutorials[activeTab] ?? [];
        return res.render('partials/admin/tutorial-list', { tutorials: activeItems, activeTab });
      }
      return res.redirect('/admin/tutorials');
    } catch (err) {
      if (err instanceof ConflictError) {
        if (req.headers['hx-request']) {
          const rawTab = (req.body.activeTab as string) ?? 'photography';
          const activeTab: TutorialTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
            ? (rawTab as TutorialTab)
            : 'photography';
          return res.status(422).render('partials/admin/tutorial-form-drawer', {
            tutorial: null,
            errors: [{ msg: err.message }],
            values: req.body,
            activeTab,
          });
        }
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
        if (req.headers['hx-request']) {
          const tutorial = await contentService.getTutorialById(req.params['id'] as string);
          const rawTab = (req.body.activeTab as string) ?? 'photography';
          const activeTab: TutorialTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
            ? (rawTab as TutorialTab)
            : 'photography';
          return res.status(422).render('partials/admin/tutorial-form-drawer', {
            tutorial,
            errors: errors.array(),
            values: req.body,
            activeTab,
          });
        }
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
      if (req.headers['hx-request']) {
        const rawTab = (req.body.activeTab as string) ?? 'photography';
        const activeTab: TutorialTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
          ? (rawTab as TutorialTab)
          : 'photography';
        const allTutorials = await contentService.getTutorialsGrouped();
        const activeItems = allTutorials[activeTab] ?? [];
        return res.render('partials/admin/tutorial-list', { tutorials: activeItems, activeTab });
      }
      return res.redirect('/admin/tutorials');
    } catch (err) {
      if (err instanceof ConflictError) {
        if (req.headers['hx-request']) {
          const rawTab = (req.body.activeTab as string) ?? 'photography';
          const activeTab: TutorialTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
            ? (rawTab as TutorialTab)
            : 'photography';
          return res.status(422).render('partials/admin/tutorial-form-drawer', {
            tutorial: { id: req.params['id'] as string },
            errors: [{ msg: err.message }],
            values: req.body,
            activeTab,
          });
        }
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
      if (req.headers['hx-request']) {
        const rawTab = (req.body.activeTab as string) ?? 'photography';
        const activeTab: TutorialTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
          ? (rawTab as TutorialTab)
          : 'photography';
        const allTutorials = await contentService.getTutorialsGrouped();
        const activeItems = allTutorials[activeTab] ?? [];
        return res.render('partials/admin/tutorial-list', { tutorials: activeItems, activeTab });
      }
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
        const hasPendingReview = records.some((r) => r.status === 'pending_review');
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(409).render('pages/admin/market-content', {
          pageTitle: 'Market Content',
          user,
          hasAvatar,
          records,
          activeStatus: '',
          hasPendingReview,
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
      const activeStatus = (req.query['status'] as string) || '';
      const records = await contentService.listMarketContent(activeStatus || undefined);
      const allRecords = activeStatus ? await contentService.listMarketContent() : records;
      const hasPendingReview = allRecords.some((r) => r.status === 'pending_review');
      const notice =
        req.query['notice'] === 'no_data' ? 'Insufficient HDB data for the current period.' : null;
      if (req.headers['hx-request']) {
        return res.render('partials/admin/market-content-list', {
          records,
          activeStatus,
          hasPendingReview,
        });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/market-content', {
        pageTitle: 'Market Content',
        user,
        hasAvatar,
        records,
        activeStatus,
        hasPendingReview,
        error: notice,
        currentPath: '/admin/content/market',
      });
    } catch (err) {
      return next(err);
    }
  },
);

// GET /admin/content/market/:id — full-page detail view
adminRouter.get(
  '/admin/content/market/:id',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await contentService.getMarketContentById(req.params['id'] as string);
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/market-content-detail', {
        pageTitle: 'Market Content Detail',
        user,
        hasAvatar,
        record,
        statusColors: MARKET_CONTENT_STATUS_COLORS,
        currentPath: '/admin/content/market',
      });
    } catch (err) {
      return next(err);
    }
  },
);

// GET /admin/content/market/:id/detail — HTMX slide-out panel
adminRouter.get(
  '/admin/content/market/:id/detail',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await contentService.getMarketContentById(req.params['id'] as string);
      return res.render('partials/admin/market-content-detail-panel', {
        record,
        statusColors: MARKET_CONTENT_STATUS_COLORS,
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
      const id = req.params['id'] as string;
      await contentService.approveMarketContent(id, user.id);
      if (req.headers['hx-request']) {
        const record = await contentService.getMarketContentById(id);
        return res.render('partials/admin/market-content-row', {
          record,
          statusColors: MARKET_CONTENT_STATUS_COLORS,
        });
      }
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
      const id = req.params['id'] as string;
      await contentService.rejectMarketContent(id);
      if (req.headers['hx-request']) {
        const record = await contentService.getMarketContentById(id);
        return res.render('partials/admin/market-content-row', {
          record,
          statusColors: MARKET_CONTENT_STATUS_COLORS,
        });
      }
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
      return res.render('partials/admin/testimonial-add-drawer', { towns: HDB_TOWNS });
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
      const activeStatus =
        typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
      const [records, hasPendingReview] = await Promise.all([
        contentService.listTestimonials(activeStatus),
        contentService.hasPendingReviewTestimonials(),
      ]);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/testimonial-list', {
          records,
          activeStatus,
          hasPendingReview,
        });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/testimonials', {
        pageTitle: 'Testimonials',
        user,
        hasAvatar,
        records,
        activeStatus,
        hasPendingReview,
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
            towns: HDB_TOWNS,
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
        const [records, hasPendingReview] = await Promise.all([
          contentService.listTestimonials('pending_review'),
          contentService.hasPendingReviewTestimonials(),
        ]);
        return res.render('partials/admin/testimonial-list', {
          records,
          activeStatus: 'pending_review',
          hasPendingReview,
        });
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
        const [records, hasPendingReview] = await Promise.all([
          contentService.listTestimonials(),
          contentService.hasPendingReviewTestimonials(),
        ]);
        return res.render('partials/admin/testimonial-list', { records, hasPendingReview });
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
        const [records, hasPendingReview] = await Promise.all([
          contentService.listTestimonials(),
          contentService.hasPendingReviewTestimonials(),
        ]);
        return res.render('partials/admin/testimonial-list', { records, hasPendingReview });
      }
      return res.redirect('/admin/content/testimonials');
    } catch (err) {
      return next(err);
    }
  },
);

adminRouter.post(
  '/admin/content/testimonials/:id/resend',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const feedback =
        typeof req.body.feedback === 'string' && req.body.feedback.trim()
          ? req.body.feedback.trim()
          : undefined;
      await contentService.reissueTestimonialToken(req.params['id'] as string, user.id, feedback);
      if (req.headers['hx-request']) {
        const [records, hasPendingReview] = await Promise.all([
          contentService.listTestimonials(),
          contentService.hasPendingReviewTestimonials(),
        ]);
        return res.render('partials/admin/testimonial-list', { records, hasPendingReview });
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
      if (req.headers['hx-request']) {
        const [records, hasPendingReview] = await Promise.all([
          contentService.listTestimonials(),
          contentService.hasPendingReviewTestimonials(),
        ]);
        return res.render('partials/admin/testimonial-list', { records, hasPendingReview });
      }
      return res.redirect('/admin/content/testimonials');
    } catch (err) {
      return next(err);
    }
  },
);

// ─── Maintenance Mode ─────────────────────────────────────────

adminRouter.get(
  '/admin/maintenance',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      const maintenance = await adminService.getMaintenanceSettings();
      res.render('pages/admin/maintenance', {
        pageTitle: 'Maintenance',
        user,
        hasAvatar,
        maintenance,
        currentPath: '/admin/maintenance',
      });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/maintenance/toggle',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await adminService.toggleMaintenanceMode(user.id);
      const maintenance = await adminService.getMaintenanceSettings();

      if (req.headers['hx-request']) {
        return res.render('partials/admin/maintenance-status', { maintenance });
      }
      res.redirect('/admin/maintenance');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/maintenance/message',
  ...adminAuth,
  body('message').optional().isString().trim().isLength({ max: 500 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const user = req.user as AuthenticatedUser;
      const message = (req.body.message as string) ?? '';
      await adminService.setMaintenanceMessage(message, user.id);

      if (req.headers['hx-request']) {
        return res.status(200).send('Saved');
      }
      res.redirect('/admin/maintenance');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/maintenance/eta',
  ...adminAuth,
  body('eta').optional().isString().trim().isLength({ max: 50 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const user = req.user as AuthenticatedUser;
      const eta = (req.body.eta as string) ?? '';
      await adminService.setMaintenanceEta(eta, user.id);

      if (req.headers['hx-request']) {
        return res.status(200).send('Saved');
      }
      res.redirect('/admin/maintenance');
    } catch (err) {
      next(err);
    }
  },
);
