// src/domains/seller/case-flag.validator.ts
import { body, param } from 'express-validator';

const VALID_FLAG_TYPES = [
  'deceased_estate', 'divorce', 'mop_not_met', 'eip_restriction',
  'pr_quota', 'bank_loan', 'court_order', 'other',
] as const;

const VALID_STATUSES = ['identified', 'in_progress', 'resolved', 'out_of_scope'] as const;

export const validateCreateCaseFlag = [
  param('id').isString().notEmpty().withMessage('Seller ID is required'),
  body('flagType')
    .isIn(VALID_FLAG_TYPES)
    .withMessage(`flagType must be one of: ${VALID_FLAG_TYPES.join(', ')}`),
  body('description').isString().trim().notEmpty().withMessage('Description is required'),
];

export const validateUpdateCaseFlag = [
  param('flagId').isString().notEmpty().withMessage('Flag ID is required'),
  body('status')
    .isIn(VALID_STATUSES)
    .withMessage(`status must be one of: ${VALID_STATUSES.join(', ')}`),
  body('guidanceProvided').optional().isString().trim(),
];
