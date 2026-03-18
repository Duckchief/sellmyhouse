import { Request, Response, NextFunction } from 'express';
import * as settingsService from '@/domains/shared/settings.service';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

export async function maintenanceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const isOn = await settingsService.get('maintenance_mode', 'false');
    if (isOn !== 'true') {
      return next();
    }

    // Admin, health, and webhook routes always bypass
    if (
      req.path === '/health' ||
      req.path.startsWith('/admin') ||
      req.path.startsWith('/api/webhook')
    ) {
      return next();
    }

    // Admins and agents bypass
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      const user = req.user as AuthenticatedUser;
      if (user.role === 'admin' || user.role === 'agent') {
        return next();
      }
    }

    const maintenanceMessage = await settingsService.get('maintenance_message', '');
    const maintenanceEta = await settingsService.get('maintenance_eta', '');

    res.status(503);
    res.setHeader('Retry-After', '3600');
    res.render('pages/public/maintenance', { maintenanceMessage, maintenanceEta });
  } catch (err) {
    next(err);
  }
}
