import { PrismaClient } from '@prisma/client';

const testDatabaseUrl =
  process.env.DATABASE_URL_TEST ||
  'postgresql://smhn:smhn_test@localhost:5433/sellmyhomenow_test';

export const testPrisma = new PrismaClient({
  datasources: {
    db: { url: testDatabaseUrl },
  },
  log: ['warn', 'error'],
});

export async function cleanDatabase() {
  const tablenames = await testPrisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename != '_prisma_migrations'`;

  for (const { tablename } of tablenames) {
    await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE`);
  }
}
