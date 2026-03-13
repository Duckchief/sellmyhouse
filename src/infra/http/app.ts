import crypto from 'crypto';
import express from 'express';
import nunjucks from 'nunjucks';
import helmet from 'helmet';
import path from 'path';
import passport from 'passport';
import { requestLogger } from './middleware/request-logger';
import { errorHandler } from './middleware/error-handler';
import { createSessionMiddleware } from './middleware/session';
import { configurePassport } from './middleware/passport';
import { apiRateLimiter } from './middleware/rate-limit';
import { healthRouter } from './health.router';
import { authRouter } from '../../domains/auth/auth.router';
import { agentSettingsRouter } from '../../domains/agent-settings/agent-settings.router';
import { notificationRouter } from '../../domains/notification/notification.router';
import { publicRouter } from '../../domains/public/public.router';
import { leadRouter } from '../../domains/lead/lead.router';
import { sellerRouter } from '../../domains/seller/seller.router';
import { propertyRouter } from '../../domains/property/property.router';
import { financialRouter } from '../../domains/property/financial.router';
import { viewingRouter } from '../../domains/viewing/viewing.router';
import { offerRouter } from '../../domains/offer/offer.router';
import { agentRouter } from '../../domains/agent/agent.router';
import { reviewRouter } from '../../domains/review/review.router';
import { adminRouter } from '../../domains/admin/admin.router';
import { complianceRouter } from '../../domains/compliance/compliance.router';
import { portalRouter } from '../../domains/property/portal.router';
import { transactionRouter } from '../../domains/transaction/transaction.router';
import { testimonialRouter } from '../../domains/content/testimonial.router';
import { referralTrackingMiddleware } from './middleware/referral-tracking';

function validateEnv() {
  const required = [
    'SESSION_SECRET',
    'DATABASE_URL',
    'ENCRYPTION_KEY',
    'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    'JWT_SECRET',
  ];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

export function createApp() {
  validateEnv();

  const app = express();

  // Nunjucks setup — resolve from project root so it works in both dev and Docker
  const viewsPath = process.env.VIEWS_PATH || path.resolve('src/views');
  const env = nunjucks.configure(viewsPath, {
    autoescape: true,
    express: app,
    watch: process.env.NODE_ENV === 'development',
  });

  // Add i18n filter stub (English passthrough for now)
  env.addFilter('t', (str: string) => str);

  // Add date filter for templates
  env.addFilter('date', (str: string, _format: string) => {
    if (str === 'now') return new Date().getFullYear().toString();
    return str;
  });

  // Add price formatting filter (e.g., 500000 → "500,000")
  env.addFilter('formatPrice', (val: unknown) => {
    const num = Number(val);
    return isNaN(num) ? String(val) : num.toLocaleString('en-SG');
  });

  app.set('view engine', 'njk');

  // Per-request CSP nonce — must be set before helmet so the nonce function can read it
  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });

  // Security
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            (req, res) => `'nonce-${(res as express.Response).locals.cspNonce}'`,
          ],
          styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
          fontSrc: ["'self'", 'fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          frameSrc: ['www.youtube.com'],
          workerSrc: ["'self'"],
        },
      },
    }),
  );

  // Body parsing
  // Raw body capture for WhatsApp webhook signature verification
  app.use(
    '/api/webhook/whatsapp',
    express.json({
      verify: (req: express.Request, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static files
  app.use(express.static(path.resolve('public')));

  // Session + Passport
  app.use(createSessionMiddleware());
  configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());

  // Request logging (skip in test)
  if (process.env.NODE_ENV !== 'test') {
    app.use(requestLogger);
  }

  // Referral tracking — global middleware, captures ?ref= on any page visit
  // Must be before publicRouter (homepage) and leadRouter (lead submission)
  app.use(referralTrackingMiddleware);

  // Routes
  app.use(healthRouter);
  app.use(publicRouter);
  app.use(testimonialRouter);
  app.use(leadRouter);
  app.use(authRouter);
  app.use(agentSettingsRouter);
  app.use('/api', apiRateLimiter);
  app.use(notificationRouter);
  app.use(sellerRouter);
  app.use(propertyRouter);
  app.use(financialRouter);
  app.use(viewingRouter);
  app.use(offerRouter);
  app.use(agentRouter);
  app.use(reviewRouter);
  app.use(adminRouter);
  app.use('/', complianceRouter);
  app.use(portalRouter);
  app.use(transactionRouter);

  // Error handling (must be last)
  app.use(errorHandler);

  return app;
}
