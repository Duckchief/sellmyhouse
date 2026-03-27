import { createHash } from 'crypto';
import * as https from 'https';
import * as fs from 'fs';

export interface OvhCredentials {
  endpoint: string;
  appKey: string;
  appSecret: string;
  consumerKey: string;
  projectId: string;
  region: string;
  vaultId: string;
}

export interface SignatureParams {
  appSecret: string;
  consumerKey: string;
  method: string;
  url: string;
  body: string;
  timestamp: string;
}

const REQUIRED_FIELDS = [
  'OVH_ENDPOINT',
  'OVH_APP_KEY',
  'OVH_APP_SECRET',
  'OVH_CONSUMER_KEY',
  'OVH_PROJECT_ID',
  'OVH_REGION',
  'OVH_VAULT_ID',
] as const;

const FIELD_MAP: Record<(typeof REQUIRED_FIELDS)[number], keyof OvhCredentials> = {
  OVH_ENDPOINT: 'endpoint',
  OVH_APP_KEY: 'appKey',
  OVH_APP_SECRET: 'appSecret',
  OVH_CONSUMER_KEY: 'consumerKey',
  OVH_PROJECT_ID: 'projectId',
  OVH_REGION: 'region',
  OVH_VAULT_ID: 'vaultId',
};

export function parseCredentials(content: string): OvhCredentials {
  const parsed: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    parsed[key] = value;
  }

  for (const field of REQUIRED_FIELDS) {
    if (!parsed[field]) {
      throw new Error(`Missing required credential: ${field}`);
    }
  }

  const result: Partial<OvhCredentials> = {};
  for (const field of REQUIRED_FIELDS) {
    result[FIELD_MAP[field]] = parsed[field];
  }

  return result as OvhCredentials;
}

export function computeSignature(params: SignatureParams): string {
  const toSign = [
    params.appSecret,
    params.consumerKey,
    params.method,
    params.url,
    params.body,
    params.timestamp,
  ].join('+');

  const hash = createHash('sha1').update(toSign).digest('hex');
  return `$1$${hash}`;
}

export function formatExportLine(key: string, value: string): string {
  const escaped = value.replace(/'/g, "'\"'\"'");
  return `export ${key}='${escaped}'`;
}

const ENDPOINT_MAP: Record<string, string> = {
  'ovh-eu': 'https://eu.api.ovh.com/v1',
  'ovh-ca': 'https://ca.api.ovh.com/v1',
  'ovh-us': 'https://api.us.ovhcloud.com/v1',
};

export function getApiBaseUrl(endpoint: string): string {
  const url = ENDPOINT_MAP[endpoint];
  if (!url) throw new Error(`Unknown OVH endpoint: ${endpoint}`);
  return url;
}

function httpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function buildAuthHeaders(
  creds: OvhCredentials,
  method: string,
  url: string,
  body: string,
  timestamp: string,
): Record<string, string> {
  return {
    'X-Ovh-Application': creds.appKey,
    'X-Ovh-Consumer': creds.consumerKey,
    'X-Ovh-Timestamp': timestamp,
    'X-Ovh-Signature': computeSignature({
      appSecret: creds.appSecret,
      consumerKey: creds.consumerKey,
      method,
      url,
      body,
      timestamp,
    }),
    'Content-Type': 'application/json',
  };
}

export async function fetchSecrets(creds: OvhCredentials): Promise<Record<string, string>> {
  const baseUrl = getApiBaseUrl(creds.endpoint);

  // Step 1: Get server time for signature synchronisation
  const timeUrl = `${baseUrl}/auth/time`;
  const timeRes = await httpRequest(timeUrl, 'GET', {
    'X-Ovh-Application': creds.appKey,
  });
  if (timeRes.statusCode !== 200) {
    throw new Error(`OVHcloud API error (${timeRes.statusCode}): failed to get server time`);
  }
  const serverTime = timeRes.body.trim();

  // Step 2: List all secrets in the vault
  const listUrl = `${baseUrl}/cloud/project/${creds.projectId}/region/${creds.region}/secret`;
  const listHeaders = buildAuthHeaders(creds, 'GET', listUrl, '', serverTime);
  const listRes = await httpRequest(listUrl, 'GET', listHeaders);

  if (listRes.statusCode !== 200) {
    throw new Error(
      `OVHcloud API error (${listRes.statusCode}): failed to list secrets — ${listRes.body}`,
    );
  }

  const secretList: Array<{ id: string; name: string }> = JSON.parse(listRes.body);

  // Step 3: Fetch each secret's payload
  const secrets: Record<string, string> = {};

  for (const secret of secretList) {
    const secretUrl = `${baseUrl}/cloud/project/${creds.projectId}/region/${creds.region}/secret/${secret.id}`;
    const secretHeaders = buildAuthHeaders(creds, 'GET', secretUrl, '', serverTime);
    const secretRes = await httpRequest(secretUrl, 'GET', secretHeaders);

    if (secretRes.statusCode !== 200) {
      throw new Error(
        `OVHcloud API error (${secretRes.statusCode}): failed to fetch secret '${secret.name}'`,
      );
    }

    const parsed = JSON.parse(secretRes.body);
    secrets[parsed.name] = parsed.payload;
  }

  return secrets;
}

export async function main(): Promise<void> {
  const credPath = process.env['OVH_CREDENTIALS_PATH'];
  const nodeEnv = process.env['NODE_ENV'];

  // Skip in development or if no credentials path is set
  if (!credPath || nodeEnv === 'development') {
    return;
  }

  try {
    const content = fs.readFileSync(credPath, 'utf-8');
    const creds = parseCredentials(content);
    const secrets = await fetchSecrets(creds);

    for (const [key, value] of Object.entries(secrets)) {
      console.log(formatExportLine(key, value));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[fetch-secrets] Fatal: ${message}`);
    process.exit(1);
  }
}

// Run main when executed directly (not imported in tests)
if (require.main === module) {
  main();
}
