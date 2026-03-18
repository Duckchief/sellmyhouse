import { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../error-handler';
import { UnauthorizedError, NotFoundError } from '../../../../domains/shared/errors';

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    render: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/test',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

const next = jest.fn() as unknown as NextFunction;

describe('errorHandler', () => {
  describe('browser requests (no hx-request, Accept: text/html)', () => {
    it('redirects to /auth/login for 401', () => {
      const req = mockReq({ headers: { accept: 'text/html' }, originalUrl: '/profile' });
      const res = mockRes();
      errorHandler(new UnauthorizedError('Authentication required'), req, res, next);
      expect(res.redirect).toHaveBeenCalledWith('/auth/login?next=%2Fprofile');
    });

    it('renders error page for unhandled 500', () => {
      const req = mockReq({ headers: { accept: 'text/html' } });
      const res = mockRes();
      errorHandler(new Error('boom'), req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.render).toHaveBeenCalledWith(
        'pages/error',
        expect.objectContaining({ statusCode: 500, code: 'INTERNAL_ERROR' }),
      );
    });
  });

  describe('HTMX requests (hx-request header present)', () => {
    it('renders inline partial for AppError', () => {
      const req = mockReq({ headers: { 'hx-request': '1', accept: 'text/html' } });
      const res = mockRes();
      errorHandler(new NotFoundError('Not found'), req, res, next);
      expect(res.render).toHaveBeenCalledWith('partials/error-message', expect.anything());
    });
  });

  describe('API requests (Accept: application/json)', () => {
    it('returns JSON for AppError', () => {
      const req = mockReq({ headers: { accept: 'application/json' } });
      const res = mockRes();
      errorHandler(new UnauthorizedError('Authentication required'), req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.anything() }));
    });

    it('returns JSON for unhandled error', () => {
      const req = mockReq({ headers: { accept: 'application/json' } });
      const res = mockRes();
      errorHandler(new Error('boom'), req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.anything() }));
    });
  });
});
