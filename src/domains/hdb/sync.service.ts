// src/domains/hdb/sync.service.ts
import axios from 'axios';
import { createId } from '@/infra/database/prisma';
import { logger } from '@/infra/logger';
import * as auditService from '@/domains/shared/audit.service';
import { HdbRepository } from './repository';
import type { HdbDataSyncRecord } from './types';

const RETRYABLE_NETWORK_ERRORS = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'];

const DATASET_ID = 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc';
const BASE_URL = 'https://data.gov.sg/api/action/datastore_search';
const PAGE_SIZE = 10000;
const REQUEST_DELAY_MS = 5000;
const MAX_RETRIES = 5;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ApiRecord {
  _id: number;
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

function mapApiRecord(record: ApiRecord) {
  return {
    id: String(record._id),
    month: record.month,
    town: record.town,
    flatType: record.flat_type === 'MULTI GENERATION' ? 'MULTI-GENERATION' : record.flat_type,
    block: record.block,
    streetName: record.street_name,
    storeyRange: record.storey_range,
    floorAreaSqm: parseFloat(record.floor_area_sqm),
    flatModel: record.flat_model,
    leaseCommenceDate: parseInt(record.lease_commence_date, 10),
    remainingLease: record.remaining_lease || null,
    resalePrice: parseFloat(record.resale_price),
    source: 'datagov_sync' as const,
  };
}

export class HdbSyncService {
  constructor(private readonly repo: HdbRepository = new HdbRepository()) {}

  async sync(): Promise<HdbDataSyncRecord> {
    const startTime = Date.now();
    let recordsAdded = 0;

    try {
      const latestMonth = await this.repo.getLatestMonth();

      // Guard: if no existing data, the CSV seed should be used instead
      if (!latestMonth) {
        logger.warn('No existing HDB data found. Run the CSV seed first (npx prisma db seed).');
        const syncLog = await this.repo.createSyncLog({
          id: createId(),
          recordsAdded: 0,
          recordsTotal: 0,
          source: DATASET_ID,
          status: 'success',
        });
        return syncLog;
      }

      let offset = 0;
      let hasMore = true;
      let pageNum = 0;

      while (hasMore) {
        pageNum++;
        if (pageNum > 1) await delay(REQUEST_DELAY_MS);

        const response = await this.fetchWithRetry(offset);
        const { records, total } = response.data.result;

        if (!records || records.length === 0) {
          hasMore = false;
          break;
        }

        // Filter to only new records
        const newRecords = latestMonth
          ? records.filter((r: ApiRecord) => r.month >= latestMonth)
          : records;

        // Early exit: sorted newest-first
        if (latestMonth && newRecords.length === 0) {
          hasMore = false;
          break;
        }

        if (newRecords.length > 0) {
          const mapped = newRecords.map(mapApiRecord);
          const inserted = await this.repo.createManyTransactions(mapped);
          recordsAdded += inserted;
        }

        offset += PAGE_SIZE;
        hasMore = offset < total;
      }

      const totalRecords = await this.repo.countTransactions();

      const syncLog = await this.repo.createSyncLog({
        id: createId(),
        recordsAdded,
        recordsTotal: totalRecords,
        source: DATASET_ID,
        status: 'success',
      });

      logger.info(
        { recordsAdded, totalRecords, durationMs: Date.now() - startTime },
        'HDB data sync completed',
      );

      // A6: Audit sync completion
      await auditService.log({
        action: 'hdb.sync_completed',
        entityType: 'hdb_data_sync',
        entityId: syncLog.id,
        details: { recordsAdded, recordsTotal: totalRecords },
      });

      return syncLog;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'HDB data sync failed');

      const failedSyncLog = await this.repo.createSyncLog({
        id: createId(),
        recordsAdded,
        recordsTotal: 0,
        source: DATASET_ID,
        status: 'failed',
        error: message,
      });

      // A6: Audit sync failure
      await auditService.log({
        action: 'hdb.sync_failed',
        entityType: 'hdb_data_sync',
        entityId: failedSyncLog.id,
        details: { error: message },
      });

      throw error;
    }
  }

  private async fetchWithRetry(offset: number, retries = MAX_RETRIES) {
    const headers: Record<string, string> = {};
    if (process.env.DATAGOV_API_KEY) {
      headers.Authorization = process.env.DATAGOV_API_KEY;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await axios.get(BASE_URL, {
          params: {
            resource_id: DATASET_ID,
            limit: PAGE_SIZE,
            offset,
            sort: 'month desc',
          },
          headers,
        });
      } catch (err) {
        // E2: Retry on 429 rate limit and transient network errors
        const isRateLimit = axios.isAxiosError(err) && err.response?.status === 429;
        const isNetworkError =
          axios.isAxiosError(err) &&
          !err.response &&
          err.code !== undefined &&
          RETRYABLE_NETWORK_ERRORS.includes(err.code);

        if ((isRateLimit || isNetworkError) && attempt < retries) {
          const retryAfterMs =
            isRateLimit && err.response?.headers['retry-after']
              ? parseInt(err.response.headers['retry-after'], 10) * 1000
              : 0;
          const exponentialMs = 5000 * Math.pow(2, attempt - 1);
          const waitMs = Math.max(exponentialMs, retryAfterMs);
          const reason = isRateLimit
            ? 'rate limited'
            : `network error (${(err as { code?: string }).code})`;
          logger.warn({ attempt, waitMs }, `data.gov.sg ${reason}, retrying`);
          await delay(waitMs);
          continue;
        }
        throw err;
      }
    }
    throw new Error('Max retries exceeded');
  }
}
