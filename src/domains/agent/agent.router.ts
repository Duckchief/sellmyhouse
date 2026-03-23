import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as agentService from './agent.service';
import * as agentRepo from './agent.repository';
import * as sellerService from '@/domains/seller/seller.service';
import * as caseFlagService from '@/domains/seller/case-flag.service';
import { validateSellerListQuery } from './agent.validator';
import {
  validateCreateCaseFlag,
  validateUpdateCaseFlag,
} from '@/domains/seller/case-flag.validator';
import { processCorrectionValidator } from '../compliance/compliance.validator';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { ValidationError } from '@/domains/shared/errors';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import * as sellerDocService from '@/domains/seller/seller-document.service';
import archiver from 'archiver';
import type { SellerListFilter } from './agent.types';
import { getHasAvatar } from '../profile/profile.service';
import * as complianceService from '@/domains/compliance/compliance.service';
import * as verificationService from '../lead/verification.service';
import * as authService from '../auth/auth.service';

export const agentRouter = Router();

// Group-level 2FA guard — defence in depth; individual routes also include requireTwoFactor via agentAuth
agentRouter.use(requireTwoFactor());

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
      const [overview, repeatViewers, pendingDownloads] = await Promise.all([
        agentService.getPipelineOverview(getAgentFilter(user)),
        agentService.getRepeatViewers(),
        complianceService.getPendingDocumentDownloads(getAgentFilter(user)),
      ]);

      const currentStage = (req.query['stage'] as string) || null;
      if (req.headers['hx-request']) {
        return res.render('partials/agent/pipeline-overview', { overview, currentStage });
      }
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/dashboard', {
        pageTitle: 'Dashboard',
        user,
        hasAvatar,
        overview,
        repeatViewers,
        pendingDownloads,
        currentStage,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/dashboard/stats — Pipeline cards only (HTMX auto-refresh)
agentRouter.get(
  '/agent/dashboard/stats',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const currentStage = (req.query['stage'] as string) || null;
      const overview = await agentService.getPipelineOverview(getAgentFilter(user));
      res.render('partials/agent/pipeline-cards', { overview, currentStage });
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
      const { unassigned, verified, unverified } = await agentService.getLeadQueue(
        getAgentFilter(user),
      );

      if (req.headers['hx-request']) {
        return res.render('partials/agent/lead-queue', { unassigned, verified, unverified });
      }
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/leads', {
        pageTitle: 'Leads',
        user,
        hasAvatar,
        unassigned,
        verified,
        unverified,
      });
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

      const [result, statusCounts] = await Promise.all([
        agentService.getSellerList(filter, getAgentFilter(user)),
        agentService.getSellerStatusCounts(getAgentFilter(user)),
      ]);

      if (req.headers['hx-request']) {
        return res.render('partials/agent/seller-list', { result, statusCounts });
      }
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/sellers', {
        pageTitle: 'Sellers',
        user,
        hasAvatar,
        result,
        statusCounts,
        currentStatus: filter.status ?? '',
      });
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
      const sellerId = req.params['id'] as string;
      const agentId = getAgentFilter(user);

      const [seller, compliance, notifications, timelineInput, activeSellerDocs] =
        await Promise.all([
          agentService.getSellerDetail(sellerId, agentId),
          agentService.getComplianceStatus(sellerId, agentId),
          agentService.getNotificationHistory(sellerId, agentId, { page: 1, limit: 10 }),
          agentService.getTimelineInput(sellerId, agentId),
          sellerDocService.getActiveDocumentsForSeller(sellerId),
        ]);
      const milestones = sellerService.getTimelineMilestones(
        timelineInput,
        user.role as 'agent' | 'admin',
      );
      const isAdmin = user.role === 'admin';

      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/seller-detail', {
        pageTitle: 'Seller Detail',
        user,
        hasAvatar,
        seller,
        compliance,
        notifications,
        milestones,
        sellerId: seller.id,
        isAdmin,
        sellerDocs: activeSellerDocs,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/sellers/:id/status-modal — HTMX: render status change modal
