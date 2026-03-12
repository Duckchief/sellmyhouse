import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { validationResult } from 'express-validator';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import * as authService from './auth.service';
import * as auditService from '../shared/audit.service';
import * as notificationService from '@/domains/notification/notification.service';
import { loginValidation, forgotPasswordRules, resetPasswordRules } from './auth.validator';
import { authRateLimiter } from '../../infra/http/middleware/rate-limit';
import { ValidationError } from '../shared/errors';
import type { AuthenticatedUser } from './auth.types';

export const loginRouter = Router();

// ─── Forgot-password rate limiter (Amendment I) ────────────

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many password reset requests. Please try again later.',
    },
  },
  keyGenerator: (req) => req.body?.email || ipKeyGenerator(req.ip ?? 'unknown'),
  skip: () => process.env.NODE_ENV === 'test',
});

// ─── Login ─────────────────────────────────────────────────

loginRouter.get('/auth/login', (_req: Request, res: Response) => {
  res.render('pages/auth/login');
});

loginRouter.post(
  '/auth/login/seller',
  authRateLimiter,
  loginValidation,
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      if (req.headers['hx-request']) {
        return res.status(400).render('partials/auth/form-error', {
          message: 'Invalid email or password',
        });
      }
      return res.status(400).render('pages/auth/login', { error: 'Invalid email or password' });
    }

    passport.authenticate('seller-local', (err: Error | null, user: AuthenticatedUser | false) => {
      if (err) return next(err);
      if (!user) {
        if (req.headers['hx-request']) {
          return res.status(401).render('partials/auth/form-error', {
            message: 'Invalid email or password',
          });
        }
        return res.status(401).render('pages/auth/login', { error: 'Invalid email or password' });
      }

      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);

        // Set session timeout based on 2FA status (Amendment E)
        if (user.twoFactorEnabled) {
          req.session.cookie.maxAge = 30 * 60 * 1000; // 30 min
        } else {
          req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 24 hours
        }

        if (user.twoFactorEnabled) {
          if (req.headers['hx-request']) {
            res.set('HX-Redirect', '/auth/2fa/verify');
            return res.sendStatus(200);
          }
          return res.redirect('/auth/2fa/verify');
        }

        if (req.headers['hx-request']) {
          res.set('HX-Redirect', '/seller/dashboard');
          return res.sendStatus(200);
        }
        return res.redirect('/seller/dashboard');
      });
    })(req, res, next);
  },
);

loginRouter.post(
  '/auth/login/agent',
  authRateLimiter,
  loginValidation,
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      if (req.headers['hx-request']) {
        return res.status(400).render('partials/auth/form-error', {
          message: 'Invalid email or password',
        });
      }
      return res.status(400).render('pages/auth/login', { error: 'Invalid email or password' });
    }

    passport.authenticate('agent-local', (err: Error | null, user: AuthenticatedUser | false) => {
      if (err) return next(err);
      if (!user) {
        if (req.headers['hx-request']) {
          return res.status(401).render('partials/auth/form-error', {
            message: 'Invalid email or password',
          });
        }
        return res.status(401).render('pages/auth/login', { error: 'Invalid email or password' });
      }

      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);

        if (user.twoFactorEnabled) {
          // Shrink cookie to 30 min for agents requiring 2FA
          if (req.session) {
            req.session.cookie.maxAge = 30 * 60 * 1000;
          }
          if (req.headers['hx-request']) {
            res.set('HX-Redirect', '/auth/2fa/verify');
            return res.sendStatus(200);
          }
          return res.redirect('/auth/2fa/verify');
        }

        // Agent must set up 2FA before accessing dashboard
        const redirectUrl = '/auth/2fa/setup';
        if (req.headers['hx-request']) {
          res.set('HX-Redirect', redirectUrl);
          return res.sendStatus(200);
        }
        return res.redirect(redirectUrl);
      });
    })(req, res, next);
  },
);

// ─── Logout ────────────────────────────────────────────────

loginRouter.post('/auth/logout', async (req: Request, res: Response) => {
  const user = req.user as AuthenticatedUser | undefined;
  if (user) {
    await auditService.log({
      action: 'auth.logout',
      entityType: user.role === 'seller' ? 'Seller' : 'Agent',
      entityId: user.id,
      details: {},
    });
  }
  req.logout(() => {
    req.session?.destroy(() => {
      res.redirect('/');
    });
  });
});

// ─── Forgot Password ────────────────────────────────────────

loginRouter.get('/auth/forgot-password', (_req: Request, res: Response) => {
  res.render('pages/auth/forgot-password');
});

loginRouter.post(
  '/auth/forgot-password',
  forgotPasswordLimiter,
  forgotPasswordRules,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.headers['hx-request']) {
          return res.render('partials/auth/form-error', { message: 'Please enter a valid email' });
        }
        return res
          .status(400)
          .render('pages/auth/forgot-password', { error: 'Please enter a valid email' });
      }

      // Try seller first, then agent — track which role matched for recipientType
      let recipientType: 'seller' | 'agent' = 'seller';
      let result = await authService.requestPasswordReset(req.body.email, 'seller');
      if (!result) {
        result = await authService.requestPasswordReset(req.body.email, 'agent');
        recipientType = 'agent';
      }

      if (result) {
        await notificationService.send(
          {
            recipientType,
            recipientId: result.userId,
            templateName: 'password_reset',
            templateData: {
              resetUrl: `https://sellmyhomenow.sg/auth/reset-password/${result.token}`,
            },
            preferredChannel: 'email',
          },
          'system',
        );
      }

      // Always show success message (prevent email enumeration)
      const message = 'If an account exists with that email, a reset link has been sent.';
      if (req.headers['hx-request']) {
        return res.render('partials/auth/form-success', { message });
      }
      res.render('pages/auth/forgot-password', { success: message });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Reset Password ─────────────────────────────────────────

loginRouter.get('/auth/reset-password/:token', (req: Request, res: Response) => {
  res.render('pages/auth/reset-password', { token: req.params.token as string });
});

loginRouter.post(
  '/auth/reset-password/:token',
  resetPasswordRules,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.headers['hx-request']) {
          return res.render('partials/auth/form-error', {
            message: 'Password does not meet requirements',
          });
        }
        return res.status(400).render('pages/auth/reset-password', {
          token: req.params.token,
          error: 'Password does not meet requirements',
        });
      }

      const token = req.params.token as string;

      // Try seller first, then agent
      try {
        await authService.resetPassword(token, req.body.password, 'seller');
      } catch (err) {
        if (err instanceof ValidationError) {
          await authService.resetPassword(token, req.body.password, 'agent');
        } else {
          throw err;
        }
      }

      if (req.headers['hx-request']) {
        res.set('HX-Redirect', '/auth/login');
        return res.sendStatus(200);
      }
      res.redirect('/auth/login?reset=success');
    } catch (err) {
      next(err);
    }
  },
);
