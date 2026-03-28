import crypto from 'crypto';
import { Readable } from 'stream';
import { logger } from '@/infra/logger';

export interface ScanResult {
  isClean: boolean;
  viruses: string[];
}

let scannerEnabled = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clamInstance: any = null;

/**
 * Initialize ClamAV scanner.
 * Fails gracefully if ClamAV is not installed (logs warning, scanning disabled).
 * This allows development without ClamAV while enforcing it in production.
 */
export async function initVirusScanner(): Promise<void> {
  try {
    const NodeClam = (await import('clamscan')).default;
    clamInstance = await new NodeClam().init({
      removeInfected: false,
      quarantineInfected: false,
      debugMode: false,
      clamdscan: {
        socket: '/var/run/clamav/clamd.ctl',
        timeout: 30000,
        localFallback: true,
      },
      preference: 'clamdscan',
    });
    scannerEnabled = true;
    logger.info('ClamAV virus scanner initialized');
  } catch (err) {
    scannerEnabled = false;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ err }, 'ClamAV not available in production — file uploads will be BLOCKED');
    } else {
      logger.warn('ClamAV not available — virus scanning disabled in development');
    }
  }
}

/**
 * Scan a file buffer for viruses.
 * In production: throws if ClamAV unavailable (fail-closed).
 * In development/test: logs warning and returns clean if ClamAV unavailable.
 */
export async function scanBuffer(buffer: Buffer, filename: string): Promise<ScanResult> {
  if (!scannerEnabled || !clamInstance) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Virus scanner unavailable — file uploads blocked in production');
    }
    const fileHash = filename
      ? crypto.createHash('sha256').update(filename).digest('hex').slice(0, 8)
      : 'unknown';
    logger.warn({ fileHash }, 'Virus scan skipped (ClamAV unavailable)');
    return { isClean: true, viruses: [] };
  }

  try {
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    const { isInfected, viruses } = await clamInstance.scanStream(stream);

    if (isInfected) {
      const fileHash = filename
        ? crypto.createHash('sha256').update(filename).digest('hex').slice(0, 8)
        : 'unknown';
      logger.error({ fileHash, viruses }, 'VIRUS DETECTED in upload');
    }

    return {
      isClean: !isInfected,
      viruses: viruses || [],
    };
  } catch (err) {
    const fileHash = filename
      ? crypto.createHash('sha256').update(filename).digest('hex').slice(0, 8)
      : 'unknown';
    logger.error({ err, fileHash }, 'Virus scan error');
    // Fail-closed: treat scan errors as infected in production
    if (process.env.NODE_ENV === 'production') {
      return { isClean: false, viruses: ['SCAN_ERROR'] };
    }
    return { isClean: true, viruses: [] };
  }
}
