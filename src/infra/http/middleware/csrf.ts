// src/infra/http/middleware/csrf.ts
import { doubleCsrf } from 'csrf-csrf';
import type { Request, Response, NextFunction } from 'express';

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => {
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error('SESSION_SECRET environment variable is required');
    return secret;
  },
  // Empty string identifier: classic double-submit cookie pattern (no session binding).
  // Session binding is desirable in theory but breaks with saveUninitialized:false because
  // the session ID isn't stable before the first authenticated request.
  // Security is maintained by the HMAC secret + SameSite=strict cookie.
  getSessionIdentifier: () => '',
  cookieName: process.env.NODE_ENV === 'production' ? '__Host-csrf' : '_csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  },
  size: 64,
  getCsrfTokenFromRequest: (req) =>
    (req.headers['x-csrf-token'] as string | undefined) ??
    (req.body as Record<string, string> | undefined)?._csrf,
});

/**
 * CSRF protection middleware — wraps doubleCsrfProtection so we can skip
 * webhook/API-key routes that do not rely on browser session cookies.
 *
 * Skipped paths:
 *   - /api/webhook/*  (HMAC-verified, no session)
 *   - /health         (internal probe, no session)
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  const skip = req.path.startsWith('/api/webhook/') || req.path === '/health';
  if (skip) return next();
  doubleCsrfProtection(req, res, next);
}

/**
 * Injects `csrfToken` into res.locals so every template can render it.
 * Registered globally after session init so it's available on every response.
 */
export function injectCsrfToken(req: Request, res: Response, next: NextFunction): void {
  try {
    res.locals.csrfToken = generateCsrfToken(req, res);
  } catch {
    // generateCsrfToken may throw on malformed cookies — overwrite and continue
    res.locals.csrfToken = generateCsrfToken(req, res, { overwrite: true });
  }
  next();
}
