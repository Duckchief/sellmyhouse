// src/domains/compliance/compliance.router.ts
import fs from 'fs/promises';
import path from 'path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { validationResult } from 'express-validator';
import archiver from 'archiver';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import * as complianceService from './compliance.service';
import * as auditService from '../shared/audit.service';
import multer from 'multer';
import {
  withdrawConsentValidator,
  createCorrectionValidator,
  createCddValidator,
  updateCddStatusValidator,
  createEaaValidator,
  updateEaaStatusValidator,
  confirmExplanationValidator,
} from './compliance.validator';
import { ValidationError, ForbiddenError, NotFoundError } from '../shared/errors';
import * as agentRepo from '../agent/agent.repository';
import { logger } from '@/infra/logger';

const UPLOADS_ROOT = path.resolve(process.env['UPLOADS_DIR'] ?? 'uploads');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const agentAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];

function extractValidationErrors(req: Request, next: NextFunction): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const fields = Object.fromEntries(
      Object.entries(errors.mapped()).map(([k, v]) => [k, v.msg as string]),
    );
    next(new ValidationError('Invalid request', fields));
    return true;
  }
  return false;
}

function getAgentId(req: Request): string {
  return (req.user as { id: string }).id;
}

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

      const txDocs = await complianceService.getTransactionDocuments(transactionId);
      if (!txDocs) return next(new NotFoundError('Transaction', transactionId));

      if (txDocs.status !== 'completed') {
        return next(
          new ForbiddenError('Documents can only be downloaded from completed transactions'),
        );
      }

      const agentId = (req.user as { id: string; role: string }).id;
      const userRole = (req.user as { id: string; role: string }).role;
      if (userRole !== 'admin' && txDocs.seller.agentId !== agentId) {
        return next(new ForbiddenError('You do not own this transaction'));
      }

      let filePath: string | null = null;
      let docRecordId: string | null = null;

      if (docType === 'otp') {
        const otpPath =
          txDocs.otp?.scannedCopyPathSeller ?? txDocs.otp?.scannedCopyPathReturned ?? null;
        if (otpPath) {
          filePath = otpPath;
          docRecordId = txDocs.otp!.id;
        }
      } else if (docType === 'invoice' && txDocs.commissionInvoice?.invoiceFilePath) {
        filePath = txDocs.commissionInvoice.invoiceFilePath;
        docRecordId = txDocs.commissionInvoice.id;
      } else if (docType === 'eaa' && txDocs.estateAgencyAgreement?.signedCopyPath) {
        filePath = txDocs.estateAgencyAgreement.signedCopyPath;
        docRecordId = txDocs.estateAgencyAgreement.id;
      } else if (docType === 'cdd') {
        const cddRecords = await complianceService.getCddRecordsByTransaction(transactionId);
        const cddDoc = cddRecords
          .flatMap((r) => (r.documents as { path: string }[] | null) ?? [])
          .find((d) => d.path);
        if (cddDoc?.path) {
          filePath = cddDoc.path;
          // For CDD, docRecordId identifies the CDD record — used for audit only (no DB path clear)
          docRecordId = cddRecords[0]?.id ?? null;
        }
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
            await complianceService.recordOtpScannedCopyDeleted(docRecordId);
          } else if (docType === 'invoice' && docRecordId) {
            await complianceService.recordInvoiceDeleted(docRecordId);
          } else if (docType === 'eaa' && docRecordId) {
            await complianceService.recordEaaSignedCopyDeleted(docRecordId);
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
          logger.error(
            { deleteErr, filePath, transactionId },
            'Failed to delete file post-download',
          );
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

      const txDocs = await complianceService.getTransactionDocuments(transactionId);
      if (!txDocs) return next(new NotFoundError('Transaction', transactionId));

      if (txDocs.status !== 'completed') {
        return next(
          new ForbiddenError('Documents can only be downloaded from completed transactions'),
        );
      }

      const agentId = (req.user as { id: string; role: string }).id;
      const userRole = (req.user as { id: string; role: string }).role;
      if (userRole !== 'admin' && txDocs.seller.agentId !== agentId) {
        return next(new ForbiddenError('You do not own this transaction'));
      }

      const filesToProcess: { filePath: string; docType: string; recordId: string }[] = [];

      const otpPath =
        txDocs.otp?.scannedCopyPathSeller ?? txDocs.otp?.scannedCopyPathReturned ?? null;
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
      if (txDocs.estateAgencyAgreement?.signedCopyPath) {
        filesToProcess.push({
          filePath: txDocs.estateAgencyAgreement.signedCopyPath,
          docType: 'eaa',
          recordId: txDocs.estateAgencyAgreement.id,
        });
      }
      const cddRecords = await complianceService.getCddRecordsByTransaction(transactionId);
      for (const cddRecord of cddRecords) {
        const docs = (cddRecord.documents as { path: string }[] | null) ?? [];
        for (const doc of docs) {
          if (doc.path) {
            filesToProcess.push({ filePath: doc.path, docType: 'cdd', recordId: cddRecord.id });
          }
        }
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
        return next(
          new ValidationError(`Cannot proceed: missing files: ${missingFiles.join(', ')}`),
        );
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
                await complianceService.recordOtpScannedCopyDeleted(doc.recordId);
              } else if (doc.docType === 'invoice') {
                await complianceService.recordInvoiceDeleted(doc.recordId);
              } else if (doc.docType === 'eaa') {
                await complianceService.recordEaaSignedCopyDeleted(doc.recordId);
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
            logger.error(
              { auditErr, transactionId },
              'Failed to write audit log post-bulk-download',
            );
          }
        })();
      });

      archive.finalize();
    } catch (err) {
      return next(err);
    }
  },
);

