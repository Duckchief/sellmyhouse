import { PrismaClient } from '@prisma/client';
import { seedSystemSettings } from './seeds/system-settings';
import { seedHdbTransactions } from './seeds/hdb-transactions';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');
  await seedSystemSettings(prisma);
  await seedHdbTransactions(prisma);
  console.log('Seed completed.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
