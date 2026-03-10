import {
  AppError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ComplianceError,
  UnauthorizedError,
  ConflictError,
} from './errors';

describe('AppError', () => {
  it('has correct defaults', () => {
    const err = new AppError('test', 400, 'TEST_ERROR');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('test');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('TEST_ERROR');
    expect(err.name).toBe('AppError');
  });
});

describe('NotFoundError', () => {
  it('creates 404 with entity name', () => {
    const err = new NotFoundError('Property', 'abc123');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Property not found: abc123');
  });

  it('creates 404 without id', () => {
    const err = new NotFoundError('Property');
    expect(err.message).toBe('Property not found');
  });
});

describe('ForbiddenError', () => {
  it('creates 403', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('accepts custom message', () => {
    const err = new ForbiddenError('Not your property');
    expect(err.message).toBe('Not your property');
  });
});

describe('ValidationError', () => {
  it('creates 400 with field errors', () => {
    const err = new ValidationError('Invalid input', { email: 'Required' });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.fields).toEqual({ email: 'Required' });
  });
});

describe('ComplianceError', () => {
  it('creates 403 for compliance blocks', () => {
    const err = new ComplianceError('Cannot proceed without signed agreement');
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('COMPLIANCE_ERROR');
  });
});

describe('UnauthorizedError', () => {
  it('creates 401', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });
});

describe('ConflictError', () => {
  it('creates 409', () => {
    const err = new ConflictError('Email already registered');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
  });
});
