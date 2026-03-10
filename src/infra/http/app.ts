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

function validateEnv() {
  const required = ['SESSION_SECRET', 'DATABASE_URL', 'ENCRYPTION_KEY'];
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

  // Security
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"], // HTMX needs inline for hx-on
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

  // Routes
  app.use(healthRouter);
  app.use(publicRouter);
  app.use(leadRouter);
  app.use(authRouter);
  app.use(agentSettingsRouter);
  app.use('/api', apiRateLimiter);
  app.use(notificationRouter);

  // Error handling (must be last)
  app.use(errorHandler);

  return app;
}
