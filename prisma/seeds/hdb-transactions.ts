// prisma/seeds/hdb-transactions.ts
import { createReadStream } from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';

const CSV_FILES = [
  'Resale_Flat_Prices_Based_on_Approval_Date_1990__1999.csv',
  'Resale_Flat_Prices_Based_on_Approval_Date_2000__Feb2012.csv',
  'Resale_Flat_Prices_Based_on_Registration_Date_From_Mar_2012_to_Dec_2014.csv',
  'Resale_Flat_Prices_Based_on_Registration_Date_From_Jan_2015_to_Dec_2016.csv',
  'Resale_flat_prices_based_on_registration_date_from_Jan2017_onwards.csv',
];

const BATCH_SIZE = 5000;
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'hdb');

interface CsvRow {
  month: string;
  town: string;
  flat_type: string;
  block: string;
  street_name: string;
  storey_range: string;
  floor_area_sqm: string;
  flat_model: string;
  lease_commence_date: string;
  remaining_lease?: string;
  resale_price: string;
}

function parseRemainingLease(value?: string): string | null {
  if (!value || value === '') return null;
  if (/^\d+$/.test(value.trim())) return `${value.trim()} years`;
  return value.trim();
}

function mapRow(row: CsvRow) {
  return {
    id: createId(),
    month: row.month,
    town: row.town,
    flatType: row.flat_type,
    block: row.block,
    streetName: row.street_name,
    storeyRange: row.storey_range,
    floorAreaSqm: parseFloat(row.floor_area_sqm),
    flatModel: row.flat_model,
    leaseCommenceDate: parseInt(row.lease_commence_date, 10),
    remainingLease: parseRemainingLease(row.remaining_lease),
    resalePrice: parseFloat(row.resale_price),
    source: 'csv_seed' as const,
  };
}

async function processFile(prisma: PrismaClient, filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const records: ReturnType<typeof mapRow>[] = [];
    let totalInserted = 0;

    const parser = createReadStream(filePath).pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }),
    );
    // NOTE: Loads all records into memory before inserting.
    // Monitor RAM during first production seed (~972K records).
    // Convert to streaming if memory constrained.
    parser.on('data', (row: CsvRow) => {
      records.push(mapRow(row));
    });

    parser.on('error', reject);

    parser.on('end', async () => {
      try {
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
          const batch = records.slice(i, i + BATCH_SIZE);
          await prisma.hdbTransaction.createMany({ data: batch });
          totalInserted += batch.length;
          if (totalInserted % 50000 === 0 || totalInserted === records.length) {
            process.stdout.write(`\r  Inserted ${totalInserted}/${records.length} records`);
          }
        }
        console.log();
        resolve(totalInserted);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function seedHdbTransactions(prisma: PrismaClient): Promise<void> {
  const existingCount = await prisma.hdbTransaction.count();
  if (existingCount > 0) {
    console.log(`HDB transactions already seeded (${existingCount} records). Skipping.`);
    return;
  }

  let grandTotal = 0;
  for (const file of CSV_FILES) {
    const filePath = path.join(DATA_DIR, file);
    console.log(`Processing: ${file}`);
    const count = await processFile(prisma, filePath);
    grandTotal += count;
  }

  console.log(`Total HDB transactions seeded: ${grandTotal}`);
}
