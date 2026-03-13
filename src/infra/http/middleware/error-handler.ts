import { Request, Response, NextFunction } from 'express';
import { logger } from '../../logger';
import { AppError, ConflictError } from '../../../domains/shared/errors';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
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

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
