import { execSync } from 'child_process';

export default async function setup() {
  // Ensure test database is migrated
  process.env.DATABASE_URL =
    process.env.DATABASE_URL_TEST ||
    'postgresql://smh:smh_test@localhost:5433/smh_test';

  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    });
  } catch (err) {
    console.error('Failed to migrate test database. Is the test DB running?');
    console.error('Run: npm run docker:test:db');
    throw err;
  }
}
