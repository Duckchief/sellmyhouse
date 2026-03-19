import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as authService from './auth.service';
import * as auditService from '../shared/audit.service';
import { totpValidation, backupCodeValidation } from './auth.validator';
import { requireAuth } from '../../infra/http/middleware/require-auth';
import type { AuthenticatedUser } from './auth.types';

export const twoFactorRouter = Router();

// ─── 2FA Setup ─────────────────────────────────────────────

twoFactorRouter.get('/auth/2fa/setup', requireAuth(), (req: Request, res: Response) => {
  res.render('pages/auth/2fa-setup');
});

twoFactorRouter.post(
  '/auth/2fa/setup',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await authService.setup2FA(user.id, user.role, req.session.id);

      // Update session timeout to 30 min now that 2FA is enabled (Amendment E)
      if (req.session) {
        req.session.cookie.maxAge = 30 * 60 * 1000;
      }

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

twoFactorRouter.get('/auth/2fa/verify', requireAuth(), (_req: Request, res: Response) => {
  res.render('pages/auth/2fa-verify');
});

twoFactorRouter.post(
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
        return res
          .status(400)
          .render('pages/auth/2fa-verify', { error: 'Enter a valid 6-digit code' });
      }

      const user = req.user as AuthenticatedUser;
      let isValid: boolean;
      try {
        isValid = await authService.verify2FA({
          userId: user.id,
          role: user.role,
          token: req.body.token,
        });
      } catch (err) {
        // Log 2FA lockout
        await auditService.log({
          action: 'auth.2fa_locked',
          entityType: user.role === 'seller' ? 'Seller' : 'Agent',
          entityId: user.id,
          details: {},
        });
        throw err;
      }

      if (!isValid) {
        await auditService.log({
          action: 'auth.2fa_failed',
          entityType: user.role === 'seller' ? 'Seller' : 'Agent',
          entityId: user.id,
          details: {},
        });
        if (req.headers['hx-request']) {
          return res.status(401).render('partials/auth/form-error', {
            message: 'Invalid verification code',
          });
        }
        return res
          .status(401)
          .render('pages/auth/2fa-verify', { error: 'Invalid verification code' });
      }

      await auditService.log({
        action: 'auth.2fa_verified',
        entityType: user.role === 'seller' ? 'Seller' : 'Agent',
        entityId: user.id,
        details: {},
      });

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

twoFactorRouter.post(
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
        return res
          .status(400)
          .render('pages/auth/2fa-verify', { error: 'Please enter a backup code' });
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
