// src/domains/content/content.validator.ts
import { body } from 'express-validator';

export const validateTestimonialSubmit = [
  body('content')
    .trim()
    .notEmpty()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Testimonial must be 10\u20131000 characters'),
  body('rating').isInt({ min: 1, max: 5 }).toInt().withMessage('Rating must be between 1 and 5'),
  body('clientName').trim().notEmpty().withMessage('Name is required'),
  body('clientTown').trim().notEmpty().withMessage('Town is required'),
];

export const validateManualTestimonialCreate = [
  body('clientName')
    .trim()
    .notEmpty()
    .isLength({ max: 100 })
    .withMessage('Name is required (max 100 chars)'),
  body('clientTown')
    .trim()
    .notEmpty()
    .isLength({ max: 100 })
    .withMessage('Town is required (max 100 chars)'),
  body('rating').isInt({ min: 1, max: 5 }).toInt().withMessage('Rating must be 1–5'),
  body('content')
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Testimonial must be 10–1000 characters'),
  body('source').optional().trim().isLength({ max: 50 }),
];

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
