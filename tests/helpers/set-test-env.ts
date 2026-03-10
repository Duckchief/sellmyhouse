// Set DATABASE_URL to test DB for all integration test workers
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ||
  'postgresql://smhn:smhn_dev@localhost:5432/sellmyhomenow_test';
process.env.NODE_ENV = 'test';
