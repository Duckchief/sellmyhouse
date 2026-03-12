// src/domains/compliance/compliance.router.ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { requireAuth, requireRole } from '@/infra/http/middleware/require-auth';
import * as complianceService from './compliance.service';
import {
  withdrawConsentValidator,
  createCorrectionValidator,
} from './compliance.validator';
import { ValidationError } from '../shared/errors';

export const complianceRouter = Router();

// POST /seller/compliance/consent/withdraw
// Seller withdraws marketing or service consent
complianceRouter.post(
  '/seller/compliance/consent/withdraw',
  requireAuth(),
  requireRole('seller'),
  withdrawConsentValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const fields = Object.fromEntries(
        Object.entries(errors.mapped()).map(([k, v]) => [k, v.msg as string]),
      );
      return next(new ValidationError('Invalid request', fields));
    }

    try {
      const sellerId = (req.user as { id: string }).id;
      const { type, channel } = req.body as { type: string; channel?: string };

      const result = await complianceService.withdrawConsent({
        sellerId,
        type: type as 'service' | 'marketing',
        channel: (channel as string) ?? 'web',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      if (req.headers['hx-request']) {
        return res.render('partials/compliance/consent-withdrawal-result', {
          type,
          deletionBlocked: result.deletionBlocked,
          retentionRule: result.retentionRule,
        });
      }

      return res.redirect('/seller/my-data?consent_withdrawn=true');
    } catch (err) {
      return next(err);
    }
  },
);

// GET /seller/my-data — Seller's personal data portal
complianceRouter.get(
  '/seller/my-data',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sellerId = (req.user as { id: string }).id;
      const myData = await complianceService.getMyData(sellerId);

      if (req.headers['hx-request']) {
        return res.render('partials/compliance/consent-panel', {
          consentService: myData.seller.consentService,
          consentMarketing: myData.seller.consentMarketing,
          consentHistory: myData.consentHistory,
        });
      }

      return res.render('pages/seller/my-data', {
        seller: myData.seller,
        properties: myData.properties,
        consentHistory: myData.consentHistory,
        correctionRequests: myData.correctionRequests,
        title: 'My Data',
        query: req.query,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// POST /seller/compliance/corrections — Submit correction request
complianceRouter.post(
  '/seller/compliance/corrections',
  requireAuth(),
  requireRole('seller'),
  createCorrectionValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const fields = Object.fromEntries(
        Object.entries(errors.mapped()).map(([k, v]) => [k, v.msg as string]),
      );
      return next(new ValidationError('Invalid request', fields));
    }

    try {
      const sellerId = (req.user as { id: string }).id;
      const { fieldName, currentValue, requestedValue, reason } = req.body as {
        fieldName: string;
        currentValue?: string;
        requestedValue: string;
        reason?: string;
      };

      await complianceService.createCorrectionRequest({
        sellerId,
        fieldName,
        currentValue,
        requestedValue,
        reason,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/compliance/correction-row', {
          request: {
            fieldName,
            requestedValue,
            status: 'pending',
            createdAt: new Date(),
          },
          successMessage: 'Correction request submitted. An agent will review it within 30 days.',
        });
      }

      return res.redirect('/seller/my-data?correction_submitted=true');
    } catch (err) {
      return next(err);
    }
  },
);

// GET /seller/compliance/export — Download my data as JSON
complianceRouter.get(
  '/seller/compliance/export',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sellerId = (req.user as { id: string }).id;
      const exportData = await complianceService.generateDataExport(sellerId);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      return res.json(exportData);
    } catch (err) {
      return next(err);
    }
  },
);
