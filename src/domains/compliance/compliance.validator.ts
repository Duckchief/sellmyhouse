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
