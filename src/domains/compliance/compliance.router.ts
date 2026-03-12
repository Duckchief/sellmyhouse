// src/domains/compliance/compliance.router.ts
import fs from 'fs/promises';
import path from 'path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { validationResult } from 'express-validator';
import archiver from 'archiver';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import * as complianceService from './compliance.service';
import * as complianceRepo from './compliance.repository';
import * as auditService from '../shared/audit.service';
import { withdrawConsentValidator, createCorrectionValidator } from './compliance.validator';
import { ValidationError, ForbiddenError, NotFoundError } from '../shared/errors';
import { logger } from '@/infra/logger';

const UPLOADS_ROOT = path.resolve(process.env['UPLOADS_DIR'] ?? 'uploads');

function assertInUploadsRoot(resolvedPath: string): void {
  if (!resolvedPath.startsWith(UPLOADS_ROOT + path.sep)) {
    throw new ForbiddenError('File path is outside the allowed uploads directory');
  }
}

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

// POST /agent/transactions/:transactionId/documents/:docType/download-and-delete
// Agent downloads a single document and permanently deletes it from the server
complianceRouter.post(
  '/agent/transactions/:transactionId/documents/:docType/download-and-delete',
  requireAuth(),
  requireRole('agent', 'admin'),
  requireTwoFactor(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const transactionId = req.params['transactionId'] as string;
      const docType = req.params['docType'] as string;
      const { offlineRetentionConfirmed, canProduceConfirmed } = req.body as {
        offlineRetentionConfirmed?: string;
        canProduceConfirmed?: string;
      };

      if (offlineRetentionConfirmed !== 'true' || canProduceConfirmed !== 'true') {
        return next(new ValidationError('Both confirmation checkboxes must be ticked'));
      }

      const txDocs = await complianceRepo.findTransactionDocuments(transactionId);
      if (!txDocs) return next(new NotFoundError('Transaction', transactionId));

      if (txDocs.status !== 'completed') {
        return next(new ForbiddenError('Documents can only be downloaded from completed transactions'));
      }

      const agentId = (req.user as { id: string; role: string }).id;
      const userRole = (req.user as { id: string; role: string }).role;
      if (userRole !== 'admin' && txDocs.seller.agentId !== agentId) {
        return next(new ForbiddenError('You do not own this transaction'));
      }

      let filePath: string | null = null;
      let docRecordId: string | null = null;

      if (docType === 'otp') {
        const otpPath = txDocs.otp?.scannedCopyPathSeller ?? txDocs.otp?.scannedCopyPathReturned ?? null;
        if (otpPath) {
          filePath = otpPath;
          docRecordId = txDocs.otp!.id;
        }
      } else if (docType === 'invoice' && txDocs.commissionInvoice?.invoiceFilePath) {
        filePath = txDocs.commissionInvoice.invoiceFilePath;
        docRecordId = txDocs.commissionInvoice.id;
      }

      if (!filePath) return next(new NotFoundError('Document', docType));

      try {
        await fs.access(filePath);
      } catch {
        return next(new NotFoundError('File on server', docType));
      }

      const fileName = path.basename(filePath);
      const resolvedPath = path.resolve(filePath);
      assertInUploadsRoot(resolvedPath);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', 'application/octet-stream');

      res.sendFile(resolvedPath, async (err) => {
        if (err) {
          logger.warn({ err, filePath, transactionId }, 'sendFile failed; file not deleted');
          return;
        }

        try {
          await fs.unlink(filePath as string);

          if (docType === 'otp' && docRecordId) {
            await complianceRepo.markOtpScannedCopyDeleted(docRecordId);
          } else if (docType === 'invoice' && docRecordId) {
            await complianceRepo.markInvoiceDeleted(docRecordId);
          }

          await auditService.log({
            action: 'documents.downloaded_and_deleted',
            entityType: 'transaction',
            entityId: transactionId,
            details: {
              files: [fileName],
              transactionId,
              downloadedBy: agentId,
              offlineRetentionConfirmed: true,
              reason: 'server data minimisation',
              docType,
            },
            agentId,
          });
        } catch (deleteErr) {
          logger.error({ deleteErr, filePath, transactionId }, 'Failed to delete file post-download');
        }
      });
    } catch (err) {
      return next(err);
    }
  },
);

