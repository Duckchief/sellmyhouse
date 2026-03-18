import { Router, Request, Response, NextFunction } from 'express';
import * as financialService from './financial.service';
import {
  validateCalculationInput,
  validateApproveInput,
  validateSendInput,
} from './financial.validator';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import { logger } from '@/infra/logger';
import * as auditService from '@/domains/shared/audit.service';

export const financialRouter = Router();

// Seller routes — require authenticated seller
financialRouter.post(
  '/seller/financial/calculate',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const input = validateCalculationInput(req.body);

      const report = await financialService.calculateAndCreateReport({
        sellerId: user.id,
        propertyId: req.body.propertyId,
        calculationInput: input,
        metadata: {
          flatType: req.body.flatType,
          town: req.body.town || '',
          leaseCommenceDate: Number(req.body.leaseCommenceDate) || 0,
          cpfDisclaimerShownAt: req.body.cpfDisclaimerShownAt || new Date().toISOString(),
        },
      });

      // Auto-generate narrative (fire-and-forget — doesn't block response)
      financialService.generateNarrative(report.id).catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ err, reportId: report.id }, 'Narrative generation failed');
        auditService
          .log({
            action: 'financial.narrative_generation_failed',
            entityType: 'financial_report',
            entityId: report.id,
            details: { error: errorMessage },
          })
          .catch(() => {}); // audit log failure must not propagate
      });

      if (req.headers['hx-request']) {
        return res.render('partials/seller/financial-report', { report });
      }
      return res.json({ success: true, report });
    } catch (err) {
      next(err);
    }
  },
);

financialRouter.get(
  '/seller/financial',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const reports = await financialService.getReportsForSeller(user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/financial-list', { reports });
      }
      return res.render('pages/seller/financial');
    } catch (err) {
      next(err);
    }
  },
);

financialRouter.get('/seller/financial/form', requireAuth(), (_req: Request, res: Response) => {
  res.render('partials/seller/financial-form');
});

financialRouter.get(
  '/seller/financial/report/:id',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const report = await financialService.getReportForSeller(req.params.id as string, user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/financial-report', { report });
      }
      return res.json({ success: true, report });
    } catch (err) {
      next(err);
    }
  },
);

// Agent routes — require agent or admin role with 2FA
financialRouter.post(
  '/api/v1/financial/report/:id/approve',
  requireAuth(),
  requireRole('agent', 'admin'),
  requireTwoFactor(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { reviewNotes } = validateApproveInput(req.body);

      await financialService.approveReport({
        reportId: req.params.id as string,
        agentId: user.id,
        reviewNotes,
      });

      return res.json({ success: true, message: 'Report approved' });
    } catch (err) {
      next(err);
    }
  },
);

financialRouter.post(
  '/api/v1/financial/report/:id/send',
  requireAuth(),
  requireRole('agent', 'admin'),
  requireTwoFactor(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { channel } = validateSendInput(req.body);

      await financialService.sendReport({
        reportId: req.params.id as string,
        agentId: user.id,
        channel,
      });

      return res.json({ success: true, message: 'Report sent to seller' });
    } catch (err) {
      next(err);
    }
  },
);