// ─── Agent Compliance Gate Management ─────────────────────────────────────────

// PATCH /agent/sellers/:sellerId/cdd/status — Update seller CDD status (Gate 1)
complianceRouter.patch(
  '/agent/sellers/:sellerId/cdd/status',
  ...agentAuth,
  updateCddStatusValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    if (extractValidationErrors(req, next)) return;
    try {
      const sellerId = req.params['sellerId'] as string;
      const agentId = getAgentId(req);
      const { status } = req.body as { status: 'not_started' | 'pending' | 'verified' };

      await complianceService.updateCddStatus(sellerId, status, agentId);

      const compliance = await agentRepo.getComplianceStatus(sellerId, agentId);
      return res.render('partials/agent/compliance-cdd-card', { compliance, sellerId });
    } catch (err) {
      return next(err);
    }
  },
);

// POST /agent/sellers/:sellerId/eaa — Create EAA (Gate 2)
complianceRouter.post(
  '/agent/sellers/:sellerId/eaa',
  ...agentAuth,
  createEaaValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    if (extractValidationErrors(req, next)) return;
    try {
      const sellerId = req.params['sellerId'] as string;
      const agentId = getAgentId(req);
      const {
        agreementType,
        commissionAmount,
        commissionGstInclusive,
        coBrokingAllowed,
        coBrokingTerms,
        expiryDate,
      } = req.body as {
        agreementType?: 'exclusive' | 'non_exclusive';
        commissionAmount?: number;
        commissionGstInclusive?: boolean;
        coBrokingAllowed?: boolean;
        coBrokingTerms?: string;
        expiryDate?: string;
      };

      await complianceService.createEaa(
        {
          sellerId,
          agentId,
          agreementType,
          commissionAmount: commissionAmount ? Number(commissionAmount) : undefined,
          commissionGstInclusive,
          coBrokingAllowed,
          coBrokingTerms,
          expiryDate: expiryDate ? new Date(expiryDate) : undefined,
        },
        agentId,
      );

      const compliance = await agentRepo.getComplianceStatus(sellerId, agentId);
      return res.render('partials/agent/compliance-eaa-card', { compliance, sellerId });
    } catch (err) {
      return next(err);
    }
  },
);

