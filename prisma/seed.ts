import { PrismaClient } from '@prisma/client';
import { seedSystemSettings } from './seeds/system-settings';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');
  await seedSystemSettings(prisma);
  // HDB transaction seed will be added in Task 10
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
