import { Router, Request, Response, NextFunction } from 'express';
import * as financialService from './financial.service';
import * as sellerService from '@/domains/seller/seller.service';
import {
  validateCalculationInput,
  validateApproveInput,
  validateSendInput,
} from './financial.validator';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import { logger } from '@/infra/logger';
import * as auditService from '@/domains/shared/audit.service';
import { ForbiddenError } from '@/domains/shared/errors';
import * as settingsService from '@/domains/shared/settings.service';
import * as propertyService from '@/domains/property/property.service';

export const financialRouter = Router();

// Seller routes — require authenticated seller
financialRouter.post(
  '/seller/financial/calculate',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;

      // Gate: seller must have loaded the form (which shows the disclaimer)
      // before they can submit a calculation. Prevents crafted direct API calls
      // from bypassing the disclaimer entirely.
      const seller = await sellerService.findById(user.id);
      if (!seller?.cpfDisclaimerShownAt) {
        throw new ForbiddenError('Please load the financial calculator form before submitting.');
      }

      const input = validateCalculationInput(req.body);

      const report = await financialService.calculateAndCreateReport({
        sellerId: user.id,
        propertyId: req.body.propertyId as string,
        calculationInput: input,
        metadata: {
          flatType: req.body.flatType as string,
          town: (req.body.town as string) || '',
          leaseCommenceDate: Number(req.body.leaseCommenceDate) || 0,
          cpfDisclaimerShownAt: seller.cpfDisclaimerShownAt.toISOString(),
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
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const [saleProceeds, reports, commission] = await Promise.all([
        sellerService.getSaleProceeds(user.id),
        financialService.getApprovedReportsForSeller(user.id),
        settingsService.getCommission(),
      ]);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/financial-hub', {
          saleProceeds,
          reports,
          commission,
        });
      }
      return res.render('pages/seller/financial', {
        saleProceeds,
        reports,
        commission,
      });
    } catch (err) {
      next(err);
    }
  },
);

financialRouter.get(
  '/seller/financial/estimate/edit',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const [saleProceeds, commission] = await Promise.all([
        sellerService.getSaleProceeds(user.id),
        settingsService.getCommission(),
      ]);
      const property = await propertyService.getPropertyForSeller(user.id);

      res.render('partials/seller/financial-estimate-edit', {
        saleProceeds,
        commission,
        askingPrice: property?.askingPrice ? Number(property.askingPrice) : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

financialRouter.post(
  '/seller/financial/estimate',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const {
        sellingPrice,
        outstandingLoan,
        cpfSeller1,
        cpfSeller2,
        cpfSeller3,
        cpfSeller4,
        resaleLevy,
        otherDeductions,
        buyerDeposit: buyerDepositRaw,
      } = req.body;

      if (!sellingPrice || !outstandingLoan || !cpfSeller1) {
        const commission = await settingsService.getCommission();
        return res.status(400).render('partials/seller/financial-estimate-edit', {
          error: 'Selling price, outstanding loan, and CPF (Seller 1) are required.',
          commission,
        });
      }

      const buyerDeposit = parseFloat(buyerDepositRaw || '0');
      if (isNaN(buyerDeposit) || buyerDeposit < 0 || buyerDeposit > 5000) {
        const commission = await settingsService.getCommission();
        return res.status(400).render('partials/seller/financial-estimate-edit', {
          error: 'Buyer deposit must be between $0 and $5,000.',
          commission,
        });
      }

      const parsedSellingPrice = parseFloat(sellingPrice);
      if (isNaN(parsedSellingPrice)) {
        return res.status(400).json({ error: 'Invalid numeric value for sellingPrice' });
      }
      const parsedOutstandingLoan = parseFloat(outstandingLoan);
      if (isNaN(parsedOutstandingLoan)) {
        return res.status(400).json({ error: 'Invalid numeric value for outstandingLoan' });
      }
      const parsedCpfSeller1 = parseFloat(cpfSeller1);
      if (isNaN(parsedCpfSeller1)) {
        return res.status(400).json({ error: 'Invalid numeric value for cpfSeller1' });
      }
      const parsedCpfSeller2 = cpfSeller2 ? parseFloat(cpfSeller2) : undefined;
      if (parsedCpfSeller2 !== undefined && isNaN(parsedCpfSeller2)) {
        return res.status(400).json({ error: 'Invalid numeric value for cpfSeller2' });
      }
      const parsedCpfSeller3 = cpfSeller3 ? parseFloat(cpfSeller3) : undefined;
      if (parsedCpfSeller3 !== undefined && isNaN(parsedCpfSeller3)) {
        return res.status(400).json({ error: 'Invalid numeric value for cpfSeller3' });
      }
      const parsedCpfSeller4 = cpfSeller4 ? parseFloat(cpfSeller4) : undefined;
      if (parsedCpfSeller4 !== undefined && isNaN(parsedCpfSeller4)) {
        return res.status(400).json({ error: 'Invalid numeric value for cpfSeller4' });
      }
      const parsedResaleLevy = parseFloat(resaleLevy || '0');
      if (isNaN(parsedResaleLevy)) {
        return res.status(400).json({ error: 'Invalid numeric value for resaleLevy' });
      }
      const parsedOtherDeductions = parseFloat(otherDeductions || '0');
      if (isNaN(parsedOtherDeductions)) {
        return res.status(400).json({ error: 'Invalid numeric value for otherDeductions' });
      }

      const commission = await settingsService.getCommission();

      await sellerService.saveSaleProceeds({
        sellerId: user.id,
        sellingPrice: parsedSellingPrice,
        outstandingLoan: parsedOutstandingLoan,
        cpfSeller1: parsedCpfSeller1,
        cpfSeller2: parsedCpfSeller2,
        cpfSeller3: parsedCpfSeller3,
        cpfSeller4: parsedCpfSeller4,
        resaleLevy: parsedResaleLevy,
        otherDeductions: parsedOtherDeductions,
        buyerDeposit,
        commission: commission.total,
      });

      const saleProceeds = await sellerService.getSaleProceeds(user.id);

      res.render('partials/seller/estimate-summary', {
        saleProceeds,
        commission,
      });
    } catch (err) {
      next(err);
    }
  },
);

financialRouter.get(
  '/seller/financial/form',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      // Record that this authenticated seller was served the disclaimer.
      // This is the server-side proof used to gate POST /calculate.
      await sellerService.recordCpfDisclaimerShown(user.id);
      res.render('partials/seller/financial-form');
    } catch (err) {
      next(err);
    }
  },
);

financialRouter.get(
  '/seller/financial/report/:id',
  requireAuth(),
  requireRole('seller'),
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
