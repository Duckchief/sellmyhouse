import { query } from 'express-validator';

export const validateSellerListQuery = [
  query('status')
    .optional({ values: 'falsy' })
    .isIn(['lead', 'engaged', 'active', 'completed', 'archived'])
    .withMessage('Invalid status'),
  query('town').optional({ values: 'falsy' }).isString().trim(),
  query('dateFrom').optional({ values: 'falsy' }).isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional({ values: 'falsy' }).isISO8601().withMessage('Invalid date format'),
  query('leadSource')
    .optional({ values: 'falsy' })
    .isIn(['website', 'tiktok', 'instagram', 'referral', 'walkin', 'other'])
    .withMessage('Invalid lead source'),
  query('search').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];