agentRouter.get(
  '/agent/sellers/:id/status-modal',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const seller = await agentService.getSellerDetail(
        req.params['id'] as string,
        getAgentFilter(user),
      );

      const action = req.query['action'] as string;

      const NEXT_STATUS: Record<string, string> = {
        lead: 'engaged',
        engaged: 'active',
        active: 'completed',
      };

      const ADVANCE_META: Record<string, { title: string; label: string; noteRequired: boolean }> =
        {
          engaged: { title: 'Mark as Engaged', label: 'Consultation note', noteRequired: true },
          active: { title: 'Mark as Active', label: 'Activation note', noteRequired: true },
          completed: { title: 'Mark as Completed', label: 'Completion note', noteRequired: false },
        };

      let nextStatus: string;
      let title: string;
      let label: string;
      let noteRequired: boolean;

      if (action === 'archive') {
        nextStatus = 'archived';
        title = 'Archive Seller';
        label = 'Reason for archiving';
        noteRequired = true;
      } else {
        nextStatus = NEXT_STATUS[seller.status];
        if (!nextStatus) {
          return res.status(400).send('No advance action available for this status');
        }
        const meta = ADVANCE_META[nextStatus];
        if (!meta) {
          return res.status(400).send('Unrecognised next status');
        }
        title = meta.title;
        label = meta.label;
        noteRequired = meta.noteRequired;
      }

      return res.render('partials/agent/seller-status-modal', {
        seller,
        nextStatus,
        title,
        label,
        noteRequired,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/sellers/:id/notifications — HTMX pagination partial
agentRouter.get(
  '/agent/sellers/:id/notifications',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const sellerId = req.params['id'] as string;
      const rawPage = req.query['page'] ? parseInt(req.query['page'] as string, 10) : 1;
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

      const notifications = await agentService.getNotificationHistory(
        sellerId,
        getAgentFilter(user),
        { page, limit: 10 },
      );

      res.render('partials/agent/seller-notifications', { notifications, sellerId });
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
      const user = req.user as AuthenticatedUser;
      const requests = await agentRepo.getPendingCorrectionRequests();
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/agent/correction-requests', {
        pageTitle: 'Data Corrections',
        user,
        hasAvatar,
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

// PUT /agent/sellers/:id/status — update seller status (e.g. lead → engaged)
agentRouter.put(
  '/agent/sellers/:id/status',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const VALID_STATUSES = ['lead', 'engaged', 'active', 'completed', 'archived'];
      const { status, note } = req.body as { status?: string; note?: string };

      if (!status || !VALID_STATUSES.includes(status)) {
        return res
          .status(400)
          .json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid status value' } });
      }

      const user = req.user as AuthenticatedUser;
      const sellerId = req.params['id'] as string;
      await sellerService.updateSellerStatus(sellerId, status, user.id, note);

      if (req.headers['hx-request']) {
        res.set('HX-Refresh', 'true');
        return res.status(200).send('');
      }

      return res.status(200).json({ seller: { id: sellerId, status } });
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

// POST /agent/sellers/:id/resend-verification — agent resends verification email
agentRouter.post(
  '/agent/sellers/:id/resend-verification',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const sellerId = req.params['id'] as string;
      await verificationService.agentResendVerification(sellerId, user.id);

      if (req.headers['hx-request']) {
        return res.send('<span class="text-green-600 text-sm">Verification email resent!</span>');
      }
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/sellers/:id/resend-account-setup — agent resends account setup email
agentRouter.post(
  '/agent/sellers/:id/resend-account-setup',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const sellerId = req.params['id'] as string;
      await authService.resendAccountSetup(sellerId, user.id);

      if (req.headers['hx-request']) {
        return res.send('<span class="text-green-600 text-sm">Account setup email sent!</span>');
      }
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Seller Document Download Routes ──────────────────────────────────────────

// GET /agent/sellers/:id/documents — View seller's uploaded documents
agentRouter.get(
  '/agent/sellers/:id/documents',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const sellerId = req.params['id'] as string;
      const agentId = getAgentFilter(user);

      // Verify agent owns this seller (throws NotFoundError if not)
      const seller = await agentService.getSellerDetail(sellerId, agentId);
      const sellerDocs = await sellerDocService.getActiveDocumentsForSeller(sellerId);

      if (req.headers['hx-request']) {
        return res.render('partials/agent/seller-documents-inline', { sellerDocs, seller });
      }
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/seller-documents', { sellerDocs, seller, user, hasAvatar });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/sellers/:id/documents/:documentId/download — Download and delete single document
agentRouter.post(
  '/agent/sellers/:id/documents/:documentId/download',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const sellerId = req.params['id'] as string;
      const documentId = req.params['documentId'] as string;
      const agentId = getAgentFilter(user);

      // Verify agent owns this seller (throws NotFoundError if not)
      await agentService.getSellerDetail(sellerId, agentId);

      const { buffer, mimeType, docType } = await sellerDocService.downloadAndDeleteSellerDocument(
        documentId,
        user.id,
      );

      const extMap: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'application/pdf': '.pdf',
      };
      const ext = extMap[mimeType] || '';
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${docType}-${documentId}${ext}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/sellers/:id/documents/download-all — Download all as ZIP and delete
agentRouter.post(
  '/agent/sellers/:id/documents/download-all',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const sellerId = req.params['id'] as string;
      const agentId = getAgentFilter(user);

      // Verify agent owns this seller (throws NotFoundError if not)
      await agentService.getSellerDetail(sellerId, agentId);

      const { files } = await sellerDocService.downloadAllAndDeleteSellerDocuments(
        sellerId,
        user.id,
      );

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="seller-documents-${sellerId}.zip"`,
      );
      res.setHeader('Cache-Control', 'no-store');

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);
      for (const file of files) {
        archive.append(file.buffer, { name: file.filename });
      }
      await archive.finalize();
    } catch (err) {
      next(err);
    }
  },
);
