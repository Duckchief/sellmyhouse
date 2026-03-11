import { body } from 'express-validator';

export const whatsappSettingsRules = [
  body('whatsapp_phone_number_id')
    .isString()
    .trim()
    .notEmpty()
    .isLength({ max: 500 })
    .withMessage('Phone Number ID is required (max 500 chars)'),
  body('whatsapp_api_token')
    .isString()
    .trim()
    .notEmpty()
    .isLength({ max: 500 })
    .withMessage('API Token is required (max 500 chars)'),
  body('whatsapp_business_account_id')
    .isString()
    .trim()
    .notEmpty()
    .isLength({ max: 500 })
    .withMessage('Business Account ID is required (max 500 chars)'),
];

export const smtpSettingsRules = [
  body('smtp_host').isString().trim().notEmpty().withMessage('SMTP host is required'),
  body('smtp_port')
    .isInt({ min: 1, max: 65535 })
    .withMessage('Port must be between 1 and 65535'),
  body('smtp_user').isString().trim().notEmpty().withMessage('SMTP user is required'),
  body('smtp_pass').isString().trim().notEmpty().withMessage('SMTP password is required'),
  body('smtp_from_email').isEmail().withMessage('Valid from email is required'),
  body('smtp_from_name')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('From name max 100 chars'),
];
