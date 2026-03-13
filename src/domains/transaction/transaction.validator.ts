// src/domains/transaction/transaction.validator.ts
import { body, param } from 'express-validator';

export const validateCreateTransaction = [
  body('propertyId').notEmpty().withMessage('propertyId is required'),
  body('sellerId').notEmpty().withMessage('sellerId is required'),
  body('offerId').notEmpty().withMessage('offerId is required'),
  body('agreedPrice').notEmpty().withMessage('agreedPrice is required'),
];

export const validateAdvanceStatus = [
  param('id').notEmpty().withMessage('transactionId is required'),
  body('status')
    .notEmpty()
    .isIn(['option_exercised', 'completing', 'completed'])
    .withMessage('status must be a valid transaction status'),
];

export const validateMarkFallenThrough = [
  param('transactionId').notEmpty().isString().withMessage('transactionId is required'),
  body('sellerId').notEmpty().withMessage('sellerId is required'),
  body('reason').isLength({ min: 10 }).withMessage('reason must be at least 10 characters'),
];

export const validateCreateOtp = [
  param('id').notEmpty().withMessage('transactionId is required'),
  body('hdbSerialNumber').notEmpty().withMessage('hdbSerialNumber is required'),
];

export const validateUploadInvoice = [
  param('id').notEmpty().withMessage('transactionId is required'),
  body('invoiceNumber').notEmpty().withMessage('invoiceNumber is required'),
];

export const validateUpdateHdb = [param('id').notEmpty().withMessage('transactionId is required')];

export const validateSendInvoice = [
  param('id').notEmpty().withMessage('transactionId is required'),
  body('sellerId').notEmpty().withMessage('sellerId is required'),
];
