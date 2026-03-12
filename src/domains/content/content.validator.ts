// src/domains/content/content.validator.ts
import { body } from 'express-validator';

const VIDEO_CATEGORIES = ['photography', 'forms', 'process', 'financial'];

export const validateTutorialCreate = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('youtubeUrl').trim().notEmpty().isURL().withMessage('A valid YouTube URL is required'),
  body('category')
    .trim()
    .notEmpty()
    .isIn(VIDEO_CATEGORIES)
    .withMessage('Category must be one of: photography, forms, process, financial'),
  body('slug').optional().trim(),
  body('description').optional().trim(),
  body('orderIndex').optional().isInt({ min: 0 }).toInt(),
];

export const validateTutorialUpdate = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('youtubeUrl').trim().notEmpty().isURL().withMessage('A valid YouTube URL is required'),
  body('category')
    .trim()
    .notEmpty()
    .isIn(VIDEO_CATEGORIES)
    .withMessage('Category must be one of: photography, forms, process, financial'),
  body('slug').optional().trim(),
  body('description').optional().trim(),
  body('orderIndex').optional().isInt({ min: 0 }).toInt(),
];
