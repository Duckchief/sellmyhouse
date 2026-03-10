// Set DATABASE_URL to test DB for all integration test workers
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST || 'postgresql://smhn:smhn_test@localhost:5433/sellmyhomenow_test';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-must-be-long-enough-for-testing';
process.env.ENCRYPTION_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
