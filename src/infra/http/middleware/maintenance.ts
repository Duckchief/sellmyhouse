import { Request, Response, NextFunction } from 'express';
import * as settingsService from '@/domains/shared/settings.service';
import { MemoryCache } from '@/infra/cache/memory-cache';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

const cache = new MemoryCache();
const CACHE_TTL = 30_000; // 30 seconds

// Exported for testing only
export function __clearMaintenanceCache(): void {
  cache.clear();
}

export async function maintenanceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    let isOn = cache.get<string>('maintenance_mode');
    if (isOn === undefined) {
      isOn = await settingsService.get('maintenance_mode', 'false');
      cache.set('maintenance_mode', isOn, CACHE_TTL);
    }

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

    let maintenanceMessage = cache.get<string>('maintenance_message');
    if (maintenanceMessage === undefined) {
      maintenanceMessage = await settingsService.get('maintenance_message', '');
      cache.set('maintenance_message', maintenanceMessage, CACHE_TTL);
    }

    let maintenanceEta = cache.get<string>('maintenance_eta');
    if (maintenanceEta === undefined) {
      maintenanceEta = await settingsService.get('maintenance_eta', '');
      cache.set('maintenance_eta', maintenanceEta, CACHE_TTL);
    }

    res.status(503);
    res.setHeader('Retry-After', '3600');
    res.render('pages/public/maintenance', { maintenanceMessage, maintenanceEta });
  } catch (err) {
    // If DB is unreachable we cannot check maintenance mode — fail open
    // so a DB outage doesn't make every request crash with an unhandled error.
    const errName = err instanceof Error ? (err as Error & { name: string }).name : '';
    if (errName === 'PrismaClientInitializationError') {
      return next();
    }
    next(err);
  }
}
