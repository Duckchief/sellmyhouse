import { param, body } from 'express-validator';

const VALID_ENTITY_TYPES = [
  'financial_report',
  'listing_description',
  'listing_photos',
  'weekly_update',
  'document_checklist',
];

export const validateEntityParams = [
  param('entityType').isIn(VALID_ENTITY_TYPES).withMessage('Invalid entity type'),
  param('entityId').isString().notEmpty().withMessage('Entity ID required'),
];

export const validateRejectBody = [
  body('reviewNotes').isString().trim().notEmpty().withMessage('Rejection notes are required'),
];
