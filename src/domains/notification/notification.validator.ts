import { body, param } from 'express-validator';

export const webhookPayloadRules = [body('entry').isArray().withMessage('entry must be an array')];

export const markAsReadRules = [
  param('id').isString().notEmpty().withMessage('Notification ID is required'),
];
