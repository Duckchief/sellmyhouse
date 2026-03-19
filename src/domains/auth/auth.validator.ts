import { body } from 'express-validator';

export const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone')
    .trim()
    .matches(/^[89]\d{7}$/)
    .withMessage('Valid Singapore phone number is required (8 digits starting with 8 or 9)'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('consentService')
    .custom((value) => value === 'true' || value === true || value === 'on')
    .withMessage('You must consent to our service terms'),
  body('consentHuttonsTransfer')
    .custom((value) => value === 'true' || value === true || value === 'on')
    .withMessage('You must consent to data transfer to Huttons Asia Pte Ltd'),
];

export const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

export const totpValidation = [
  body('token').trim().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Enter a 6-digit code'),
];

export const backupCodeValidation = [
  body('code').trim().notEmpty().withMessage('Backup code is required'),
];

export const forgotPasswordRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
];

export const resetPasswordRules = [
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('password')
    .matches(/[a-zA-Z]/)
    .withMessage('Password must contain at least one letter'),
  body('password').matches(/[0-9]/).withMessage('Password must contain at least one number'),
];
