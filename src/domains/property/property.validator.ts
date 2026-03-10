import { body, param } from 'express-validator';
import { HDB_TOWNS, HDB_FLAT_TYPES } from './property.types';

export const validatePropertyCreate = [
  body('town')
    .trim()
    .notEmpty()
    .withMessage('Town is required')
    .isIn([...HDB_TOWNS])
    .withMessage('Invalid town'),
  body('street').trim().notEmpty().withMessage('Street name is required'),
  body('block').trim().notEmpty().withMessage('Block number is required'),
  body('flatType')
    .trim()
    .notEmpty()
    .withMessage('Flat type is required')
    .isIn([...HDB_FLAT_TYPES])
    .withMessage('Invalid flat type'),
  body('storeyRange').trim().notEmpty().withMessage('Storey range is required'),
  body('floorAreaSqm')
    .isFloat({ min: 30, max: 300 })
    .withMessage('Floor area must be between 30 and 300 sqm')
    .toFloat(),
  body('flatModel').trim().notEmpty().withMessage('Flat model is required'),
  body('leaseCommenceDate')
    .isInt({ min: 1960, max: new Date().getFullYear() })
    .withMessage('Invalid lease commencement date')
    .toInt(),
  body('remainingLease').optional().trim(),
  body('askingPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Asking price must be a positive number')
    .toFloat(),
];

export const validatePropertyUpdate = [
  body('town')
    .optional()
    .trim()
    .isIn([...HDB_TOWNS])
    .withMessage('Invalid town'),
  body('street').optional().trim().notEmpty().withMessage('Street name cannot be empty'),
  body('block').optional().trim().notEmpty().withMessage('Block number cannot be empty'),
  body('flatType')
    .optional()
    .trim()
    .isIn([...HDB_FLAT_TYPES])
    .withMessage('Invalid flat type'),
  body('storeyRange').optional().trim().notEmpty(),
  body('floorAreaSqm').optional().isFloat({ min: 30, max: 300 }).toFloat(),
  body('flatModel').optional().trim().notEmpty(),
  body('leaseCommenceDate')
    .optional()
    .isInt({ min: 1960, max: new Date().getFullYear() })
    .toInt(),
  body('remainingLease').optional().trim(),
  body('askingPrice').optional().isFloat({ min: 0 }).toFloat(),
];

export const validatePhotoReorder = [
  body('photoIds').isArray({ min: 1 }).withMessage('Photo IDs array is required'),
  body('photoIds.*').isString().withMessage('Each photo ID must be a string'),
];

export const validatePhotoId = [
  param('id').isString().notEmpty().withMessage('Photo ID is required'),
];
