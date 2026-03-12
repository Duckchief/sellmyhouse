// src/domains/offer/offer.validator.ts
import { body, param } from 'express-validator';

export const validateCreateOffer = [
  body('propertyId').notEmpty().withMessage('propertyId is required'),
  body('sellerId').notEmpty().withMessage('sellerId is required'),
  body('town').notEmpty().withMessage('town is required'),
  body('flatType').notEmpty().withMessage('flatType is required'),
  body('buyerName').notEmpty().trim().withMessage('buyerName is required'),
  body('buyerPhone').notEmpty().trim().withMessage('buyerPhone is required'),
  body('isCoBroke').isBoolean().withMessage('isCoBroke must be a boolean'),
  body('offerAmount').notEmpty().isNumeric().withMessage('offerAmount must be a number'),
];

export const validateCounterOffer = [
  param('id').notEmpty().withMessage('offerId is required'),
  body('counterAmount').notEmpty().isNumeric().withMessage('counterAmount must be a number'),
];

export const validateShareAnalysis = [
  param('id').notEmpty().withMessage('offerId is required'),
  body('sellerId').notEmpty().withMessage('sellerId is required'),
];
