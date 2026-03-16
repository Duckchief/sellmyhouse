// src/domains/compliance/compliance.validator.ts
import { body } from 'express-validator';

export const withdrawConsentValidator = [
  body('type')
    .isIn(['service', 'marketing'])
    .withMessage('Consent type must be "service" or "marketing"'),
  body('channel')
    .optional()
    .isIn(['web', 'email', 'whatsapp', 'phone', 'in_person'])
    .withMessage('Invalid withdrawal channel'),
];

export const createCorrectionValidator = [
  body('fieldName')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Field name is required')
    .isIn(['name', 'email', 'phone', 'notificationPreference', 'nricLast4'])
    .withMessage('Invalid field name for correction'),
  body('currentValue').optional().isString().trim(),
  body('requestedValue').isString().trim().notEmpty().withMessage('Requested value is required'),
  body('reason').optional().isString().trim().isLength({ max: 500 }),
];

export const processCorrectionValidator = [
  body('decision')
    .isIn(['approve', 'reject'])
    .withMessage('Decision must be "approve" or "reject"'),
  body('processNotes').optional().isString().trim().isLength({ max: 1000 }),
];

export const createCddValidator = [
  body('fullName').isString().trim().notEmpty().withMessage('Full name is required'),
  body('nricLast4')
    .isString()
    .trim()
    .isLength({ min: 4, max: 4 })
    .withMessage('NRIC last 4 characters must be exactly 4 characters'),
  body('riskLevel')
    .optional()
    .isIn(['standard', 'enhanced'])
    .withMessage('Risk level must be "standard" or "enhanced"'),
  body('notes')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 2000 }),
  body('dateOfBirth').optional().isISO8601().withMessage('Invalid date format'),
  body('nationality').optional().isString().trim().isLength({ max: 100 }),
  body('occupation').optional().isString().trim().isLength({ max: 100 }),
];

export const createEaaValidator = [
  body('agreementType')
    .optional()
    .isIn(['exclusive', 'non_exclusive'])
    .withMessage('Agreement type must be "exclusive" or "non_exclusive"'),
  body('commissionAmount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Commission amount must be a positive number'),
  body('commissionGstInclusive').optional().isBoolean(),
  body('coBrokingAllowed').optional().isBoolean(),
  body('coBrokingTerms').optional().isString().trim().isLength({ max: 2000 }),
  body('expiryDate').optional().isISO8601().withMessage('Invalid date format'),
];

export const updateEaaStatusValidator = [
  body('status')
    .isIn(['sent_to_seller', 'signed', 'active'])
    .withMessage('Status must be "sent_to_seller", "signed", or "active"'),
];

export const confirmExplanationValidator = [
  body('method')
    .isIn(['video_call', 'in_person'])
    .withMessage('Method must be "video_call" or "in_person"'),
  body('notes').optional().isString().trim().isLength({ max: 2000 }),
];
