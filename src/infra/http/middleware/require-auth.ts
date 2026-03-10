import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError, ForbiddenError } from '../../../domains/shared/errors';
import type { AuthenticatedUser, UserRole } from '../../../domains/auth/auth.types';

export function requireAuth() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
      return next(new UnauthorizedError());
    }
    next();
  };
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    const user = req.user as AuthenticatedUser;
    if (!roles.includes(user.role)) {
      return next(new ForbiddenError('You do not have permission to access this resource'));
    }
    next();
  };
}

export function requireTwoFactor() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    const user = req.user as AuthenticatedUser;
    if (user.twoFactorEnabled && !user.twoFactorVerified) {
      if (req.headers['hx-request']) {
        return res.status(403).render('partials/auth/form-error', {
          message: 'Please complete 2FA verification first',
        });
      }
      return res.redirect('/auth/2fa/verify');
    }
    next();
  };
}

export function requireOwnership(getOwnerId: (req: Request) => string | Promise<string>) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    const user = req.user as AuthenticatedUser;

    // Admin can access anything
    if (user.role === 'admin') {
      return next();
    }

    try {
      const ownerId = await getOwnerId(req);
      if (ownerId !== user.id) {
        return next(new ForbiddenError('You can only access your own resources'));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
