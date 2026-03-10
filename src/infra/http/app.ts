import express from 'express';
import nunjucks from 'nunjucks';
import helmet from 'helmet';
import path from 'path';
import { requestLogger } from './middleware/request-logger';
import { errorHandler } from './middleware/error-handler';
import { healthRouter } from './health.router';

export function createApp() {
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
        },
      },
    }),
  );

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static files
  app.use(express.static(path.resolve('public')));

  // Request logging (skip health checks)
  if (process.env.NODE_ENV !== 'test') {
    app.use(requestLogger);
  }

  // Routes
  app.use(healthRouter);

  // Error handling (must be last)
  app.use(errorHandler);

  return app;
}
