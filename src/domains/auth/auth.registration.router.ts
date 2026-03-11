import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { validationResult } from 'express-validator';
import * as authService from './auth.service';
import { registerValidation } from './auth.validator';
import { authRateLimiter } from '../../infra/http/middleware/rate-limit';
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

      await authService.registerSeller({
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

      // Auto-login after registration
      passport.authenticate(
        'seller-local',
        (err: Error | null, user: AuthenticatedUser | false) => {
          if (err || !user) {
            return res.redirect('/auth/login');
          }
          req.logIn(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            if (req.headers['hx-request']) {
              res.set('HX-Redirect', '/seller/dashboard');
              return res.sendStatus(200);
            }
            return res.redirect('/seller/dashboard');
          });
        },
      )(req, res, next);
    } catch (err) {
      next(err);
    }
  },
);
