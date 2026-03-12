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
