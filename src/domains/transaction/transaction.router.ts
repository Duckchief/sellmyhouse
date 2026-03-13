// src/domains/transaction/transaction.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { validationResult } from 'express-validator';
import * as txService from './transaction.service';
import {
  validateCreateTransaction,
  validateAdvanceStatus,
  validateMarkFallenThrough,
  validateCreateOtp,
  validateUploadInvoice,
  validateUpdateHdb,
  validateSendInvoice,
} from './transaction.validator';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { localStorage } from '@/infra/storage/local-storage';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

export const transactionRouter = Router();

const agentAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /agent/transactions — create transaction
transactionRouter.post(
  '/agent/transactions',
  ...agentAuth,
  ...validateCreateTransaction,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const tx = await txService.createTransaction({
        propertyId: req.body.propertyId as string,
        sellerId: req.body.sellerId as string,
        offerId: req.body.offerId as string,
        agreedPrice: req.body.agreedPrice, // pass as-is; Prisma Decimal handles conversion
        optionFee: req.body.optionFee ? Number(req.body.optionFee) : undefined,
        optionDate: req.body.optionDate ? new Date(req.body.optionDate as string) : undefined,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/transaction-row', { tx });
      }
      res.status(201).json({ tx });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/transactions/:id — transaction detail
transactionRouter.get(
  '/agent/transactions/:id',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tx = await txService.getTransaction(req.params['id'] as string);

      if (req.headers['hx-request']) {
        return res.render('partials/agent/transaction-detail', { tx });
      }
      res.render('pages/agent/transaction', { tx });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /agent/transactions/:id/status — advance transaction status
transactionRouter.patch(
  '/agent/transactions/:id/status',
  ...agentAuth,
  ...validateAdvanceStatus,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.body.status === 'fallen_through') {
        return res.status(400).json({
          error:
            'Use POST /agent/transactions/:id/fallen-through to mark a transaction as fallen through',
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const tx = await txService.advanceTransactionStatus({
        transactionId: req.params['id'] as string,
        status: req.body.status as 'option_exercised' | 'completing' | 'completed',
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/transaction-detail', { tx });
      }
      res.json({ tx });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:transactionId/fallen-through — mark transaction as fallen through with reason
transactionRouter.post(
  '/agent/transactions/:transactionId/fallen-through',
  ...agentAuth,
  ...validateMarkFallenThrough,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const tx = await txService.markFallenThrough({
        transactionId: req.params['transactionId'] as string,
        sellerId: req.body.sellerId as string,
        reason: req.body.reason as string,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/transaction-detail', { tx });
      }
      res.json({ tx });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /agent/transactions/:id/hdb — update HDB tracking
transactionRouter.patch(
  '/agent/transactions/:id/hdb',
  ...agentAuth,
  ...validateUpdateHdb,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const tx = await txService.updateHdbTracking({
        transactionId: req.params['id'] as string,
        hdbApplicationStatus: req.body.hdbApplicationStatus as string | undefined,
        hdbAppointmentDate: req.body.hdbAppointmentDate
          ? new Date(req.body.hdbAppointmentDate as string)
          : undefined,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/transaction-hdb', { tx });
      }
      res.json({ tx });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/otp — create OTP record
transactionRouter.post(
  '/agent/transactions/:id/otp',
  ...agentAuth,
  ...validateCreateOtp,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const otp = await txService.createOtp({
        transactionId: req.params['id'] as string,
        hdbSerialNumber: req.body.hdbSerialNumber as string,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/otp-panel', { otp });
      }
      res.status(201).json({ otp });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/otp/advance — advance OTP to next step
transactionRouter.post(
  '/agent/transactions/:id/otp/advance',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const otp = await txService.advanceOtp({
        transactionId: req.params['id'] as string,
        notes: req.body.notes as string | undefined,
        issuedAt: req.body.issuedAt ? new Date(req.body.issuedAt as string) : undefined,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/otp-panel', { otp });
      }
      res.json({ otp });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/otp/scan/:scanType — upload OTP scan
transactionRouter.post(
  '/agent/transactions/:id/otp/scan/:scanType',
  ...agentAuth,
  upload.single('scan'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const scanType = req.params['scanType'] as 'seller' | 'returned';
      if (!['seller', 'returned'].includes(scanType)) {
        return res.status(400).json({ error: 'scanType must be seller or returned' });
      }

      const user = req.user as AuthenticatedUser;
      const otp = await txService.uploadOtpScan({
        transactionId: req.params['id'] as string,
        scanType,
        fileBuffer: req.file.buffer,
        originalFilename: req.file.originalname,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/otp-panel', { otp });
      }
      res.json({ otp });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/otp/review — mark agent review complete
transactionRouter.post(
  '/agent/transactions/:id/otp/review',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const otp = await txService.markOtpReviewed({
        transactionId: req.params['id'] as string,
        notes: req.body.notes as string | undefined,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/otp-panel', { otp });
      }
      res.json({ otp });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/invoice/upload — upload commission invoice PDF
transactionRouter.post(
  '/agent/transactions/:id/invoice/upload',
  ...agentAuth,
  upload.single('invoice'),
  ...validateUploadInvoice,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const user = req.user as AuthenticatedUser;
      const invoice = await txService.uploadInvoice({
        transactionId: req.params['id'] as string,
        fileBuffer: req.file.buffer,
        originalFilename: req.file.originalname,
        invoiceNumber: req.body.invoiceNumber as string,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/invoice-panel', { invoice });
      }
      res.status(201).json({ invoice });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/invoice/send — send invoice to client
transactionRouter.post(
  '/agent/transactions/:id/invoice/send',
  ...agentAuth,
  ...validateSendInvoice,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const invoice = await txService.sendInvoice({
        transactionId: req.params['id'] as string,
        sellerId: req.body.sellerId as string,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/invoice-panel', { invoice });
      }
      res.json({ invoice });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/invoice/paid — mark invoice as paid
transactionRouter.post(
  '/agent/transactions/:id/invoice/paid',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const invoice = await txService.markInvoicePaid({
        transactionId: req.params['id'] as string,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/invoice-panel', { invoice });
      }
      res.json({ invoice });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/transactions/:id/invoice/file — authenticated file download
transactionRouter.get(
  '/agent/transactions/:id/invoice/file',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invoice = await txService.getTransaction(req.params['id'] as string);
      const invoicePath = (invoice as { commissionInvoice?: { invoiceFilePath?: string | null } })
        .commissionInvoice?.invoiceFilePath;
      if (!invoicePath) return res.status(404).json({ error: 'No invoice file found' });

      // Files are served through this authenticated route — never directly via nginx
      const buffer = await localStorage.read(invoicePath);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="invoice-${req.params['id']}.pdf"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
);
