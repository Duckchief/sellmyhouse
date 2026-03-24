import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
  },
  skipSuccessfulRequests: true,
  skip: () => process.env.NODE_ENV === 'test',
});

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
});

export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300, // 300 requests/min/IP — covers HTMX fragment loads
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please slow down.',
  skip: () => process.env.NODE_ENV === 'test',
});

export const leadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many submissions. Please try again later.' },
  },
  skip: () => process.env.NODE_ENV === 'test',
});

export const hdbRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
  skip: () => process.env.NODE_ENV === 'test',
});

export const offerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 offer actions per agent per hour
  keyGenerator: (req) =>
    (req.user as { id?: string } | undefined)?.id ?? ipKeyGenerator(req.ip ?? ''),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many offer requests. Please try again later.' },
  },
  skip: () => process.env.NODE_ENV === 'test',
});

export const resendVerificationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  keyGenerator: (req) => req.body?.email ?? ipKeyGenerator(req.ip ?? ''),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many resend attempts. Please try again later.' },
  },
  skip: () => process.env.NODE_ENV === 'test',
});

export const totpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 TOTP attempts per 15 minutes
  keyGenerator: (req) =>
    (req.user as { id?: string } | undefined)?.id ?? ipKeyGenerator(req.ip ?? ''),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many verification attempts. Please try again later.',
    },
  },
  skipSuccessfulRequests: true,
  skip: () => process.env.NODE_ENV === 'test',
});

export const descriptionGenerateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 generations per agent per hour
  keyGenerator: (req) =>
    (req.user as { id?: string } | undefined)?.id ?? ipKeyGenerator(req.ip ?? ''),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many description generation requests. Please try again later.',
    },
  },
  skip: () => process.env.NODE_ENV === 'test',
});
