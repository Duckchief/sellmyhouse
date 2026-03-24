import type { Request, Response, NextFunction } from 'express';
import * as portalService from '@/domains/property/portal.service';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

/**
 * Injects portalsReadyCount into res.locals for all /agent pages.
 * Used by the agent sidebar to show the Portals nav badge.
 * Non-fatal: if the query fails, the badge simply won't show.
 */
export async function portalsReadyBadgeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user as AuthenticatedUser | undefined;
    if (user) {
      const agentId = user.role === 'admin' ? undefined : user.id;
      res.locals.portalsReadyCount = await portalService.getPortalsReadyCount(agentId);
    }
  } catch {
    // Non-fatal — badge simply won't show
  }
  next();
}