// PUT /agent/eaa/:eaaId/status — Update EAA status (Gate 2)
complianceRouter.put(
  '/agent/eaa/:eaaId/status',
  ...agentAuth,
  updateEaaStatusValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    if (extractValidationErrors(req, next)) return;
    try {
      const eaaId = req.params['eaaId'] as string;
      const agentId = getAgentId(req);
      const { status } = req.body as { status: string };

      const eaa = await complianceService.updateEaaStatus(eaaId, status, agentId);
      const compliance = await agentRepo.getComplianceStatus(eaa.sellerId, agentId);
      return res.render('partials/agent/compliance-eaa-card', {
        compliance,
        sellerId: eaa.sellerId,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// POST /agent/eaa/:eaaId/signed-copy — Upload signed EAA copy (Gate 2)
complianceRouter.post(
  '/agent/eaa/:eaaId/signed-copy',
  ...agentAuth,
  upload.single('signedCopy'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eaaId = req.params['eaaId'] as string;
      const agentId = getAgentId(req);
      const file = req.file;

      if (!file) {
        return next(new ValidationError('Signed copy file is required'));
      }

      const eaa = await complianceService.uploadEaaSignedCopy(
        eaaId,
        { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname },
        agentId,
      );
      const compliance = await agentRepo.getComplianceStatus(eaa.sellerId, agentId);
      return res.render('partials/agent/compliance-eaa-card', {
        compliance,
        sellerId: eaa.sellerId,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// POST /agent/eaa/:eaaId/explanation — Confirm EAA explanation (Gate 4)
complianceRouter.post(
  '/agent/eaa/:eaaId/explanation',
  ...agentAuth,
  confirmExplanationValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    if (extractValidationErrors(req, next)) return;
    try {
      const eaaId = req.params['eaaId'] as string;
      const agentId = getAgentId(req);
      const { method, notes } = req.body as { method: 'video_call' | 'in_person'; notes?: string };

      const eaa = await complianceService.confirmEaaExplanation({
        eaaId,
        method,
        notes,
        agentId,
      });
      const compliance = await agentRepo.getComplianceStatus(eaa.sellerId, agentId);
      return res.render('partials/agent/compliance-eaa-card', {
        compliance,
        sellerId: eaa.sellerId,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// POST /agent/transactions/:txId/counterparty-cdd — Create counterparty CDD record (Gate 3)
complianceRouter.post(
  '/agent/transactions/:txId/counterparty-cdd',
  ...agentAuth,
  createCddValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    if (extractValidationErrors(req, next)) return;
    try {
      const txId = req.params['txId'] as string;
      const agentId = getAgentId(req);
      const { fullName, nricLast4, riskLevel, notes, dateOfBirth, nationality, occupation } =
        req.body as {
          fullName: string;
          nricLast4: string;
          riskLevel?: 'standard' | 'enhanced';
          notes?: string;
          dateOfBirth?: string;
          nationality?: string;
          occupation?: string;
        };

      await complianceService.createCddRecord(
        {
          subjectType: 'counterparty',
          subjectId: txId,
          fullName,
          nricLast4,
          verifiedByAgentId: agentId,
          riskLevel: riskLevel ?? 'standard',
          notes,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          nationality,
          occupation,
        },
        agentId,
      );

      // Find the sellerId from the transaction to re-render the card
      const txDocs = await complianceService.getTransactionDocuments(txId);
      const sellerId = txDocs?.sellerId ?? '';
      const compliance = await agentRepo.getComplianceStatus(sellerId, agentId);
      return res.render('partials/agent/compliance-counterparty-cdd-card', {
        compliance,
        sellerId,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ─── Modal GET Endpoints (load modal content via HTMX) ───────────────────────

// GET /agent/sellers/:sellerId/eaa/modal
complianceRouter.get(
  '/agent/sellers/:sellerId/eaa/modal',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.params['sellerId'] as string;
      return res.render('partials/agent/eaa-modal', { sellerId });
    } catch (err) {
      return next(err);
    }
  },
);

// GET /agent/eaa/:eaaId/explanation/modal
complianceRouter.get(
  '/agent/eaa/:eaaId/explanation/modal',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eaaId = req.params['eaaId'] as string;
      return res.render('partials/agent/eaa-explanation-modal', { eaaId });
    } catch (err) {
      return next(err);
    }
  },
);

// GET /agent/eaa/:eaaId/signed-copy/modal
complianceRouter.get(
  '/agent/eaa/:eaaId/signed-copy/modal',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eaaId = req.params['eaaId'] as string;
      return res.render('partials/agent/eaa-signed-copy-modal', { eaaId });
    } catch (err) {
      return next(err);
    }
  },
);

// GET /agent/transactions/:txId/counterparty-cdd/modal
complianceRouter.get(
  '/agent/transactions/:txId/counterparty-cdd/modal',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const txId = req.params['txId'] as string;
      return res.render('partials/agent/cdd-modal', {
        sellerId: txId,
        endpoint: `/agent/transactions/${txId}/counterparty-cdd`,
        target: '#compliance-counterparty-cdd-card',
        title: 'Create Counterparty CDD Record',
      });
    } catch (err) {
      return next(err);
    }
  },
);
