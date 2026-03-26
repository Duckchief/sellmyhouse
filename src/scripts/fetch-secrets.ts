import { createHash } from 'crypto';

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
