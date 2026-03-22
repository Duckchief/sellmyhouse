import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import passport from 'passport';
import { validationResult } from 'express-validator';
import * as authRepo from './auth.repository';
import * as auditService from '../shared/audit.service';
import { ValidationError } from '../shared/errors';
import { resetPasswordRules } from './auth.validator';
import { authRateLimiter } from '../../infra/http/middleware/rate-limit';
import type { AuthenticatedUser } from './auth.types';
import bcrypt from 'bcrypt';

export const setupAccountRouter = Router();

const BCRYPT_ROUNDS = 12;

// GET /auth/setup-account?token=xxx — render "Set Your Password" form
setupAccountRouter.get(
  '/auth/setup-account',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawToken = req.query['token'] as string;
      if (!rawToken) {
        return res.status(400).render('pages/auth/setup-account-error', {
          pageTitle: 'Invalid Link',
          message: 'No setup token provided.',
        });
      }

      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      const seller = await authRepo.findSellerByResetToken(hashedToken);

      if (!seller || !seller.passwordResetExpiry || seller.passwordResetExpiry < new Date()) {
        return res.render('pages/auth/setup-account-error', {
          pageTitle: 'Link Expired',
          message: 'This setup link has expired or is invalid. Please ask your agent to resend it.',
        });
      }

      res.render('pages/auth/setup-account', {
        pageTitle: 'Set Up Your Account',
        token: rawToken,
        sellerName: seller.name,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/setup-account — set password and auto-login
setupAccountRouter.post(
  '/auth/setup-account',
  authRateLimiter,
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
        return res.status(400).render('pages/auth/setup-account', {
          pageTitle: 'Set Up Your Account',
          token: req.body.token,
          error: 'Password does not meet requirements',
        });
      }

      const rawToken = req.body.token as string;
      if (!rawToken) {
        throw new ValidationError('Invalid form submission');
      }

      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      const seller = await authRepo.findSellerByResetToken(hashedToken);

      if (!seller || !seller.passwordResetExpiry || seller.passwordResetExpiry < new Date()) {
        throw new ValidationError('This setup link has expired or is invalid');
      }

      // Set the password
      const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
      await authRepo.updateSellerPasswordHash(seller.id, passwordHash);
      await authRepo.clearSellerPasswordResetToken(seller.id);
      await authRepo.invalidateUserSessions(seller.id);

      await auditService.log({
        action: 'auth.account_setup_completed',
        entityType: 'seller',
        entityId: seller.id,
        details: {},
        actorType: 'seller' as const,
        actorId: seller.id,
      });

      // Auto-login
      passport.authenticate(
        'seller-local',
        (err: Error | null, user: AuthenticatedUser | false) => {
          if (err || !user) {
            // Fallback: redirect to login if auto-login fails
            if (req.headers['hx-request']) {
              res.set('HX-Redirect', '/auth/login?setup=success');
              return res.sendStatus(200);
            }
            return res.redirect('/auth/login?setup=success');
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
      if (err instanceof ValidationError) {
        if (req.headers['hx-request']) {
          return res.render('partials/auth/form-error', { message: err.message });
        }
        return res.render('pages/auth/setup-account-error', {
          pageTitle: 'Setup Failed',
          message: err.message,
        });
      }
      next(err);
    }
  },
);
