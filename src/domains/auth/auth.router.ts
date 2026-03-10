import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { validationResult } from 'express-validator';
import * as authService from './auth.service';
import { registerValidation, loginValidation, totpValidation, backupCodeValidation } from './auth.validator';
import { authRateLimiter } from '../../infra/http/middleware/rate-limit';
import { requireAuth } from '../../infra/http/middleware/require-auth';
import type { AuthenticatedUser } from './auth.types';

export const authRouter = Router();

// ─── Registration ──────────────────────────────────────────

authRouter.get('/auth/register', (_req: Request, res: Response) => {
  res.render('pages/auth/register');
});

authRouter.post(
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
        return res.status(400).render('pages/auth/register', { errors: errorMap, values: req.body });
      }

      await authService.registerSeller({
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        password: req.body.password,
        consentService: true,
        consentMarketing: req.body.consentMarketing === 'true' || req.body.consentMarketing === 'on',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      // Auto-login after registration
      passport.authenticate('seller-local', (err: Error | null, user: AuthenticatedUser | false) => {
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
      })(req, res, next);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Login ─────────────────────────────────────────────────

authRouter.get('/auth/login', (_req: Request, res: Response) => {
  res.render('pages/auth/login');
});

authRouter.post(
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

authRouter.post(
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

        if (req.headers['hx-request']) {
          res.set('HX-Redirect', '/agent/dashboard');
          return res.sendStatus(200);
        }
        return res.redirect('/agent/dashboard');
      });
    })(req, res, next);
  },
);

// ─── Logout ────────────────────────────────────────────────

authRouter.post('/auth/logout', (req: Request, res: Response) => {
  req.logout(() => {
    req.session?.destroy(() => {
      res.redirect('/');
    });
  });
});

// ─── 2FA Setup ─────────────────────────────────────────────

authRouter.get('/auth/2fa/setup', requireAuth(), (req: Request, res: Response) => {
  res.render('pages/auth/2fa-setup');
});

authRouter.post(
  '/auth/2fa/setup',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await authService.setup2FA(user.id, user.role);

      if (req.headers['hx-request']) {
        return res.render('pages/auth/2fa-setup', {
          qrCodeDataUrl: result.qrCodeDataUrl,
          backupCodes: result.backupCodes,
          showConfirm: true,
        });
      }

      res.render('pages/auth/2fa-setup', {
        qrCodeDataUrl: result.qrCodeDataUrl,
        backupCodes: result.backupCodes,
        showConfirm: true,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── 2FA Verify ────────────────────────────────────────────

authRouter.get('/auth/2fa/verify', requireAuth(), (_req: Request, res: Response) => {
  res.render('pages/auth/2fa-verify');
});

authRouter.post(
  '/auth/2fa/verify',
  requireAuth(),
  totpValidation,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.headers['hx-request']) {
          return res.status(400).render('partials/auth/form-error', {
            message: 'Enter a valid 6-digit code',
          });
        }
        return res.status(400).render('pages/auth/2fa-verify', { error: 'Enter a valid 6-digit code' });
      }

      const user = req.user as AuthenticatedUser;
      const isValid = await authService.verify2FA({
        userId: user.id,
        role: user.role,
        token: req.body.token,
      });

      if (!isValid) {
        if (req.headers['hx-request']) {
          return res.status(401).render('partials/auth/form-error', {
            message: 'Invalid verification code',
          });
        }
        return res.status(401).render('pages/auth/2fa-verify', { error: 'Invalid verification code' });
      }

      // Update session to mark 2FA as verified
      user.twoFactorVerified = true;
      req.logIn(user, (err) => {
        if (err) return next(err);

        // Shrink cookie for agents
        if (user.role === 'agent' || user.role === 'admin') {
          if (req.session) {
            req.session.cookie.maxAge = 30 * 60 * 1000;
          }
        }

        const redirect = user.role === 'seller' ? '/seller/dashboard' : '/agent/dashboard';
        if (req.headers['hx-request']) {
          res.set('HX-Redirect', redirect);
          return res.sendStatus(200);
        }
        return res.redirect(redirect);
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Backup Code ───────────────────────────────────────────

authRouter.post(
  '/auth/2fa/backup',
  requireAuth(),
  backupCodeValidation,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.headers['hx-request']) {
          return res.status(400).render('partials/auth/form-error', {
            message: 'Please enter a backup code',
          });
        }
        return res.status(400).render('pages/auth/2fa-verify', { error: 'Please enter a backup code' });
      }

      const user = req.user as AuthenticatedUser;
      const isValid = await authService.verifyBackupCode({
        userId: user.id,
        role: user.role,
        code: req.body.code,
      });

      if (!isValid) {
        if (req.headers['hx-request']) {
          return res.status(401).render('partials/auth/form-error', {
            message: 'Invalid backup code',
          });
        }
        return res.status(401).render('pages/auth/2fa-verify', { error: 'Invalid backup code' });
      }

      // Mark 2FA as verified in session
      user.twoFactorVerified = true;
      req.logIn(user, (err) => {
        if (err) return next(err);

        const redirect = user.role === 'seller' ? '/seller/dashboard' : '/agent/dashboard';
        if (req.headers['hx-request']) {
          res.set('HX-Redirect', redirect);
          return res.sendStatus(200);
        }
        return res.redirect(redirect);
      });
    } catch (err) {
      next(err);
    }
  },
);
