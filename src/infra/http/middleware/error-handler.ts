import { Request, Response, NextFunction } from 'express';
import { logger } from '../../logger';
import { AppError, ConflictError } from '../../../domains/shared/errors';
import { AIUnavailableError } from '../../../domains/shared/ai/ai.facade';

function isBrowserRequest(req: Request): boolean {
  return !req.headers['hx-request'] && (req.headers['accept'] ?? '').includes('text/html');
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AIUnavailableError) {
    logger.warn({ err, path: req.path }, 'AIUnavailableError: all providers failed');
    if (req.headers['hx-request']) {
      return res.status(502).render('partials/error-message', {
        message: 'AI service is temporarily unavailable. Please try again.',
      });
    }
    return res.status(502).json({
      error: {
        code: 'AI_UNAVAILABLE',
        message: 'AI service is temporarily unavailable. Please try again.',
      },
    });
  }

  if (err instanceof AppError) {
    logger.warn({ err, path: req.path }, `${err.name}: ${err.message}`);

    // ConflictError messages can reveal sensitive information (e.g. whether a phone
    // number is registered). Send a generic client message while retaining the
    // original message in the server-side log above.
    const clientMessage =
      err instanceof ConflictError
        ? 'Unable to process your submission. Please try again.'
        : err.message;

    if (req.headers['hx-request']) {
      return res.status(err.statusCode).render('partials/error-message', {
        message: clientMessage,
      });
    }

    if (isBrowserRequest(req)) {
      // Redirect unauthenticated browser requests to the login page
      if (err.statusCode === 401) {
        return res.redirect(`/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
      }
      return res.status(err.statusCode).render('pages/error', {
        statusCode: err.statusCode,
        code: err.code,
      });
    }

    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: clientMessage,
      },
    });
  }

  logger.error({ err, path: req.path }, 'Unhandled error');

  if (req.headers['hx-request']) {
    return res.status(500).render('partials/error-message', {
      message: 'An unexpected error occurred',
    });
  }

  if (isBrowserRequest(req)) {
    return res.status(500).render('pages/error', {
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  }

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
