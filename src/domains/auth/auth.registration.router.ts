import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { validationResult } from 'express-validator';
import * as authService from './auth.service';
import { registerValidation } from './auth.validator';
import { authRateLimiter } from '../../infra/http/middleware/rate-limit';
import { requireAuth, requireRole } from '../../infra/http/middleware/require-auth';
import { ValidationError } from '../shared/errors';
import type { AuthenticatedUser } from './auth.types';

export const registrationRouter = Router();

// ─── Registration ──────────────────────────────────────────

registrationRouter.get('/auth/register', (_req: Request, res: Response) => {
  res.render('pages/auth/register');
});

registrationRouter.post(
  '/auth/register',
  authRateLimiter,
  registerValidation,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const errorMap: Record<string, string> = {};
        errors.array().forEach((e) => {
          if (e.type === 'field') errorMap[e.path] = e.msg;
        });

        if (req.headers['hx-request']) {
          return res.status(400).render('partials/auth/form-error', {
            message: Object.values(errorMap)[0],
            errors: errorMap,
          });
        }
        return res
          .status(400)
          .render('pages/auth/register', { errors: errorMap, values: req.body });
      }

      const seller = await authService.registerSeller({
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        password: req.body.password,
        consentService: true,
        consentMarketing:
          req.body.consentMarketing === 'true' || req.body.consentMarketing === 'on',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      if (!seller) {
        // Duplicate email — show identical response to prevent enumeration
        if (req.headers['hx-request']) {
          res.set('HX-Redirect', '/auth/login?registered=1');
          return res.sendStatus(200);
        }
        return res.redirect('/auth/login?registered=1');
      }

      // Auto-login after registration
      passport.authenticate(
        'seller-local',
        (err: Error | null, user: AuthenticatedUser | false) => {
          if (err || !user) {
            return res.redirect('/auth/login?registered=1');
          }
          // Regenerate session to prevent session fixation
          req.session.regenerate((regenErr) => {
            if (regenErr) return next(regenErr);

            req.logIn(user, (loginErr) => {
              if (loginErr) return next(loginErr);
              if (req.headers['hx-request']) {
                res.set('HX-Redirect', '/seller/dashboard');
                return res.sendStatus(200);
              }
              return res.redirect('/seller/dashboard');
            });
          });
        },
      )(req, res, next);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Email Verification ────────────────────────────────────

const resendVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  keyGenerator: (req) => (req.user as { id?: string })?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  skip: () => process.env.NODE_ENV === 'test',
});

registrationRouter.get(
  '/auth/verify-email/:token',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.verifyEmail(req.params.token as string);
      return res.redirect('/seller/dashboard?verified=1');
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).render('pages/auth/verify-email-error', {
          message: 'This verification link is invalid or has expired.',
        });
      }
      next(err);
    }
  },
);

registrationRouter.post(
  '/auth/resend-verification',
  requireAuth(),
  requireRole('seller'),
  resendVerificationLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as { id: string };
      await authService.resendVerificationEmail(user.id);
      if (req.headers['hx-request']) {
        return res.render('partials/auth/form-success', {
          message: 'Verification email sent. Please check your inbox.',
        });
      }
      return res.redirect('/seller/dashboard?resent=1');
    } catch (err) {
      next(err);
    }
  },
);
