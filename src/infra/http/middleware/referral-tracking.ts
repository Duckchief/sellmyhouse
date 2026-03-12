// src/infra/http/middleware/referral-tracking.ts
import type { Request, Response, NextFunction } from 'express';
import { trackReferralClick } from '@/domains/content/content.service';

/**
 * Reads ?ref=CODE from the query string, persists it in the session,
 * and atomically increments the referral click count (fire-and-forget).
 * Must be mounted BEFORE the lead router so the session is populated
 * before lead form submission.
 */
export function referralTrackingMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const code = req.query['ref'];
  if (typeof code === 'string' && code.length > 0) {
    req.session.referralCode = code;
    trackReferralClick(code)
      .catch(() => undefined)
      .finally(() => next());
    return;
  }
  next();
}