// POST /agent/transactions/:transactionId/documents/download-all-and-delete
// Agent bulk-downloads all documents as a ZIP and permanently deletes them from the server
complianceRouter.post(
  '/agent/transactions/:transactionId/documents/download-all-and-delete',
  requireAuth(),
  requireRole('agent', 'admin'),
  requireTwoFactor(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const transactionId = req.params['transactionId'] as string;
      const { offlineRetentionConfirmed, canProduceConfirmed } = req.body as {
        offlineRetentionConfirmed?: string;
        canProduceConfirmed?: string;
      };

      if (offlineRetentionConfirmed !== 'true' || canProduceConfirmed !== 'true') {
        return next(new ValidationError('Both confirmation checkboxes must be ticked'));
      }

      const txDocs = await complianceRepo.findTransactionDocuments(transactionId);
      if (!txDocs) return next(new NotFoundError('Transaction', transactionId));

      if (txDocs.status !== 'completed') {
        return next(new ForbiddenError('Documents can only be downloaded from completed transactions'));
      }

      const agentId = (req.user as { id: string; role: string }).id;
      const userRole = (req.user as { id: string; role: string }).role;
      if (userRole !== 'admin' && txDocs.seller.agentId !== agentId) {
        return next(new ForbiddenError('You do not own this transaction'));
      }

      const filesToProcess: { filePath: string; docType: string; recordId: string }[] = [];

      const otpPath = txDocs.otp?.scannedCopyPathSeller ?? txDocs.otp?.scannedCopyPathReturned ?? null;
      if (otpPath) {
        filesToProcess.push({
          filePath: otpPath,
          docType: 'otp',
          recordId: txDocs.otp!.id,
        });
      }
      if (txDocs.commissionInvoice?.invoiceFilePath) {
        filesToProcess.push({
          filePath: txDocs.commissionInvoice.invoiceFilePath,
          docType: 'invoice',
          recordId: txDocs.commissionInvoice.id,
        });
      }

      // Validate ALL files exist first
      const missingFiles: string[] = [];
      for (const doc of filesToProcess) {
        try {
          await fs.access(doc.filePath);
          assertInUploadsRoot(path.resolve(doc.filePath));
        } catch {
          missingFiles.push(path.basename(doc.filePath));
        }
      }
      if (missingFiles.length > 0) {
        return next(new ValidationError(`Cannot proceed: missing files: ${missingFiles.join(', ')}`));
      }

      if (filesToProcess.length === 0) {
        return next(new ValidationError('No sensitive documents found for this transaction'));
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="transaction-${transactionId}-documents.zip"`,
      );

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (archiveErr) => next(archiveErr));
      archive.pipe(res);

      for (const doc of filesToProcess) {
        archive.file(doc.filePath, { name: path.basename(doc.filePath) });
      }

      res.on('finish', () => {
        // Delete files after stream fully sent
        void (async () => {
          const fileNames: string[] = [];
          for (const doc of filesToProcess) {
            fileNames.push(path.basename(doc.filePath));
            try {
              await fs.unlink(doc.filePath);
              if (doc.docType === 'otp') {
                await complianceRepo.markOtpScannedCopyDeleted(doc.recordId);
              } else if (doc.docType === 'invoice') {
                await complianceRepo.markInvoiceDeleted(doc.recordId);
              }
            } catch (deleteErr) {
              logger.error(
                { deleteErr, filePath: doc.filePath },
                'Failed to delete file post-bulk-download',
              );
            }
          }

          const successFiles = fileNames; // approximate; log even on partial failure
          try {
            await auditService.log({
              action: 'documents.downloaded_and_deleted',
              entityType: 'transaction',
              entityId: transactionId,
              details: {
                files: successFiles,
                transactionId,
                downloadedBy: agentId,
                offlineRetentionConfirmed: true,
                reason: 'server data minimisation',
                bulk: true,
              },
              agentId,
            });
          } catch (auditErr) {
            logger.error({ auditErr, transactionId }, 'Failed to write audit log post-bulk-download');
          }
        })();
      });

      archive.finalize();
    } catch (err) {
      return next(err);
    }
  },
);
