// src/domains/content/testimonial.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as contentService from './content.service';
import * as contentRepo from './content.repository';
import { validateTestimonialSubmit } from './content.validator';
import { NotFoundError, ValidationError } from '@/domains/shared/errors';

export const testimonialRouter = Router();

testimonialRouter.get('/testimonial/thankyou', (_req: Request, res: Response) => {
  res.render('pages/public/testimonial-thankyou');
});

testimonialRouter.get('/testimonial/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const testimonial = await contentRepo.findTestimonialByToken(req.params.token);
    if (!testimonial) return res.status(404).render('pages/public/testimonial-expired', { notFound: true });
    if (!testimonial.tokenExpiresAt || testimonial.tokenExpiresAt < new Date()) {
      return res.status(410).render('pages/public/testimonial-expired', { expired: true });
    }
    if (testimonial.status !== 'pending_submission') {
      return res.redirect('/testimonial/thankyou');
    }
    return res.render('pages/public/testimonial-form', { token: req.params.token, testimonial });
  } catch (err) {
    next(err);
  }
});

testimonialRouter.post(
  '/testimonial/:token',
  validateTestimonialSubmit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const testimonial = await contentRepo.findTestimonialByToken(req.params.token);
        return res.status(422).render('pages/public/testimonial-form', {
          token: req.params.token,
          testimonial,
          errors: errors.array(),
          values: req.body,
        });
      }

      await contentService.submitTestimonial(req.params.token, {
        content: req.body.content as string,
        rating: Number(req.body.rating),
        sellerName: req.body.sellerName as string,
        sellerTown: req.body.sellerTown as string,
      });

      return res.redirect('/testimonial/thankyou');
    } catch (err) {
      if (err instanceof NotFoundError) return res.status(404).render('pages/public/testimonial-expired', { notFound: true });
      if (err instanceof ValidationError) return res.status(410).render('pages/public/testimonial-expired', { expired: true });
      next(err);
    }
  },
);
