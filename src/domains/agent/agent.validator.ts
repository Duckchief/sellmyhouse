import { query } from 'express-validator';

export const validateSellerListQuery = [
  query('status')
    .optional()
    .isIn(['lead', 'engaged', 'active', 'completed', 'archived'])
    .withMessage('Invalid status'),
  query('town').optional().isString().trim(),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('leadSource')
    .optional()
    .isIn(['website', 'tiktok', 'instagram', 'referral', 'walkin', 'other'])
    .withMessage('Invalid lead source'),
  query('search').optional().isString().trim().isLength({ max: 100 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];
