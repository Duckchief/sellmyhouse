# OVHcloud Secret Manager Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain-text `.env` files on the VPS with runtime secret fetching from OVHcloud Secret Manager, with separate staging and production environments.

**Architecture:** A TypeScript script (`src/scripts/fetch-secrets.ts`) authenticates to the OVHcloud API using a bootstrap credentials file and fetches all secrets at container startup. A shell entrypoint (`docker/entrypoint.sh`) orchestrates: fetch secrets → run migrations → start app. Nginx runs in a separate Docker container as a reverse proxy with SSL termination, and the staging environment is gated by HTTP Basic Auth.

**Tech Stack:** Node.js 22 built-ins (https, crypto, fs), Docker, Nginx, OVHcloud API v6, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-03-26-ovhcloud-secret-manager-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/scripts/fetch-secrets.ts` | OVHcloud API client — reads bootstrap credentials, authenticates, fetches all secrets from a vault, outputs `export KEY=VALUE` lines to stdout |
| `src/scripts/__tests__/fetch-secrets.test.ts` | Unit tests for credential parsing, HMAC signature computation, output formatting, and end-to-end fetch with mocked HTTP |
| `docker/entrypoint.sh` | Container startup script — sources fetched secrets, runs migrations, execs the app process |
| `docker/docker-compose.production.yml` | Production app container config (OVHcloud credentials mount, no `env_file`) |
| `docker/docker-compose.staging.yml` | Staging app container config (separate credentials, separate image tag) |
| `docker/nginx/docker-compose.yml` | Nginx reverse proxy container with SSL and certbot volume mounts |
| `docker/nginx/conf.d/production.conf` | Nginx server block for `sellmyhouse.sg` (SSL, proxy to `app-prod:3000`) |
| `docker/nginx/conf.d/staging.conf` | Nginx server block for `staging.sellmyhouse.sg` (SSL, Basic Auth, proxy to `app-staging:3000`) |

### Modified Files
| File | Change |
|------|--------|
| `docker/Dockerfile` | Add `COPY scripts` to builder, copy `entrypoint.sh` to runtime, change `CMD` to `ENTRYPOINT`, increase healthcheck `start-period` |
| `.github/workflows/deploy.yml` | Add `staging` branch trigger, set image tag per environment, remove `prisma migrate deploy` from SSH script, update deploy paths |

### Unchanged
| File | Why |
|------|-----|
| `src/server.ts` | `dotenv.config()` at top is harmless — silently no-ops when `.env` doesn't exist |
| `docker/docker-compose.yml` | Kept for local dev (uses `env_file: ../.env` as before) |
| `docker/docker-compose.dev.yml` | Local dev only |
| `docker/docker-compose.test.yml` | CI test only |

---

### Task 1: Credential Parsing and Signature Computation — Tests

**Files:**
- Create: `src/scripts/__tests__/fetch-secrets.test.ts`
- Create: `src/scripts/fetch-secrets.ts` (empty exports to satisfy imports)

- [ ] **Step 1: Create the test file with tests for credential parsing and signature computation**

```typescript
// src/scripts/__tests__/fetch-secrets.test.ts
import { parseCredentials, computeSignature, formatExportLine } from '../fetch-secrets';

describe('fetch-secrets', () => {
  describe('parseCredentials', () => {
    it('parses a valid credentials file', () => {
      const content = [
        'OVH_ENDPOINT=ovh-eu',
        'OVH_APP_KEY=app123',
        'OVH_APP_SECRET=secret456',
        'OVH_CONSUMER_KEY=consumer789',
        'OVH_PROJECT_ID=proj-abc',
        'OVH_REGION=sgp1',
        'OVH_VAULT_ID=vault-xyz',
      ].join('\n');

      const creds = parseCredentials(content);

      expect(creds).toEqual({
        endpoint: 'ovh-eu',
        appKey: 'app123',
        appSecret: 'secret456',
        consumerKey: 'consumer789',
        projectId: 'proj-abc',
        region: 'sgp1',
        vaultId: 'vault-xyz',
      });
    });

    it('throws on missing required field', () => {
      const content = [
        'OVH_ENDPOINT=ovh-eu',
        'OVH_APP_KEY=app123',
        // missing OVH_APP_SECRET and others
      ].join('\n');

      expect(() => parseCredentials(content)).toThrow(
        'Missing required credential: OVH_APP_SECRET',
      );
    });

    it('ignores blank lines and comments', () => {
      const content = [
        '# This is a comment',
        '',
        'OVH_ENDPOINT=ovh-eu',
        'OVH_APP_KEY=app123',
        'OVH_APP_SECRET=secret456',
        '  ',
        'OVH_CONSUMER_KEY=consumer789',
        'OVH_PROJECT_ID=proj-abc',
        'OVH_REGION=sgp1',
        'OVH_VAULT_ID=vault-xyz',
      ].join('\n');

      const creds = parseCredentials(content);
      expect(creds.appKey).toBe('app123');
    });
  });

  describe('computeSignature', () => {
    it('computes the OVHcloud HMAC-SHA1 signature', () => {
      // OVHcloud signature format:
      // "$1$" + SHA1(appSecret + "+" + consumerKey + "+" + method + "+" + url + "+" + body + "+" + timestamp)
      const sig = computeSignature({
        appSecret: 'secret456',
        consumerKey: 'consumer789',
        method: 'GET',
        url: 'https://eu.api.ovh.com/v1/auth/time',
        body: '',
        timestamp: '1711500000',
      });

      expect(sig).toMatch(/^\$1\$[a-f0-9]{40}$/);

      // Verify deterministic — same inputs produce same output
      const sig2 = computeSignature({
        appSecret: 'secret456',
        consumerKey: 'consumer789',
        method: 'GET',
        url: 'https://eu.api.ovh.com/v1/auth/time',
        body: '',
        timestamp: '1711500000',
      });
      expect(sig).toBe(sig2);
    });

    it('produces different signatures for different timestamps', () => {
      const params = {
        appSecret: 'secret456',
        consumerKey: 'consumer789',
        method: 'GET',
        url: 'https://eu.api.ovh.com/v1/auth/time',
        body: '',
      };

      const sig1 = computeSignature({ ...params, timestamp: '1711500000' });
      const sig2 = computeSignature({ ...params, timestamp: '1711500001' });
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('formatExportLine', () => {
    it('formats a simple key-value pair', () => {
      expect(formatExportLine('DATABASE_URL', 'postgresql://localhost/db')).toBe(
        "export DATABASE_URL='postgresql://localhost/db'",
      );
    });

    it('escapes single quotes in values', () => {
      expect(formatExportLine('KEY', "value'with'quotes")).toBe(
        "export KEY='value'\"'\"'with'\"'\"'quotes'",
      );
    });

    it('handles empty values', () => {
      expect(formatExportLine('EMPTY', '')).toBe("export EMPTY=''");
    });

    it('handles values with spaces and special characters', () => {
      expect(formatExportLine('PASS', 'p@ss w0rd!$&')).toBe(
        "export PASS='p@ss w0rd!$&'",
      );
    });
  });
});
```

- [ ] **Step 2: Create the stub implementation to satisfy imports**

```typescript
// src/scripts/fetch-secrets.ts

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

export function parseCredentials(_content: string): OvhCredentials {
  throw new Error('Not implemented');
}

export function computeSignature(_params: SignatureParams): string {
  throw new Error('Not implemented');
}

export function formatExportLine(_key: string, _value: string): string {
  throw new Error('Not implemented');
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/scripts/__tests__/fetch-secrets.test.ts --no-coverage`
Expected: FAIL — all tests fail with "Not implemented"

- [ ] **Step 4: Commit**

```bash
git add src/scripts/__tests__/fetch-secrets.test.ts src/scripts/fetch-secrets.ts
git commit -m "test(scripts): add failing tests for OVHcloud fetch-secrets"
```

---

### Task 2: Credential Parsing and Signature Computation — Implementation

**Files:**
- Modify: `src/scripts/fetch-secrets.ts`

- [ ] **Step 1: Implement `parseCredentials`**

```typescript
// Replace the stub parseCredentials in src/scripts/fetch-secrets.ts

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
```

- [ ] **Step 2: Implement `computeSignature`**

```typescript
// Replace the stub computeSignature in src/scripts/fetch-secrets.ts

import { createHash } from 'crypto';

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
```

- [ ] **Step 3: Implement `formatExportLine`**

```typescript
// Replace the stub formatExportLine in src/scripts/fetch-secrets.ts

export function formatExportLine(key: string, value: string): string {
  // Shell-safe: wrap in single quotes, escape embedded single quotes
  // with the '"'"' pattern (end quote, double-quoted single quote, resume quote)
  const escaped = value.replace(/'/g, "'\"'\"'");
  return `export ${key}='${escaped}'`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/scripts/__tests__/fetch-secrets.test.ts --no-coverage`
Expected: PASS — all 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/scripts/fetch-secrets.ts
git commit -m "feat(scripts): implement credential parsing, signature, and formatting"
```

---

### Task 3: Secret Fetching — Tests

**Files:**
- Modify: `src/scripts/__tests__/fetch-secrets.test.ts`

- [ ] **Step 1: Add tests for the HTTP-based secret fetching and main entry point**

Add to the end of `src/scripts/__tests__/fetch-secrets.test.ts`:

```typescript
import * as https from 'https';
import * as fs from 'fs';

// Mock https and fs
jest.mock('https');
jest.mock('fs');

import { fetchSecrets, getApiBaseUrl, main } from '../fetch-secrets';

describe('getApiBaseUrl', () => {
  it('maps ovh-eu to eu.api.ovh.com', () => {
    expect(getApiBaseUrl('ovh-eu')).toBe('https://eu.api.ovh.com/v1');
  });

  it('maps ovh-ca to ca.api.ovh.com', () => {
    expect(getApiBaseUrl('ovh-ca')).toBe('https://ca.api.ovh.com/v1');
  });

  it('maps ovh-us to api.us.ovhcloud.com', () => {
    expect(getApiBaseUrl('ovh-us')).toBe('https://api.us.ovhcloud.com/v1');
  });

  it('throws on unknown endpoint', () => {
    expect(() => getApiBaseUrl('ovh-invalid')).toThrow('Unknown OVH endpoint: ovh-invalid');
  });
});

describe('fetchSecrets', () => {
  const mockCredentials: import('../fetch-secrets').OvhCredentials = {
    endpoint: 'ovh-eu',
    appKey: 'app123',
    appSecret: 'secret456',
    consumerKey: 'consumer789',
    projectId: 'proj-abc',
    region: 'sgp1',
    vaultId: 'vault-xyz',
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('fetches time, lists secrets, fetches each payload', async () => {
    // Mock https.get/request to return responses in sequence:
    // 1. GET /auth/time → server timestamp
    // 2. GET /cloud/project/.../secret → list of secrets
    // 3. GET /cloud/project/.../secret/{id} → secret payload (one per secret)

    const mockRequest = https.request as jest.MockedFunction<typeof https.request>;

    // Helper to create a mock response
    const createMockResponse = (statusCode: number, body: string) => {
      return (_url: unknown, _opts: unknown, callback: (res: unknown) => void) => {
        const res = {
          statusCode,
          on: jest.fn((event: string, handler: (data?: unknown) => void) => {
            if (event === 'data') handler(Buffer.from(body));
            if (event === 'end') handler();
            return res;
          }),
        };
        callback(res);
        return {
          on: jest.fn().mockReturnThis(),
          end: jest.fn(),
        };
      };
    };

    mockRequest
      // 1. GET /auth/time
      .mockImplementationOnce(createMockResponse(200, '1711500000') as unknown as typeof https.request)
      // 2. GET /cloud/project/.../secret → list of secrets
      .mockImplementationOnce(
        createMockResponse(
          200,
          JSON.stringify([
            { id: 'sec-1', name: 'DATABASE_URL' },
            { id: 'sec-2', name: 'SESSION_SECRET' },
          ]),
        ) as unknown as typeof https.request,
      )
      // 3. GET secret sec-1 payload
      .mockImplementationOnce(
        createMockResponse(
          200,
          JSON.stringify({ name: 'DATABASE_URL', payload: 'postgresql://prod:pass@host/db' }),
        ) as unknown as typeof https.request,
      )
      // 4. GET secret sec-2 payload
      .mockImplementationOnce(
        createMockResponse(
          200,
          JSON.stringify({ name: 'SESSION_SECRET', payload: 'super-secret-session' }),
        ) as unknown as typeof https.request,
      );

    const secrets = await fetchSecrets(mockCredentials);

    expect(secrets).toEqual({
      DATABASE_URL: 'postgresql://prod:pass@host/db',
      SESSION_SECRET: 'super-secret-session',
    });

    // Should have made 4 HTTP requests total
    expect(mockRequest).toHaveBeenCalledTimes(4);
  });

  it('throws on non-200 response from secret list', async () => {
    const mockRequest = https.request as jest.MockedFunction<typeof https.request>;

    const createMockResponse = (statusCode: number, body: string) => {
      return (_url: unknown, _opts: unknown, callback: (res: unknown) => void) => {
        const res = {
          statusCode,
          on: jest.fn((event: string, handler: (data?: unknown) => void) => {
            if (event === 'data') handler(Buffer.from(body));
            if (event === 'end') handler();
            return res;
          }),
        };
        callback(res);
        return {
          on: jest.fn().mockReturnThis(),
          end: jest.fn(),
        };
      };
    };

    mockRequest
      .mockImplementationOnce(createMockResponse(200, '1711500000') as unknown as typeof https.request)
      .mockImplementationOnce(
        createMockResponse(403, JSON.stringify({ message: 'Forbidden' })) as unknown as typeof https.request,
      );

    await expect(fetchSecrets(mockCredentials)).rejects.toThrow('OVHcloud API error (403)');
  });
});

describe('main', () => {
  const originalEnv = process.env;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv };
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    jest.resetAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('skips when OVH_CREDENTIALS_PATH is not set', async () => {
    delete process.env['OVH_CREDENTIALS_PATH'];

    await main();

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('skips when NODE_ENV is development', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['OVH_CREDENTIALS_PATH'] = '/some/path';

    await main();

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('exits with code 1 when credentials file is missing', async () => {
    process.env['OVH_CREDENTIALS_PATH'] = '/nonexistent/path';
    process.env['NODE_ENV'] = 'production';

    const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    await main();

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `npx jest src/scripts/__tests__/fetch-secrets.test.ts --no-coverage`
Expected: FAIL — `getApiBaseUrl`, `fetchSecrets`, and `main` are not exported

- [ ] **Step 3: Commit**

```bash
git add src/scripts/__tests__/fetch-secrets.test.ts
git commit -m "test(scripts): add failing tests for secret fetching and main entry point"
```

---

### Task 4: Secret Fetching — Implementation

**Files:**
- Modify: `src/scripts/fetch-secrets.ts`

- [ ] **Step 1: Add `getApiBaseUrl`, the HTTP helper, `fetchSecrets`, and `main`**

Add to `src/scripts/fetch-secrets.ts` (after the existing exports):

```typescript
import * as https from 'https';
import * as fs from 'fs';

// Note: createHash import already exists from Task 2

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

export async function fetchSecrets(
  creds: OvhCredentials,
): Promise<Record<string, string>> {
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
```

- [ ] **Step 2: Run all tests to verify they pass**

Run: `npx jest src/scripts/__tests__/fetch-secrets.test.ts --no-coverage`
Expected: PASS — all tests pass

- [ ] **Step 3: Run the full unit test suite to check for regressions**

Run: `npm test`
Expected: All existing tests still pass

- [ ] **Step 4: Commit**

```bash
git add src/scripts/fetch-secrets.ts
git commit -m "feat(scripts): implement OVHcloud secret fetching with API auth"
```

---

### Task 5: Docker Entrypoint

**Files:**
- Create: `docker/entrypoint.sh`

- [ ] **Step 1: Create the entrypoint script**

```bash
#!/bin/sh
set -e

# Fetch secrets from OVHcloud Secret Manager
if [ -f "$OVH_CREDENTIALS_PATH" ]; then
  echo "[entrypoint] Fetching secrets from OVHcloud Secret Manager..."
  eval "$(node /app/dist/scripts/fetch-secrets.js)"
  echo "[entrypoint] Secrets loaded."
fi

# Run database migrations
echo "[entrypoint] Running database migrations..."
npx prisma migrate deploy

# Start the application
echo "[entrypoint] Starting application..."
exec node /app/dist/server.js
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x docker/entrypoint.sh`

- [ ] **Step 3: Commit**

```bash
git add docker/entrypoint.sh
git commit -m "feat(docker): add entrypoint script for secret fetch + migration + app start"
```

---

### Task 6: Dockerfile Updates

**Files:**
- Modify: `docker/Dockerfile`

- [ ] **Step 1: Update the Dockerfile**

Replace the entire `docker/Dockerfile` with:

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Generate Prisma client (must match Alpine runtime)
COPY prisma ./prisma
RUN npx prisma generate

# Compile TypeScript (includes src/scripts/fetch-secrets.ts → dist/scripts/fetch-secrets.js)
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Copy self-hosted HTMX
RUN cp node_modules/htmx.org/dist/htmx.min.js public/js/htmx.min.js

# Build Tailwind CSS
COPY tailwind.config.ts postcss.config.js ./
RUN npx tailwindcss -i src/views/styles/input.css -o public/css/output.css --minify

# Stage 2: Runtime
FROM node:22-alpine AS runner

WORKDIR /app

# Copy production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy Prisma client and schema
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

# Copy compiled app (includes dist/scripts/fetch-secrets.js)
COPY --from=builder /app/dist ./dist

# Copy views (Nunjucks templates needed at runtime)
COPY src/views ./src/views

# Copy public assets
COPY public ./public
COPY --from=builder /app/public/css/output.css ./public/css/output.css

# Copy entrypoint
COPY docker/entrypoint.sh /app/docker/entrypoint.sh
RUN chmod +x /app/docker/entrypoint.sh

# Create uploads directory
RUN mkdir -p uploads && chown -R node:node uploads

USER node

EXPOSE 3000

# Increase start-period to allow for secret fetch + migrations before health checks
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
```

Key changes from the original:
- `src/scripts/` is compiled as part of `npx tsc` (already inside `src/`, no tsconfig changes needed)
- `docker/entrypoint.sh` copied into runtime stage
- `CMD` replaced with `ENTRYPOINT`
- `HEALTHCHECK --start-period` increased from `10s` to `30s` to allow for secret fetch + migrations

- [ ] **Step 2: Verify the build still works locally**

Run: `docker build -f docker/Dockerfile -t sellmyhouse-test .`
Expected: Build succeeds. Verify `dist/scripts/fetch-secrets.js` exists in the image:

Run: `docker run --rm sellmyhouse-test ls dist/scripts/`
Expected: `fetch-secrets.js` (and `.js.map`, `.d.ts`)

- [ ] **Step 3: Commit**

```bash
git add docker/Dockerfile
git commit -m "feat(docker): update Dockerfile for entrypoint and fetch-secrets script"
```

---

### Task 7: Production and Staging Docker Compose Files

**Files:**
- Create: `docker/docker-compose.production.yml`
- Create: `docker/docker-compose.staging.yml`

- [ ] **Step 1: Create the production compose file**

```yaml
# docker/docker-compose.production.yml
services:
  app-prod:
    image: ghcr.io/${GITHUB_REPOSITORY:-local/sellmyhouse}:${IMAGE_TAG:-latest}
    container_name: app-prod
    expose:
      - "3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - BASE_URL=https://sellmyhouse.sg
      - OVH_CREDENTIALS_PATH=/run/secrets/ovh-credentials
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - uploads:/app/uploads
      - /opt/sellmyhouse/production/.ovh-credentials:/run/secrets/ovh-credentials:ro
    restart: unless-stopped
    networks:
      - smh_net
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"

networks:
  smh_net:
    external: true

volumes:
  uploads:
```

- [ ] **Step 2: Create the staging compose file**

```yaml
# docker/docker-compose.staging.yml
services:
  app-staging:
    image: ghcr.io/${GITHUB_REPOSITORY:-local/sellmyhouse}:${IMAGE_TAG:-staging}
    container_name: app-staging
    expose:
      - "3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - BASE_URL=https://staging.sellmyhouse.sg
      - OVH_CREDENTIALS_PATH=/run/secrets/ovh-credentials
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - uploads:/app/uploads
      - /opt/sellmyhouse/staging/.ovh-credentials:/run/secrets/ovh-credentials:ro
    restart: unless-stopped
    networks:
      - smh_net
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

networks:
  smh_net:
    external: true

volumes:
  uploads:
```

- [ ] **Step 3: Commit**

```bash
git add docker/docker-compose.production.yml docker/docker-compose.staging.yml
git commit -m "feat(docker): add production and staging compose files with OVHcloud secret mounts"
```

---

### Task 8: Nginx Reverse Proxy Configuration

**Files:**
- Create: `docker/nginx/docker-compose.yml`
- Create: `docker/nginx/conf.d/production.conf`
- Create: `docker/nginx/conf.d/staging.conf`

- [ ] **Step 1: Create the Nginx compose file**

```yaml
# docker/nginx/docker-compose.yml
services:
  nginx:
    image: nginx:alpine
    container_name: nginx-proxy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./conf.d:/etc/nginx/conf.d:ro
      - /opt/sellmyhouse/nginx/.htpasswd-staging:/etc/nginx/htpasswd-staging:ro
      - /opt/sellmyhouse/nginx/certbot/conf:/etc/letsencrypt:ro
      - /opt/sellmyhouse/nginx/certbot/www:/var/www/certbot:ro
    restart: unless-stopped
    networks:
      - smh_net
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

networks:
  smh_net:
    external: true
```

- [ ] **Step 2: Create the production Nginx config**

```nginx
# docker/nginx/conf.d/production.conf

server {
    listen 80;
    server_name sellmyhouse.sg www.sellmyhouse.sg;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://sellmyhouse.sg$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name sellmyhouse.sg www.sellmyhouse.sg;

    ssl_certificate     /etc/letsencrypt/live/sellmyhouse.sg/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sellmyhouse.sg/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    client_max_body_size 15M;

    location / {
        proxy_pass         http://app-prod:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        'upgrade';
        proxy_read_timeout 60s;
    }
}
```

- [ ] **Step 3: Create the staging Nginx config with Basic Auth**

```nginx
# docker/nginx/conf.d/staging.conf

server {
    listen 80;
    server_name staging.sellmyhouse.sg;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://staging.sellmyhouse.sg$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name staging.sellmyhouse.sg;

    ssl_certificate     /etc/letsencrypt/live/staging.sellmyhouse.sg/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/staging.sellmyhouse.sg/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Staging access control
    auth_basic           "Staging — Authorized Access Only";
    auth_basic_user_file /etc/nginx/htpasswd-staging;

    # Prevent indexing
    add_header X-Robots-Tag "noindex, nofollow" always;
    add_header X-Frame-Options "DENY" always;

    client_max_body_size 15M;

    location / {
        proxy_pass         http://app-staging:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        'upgrade';
        proxy_read_timeout 60s;
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add docker/nginx/
git commit -m "feat(nginx): add reverse proxy configs with staging Basic Auth and SSL"
```

---

### Task 9: CI/CD Workflow Update

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Replace the deploy workflow**

Replace the entire `.github/workflows/deploy.yml` with:

```yaml
name: CI/CD

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    runs-on: ubuntu-latest

    permissions:
      contents: read

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: smh_test
          POSTGRES_USER: smh
          POSTGRES_PASSWORD: smh_test
        ports:
          - 5433:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - run: npm ci

      - run: npx prisma generate

      - name: Run migrations on test DB
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://smh:smh_test@localhost:5433/smh_test

      - name: Type check
        run: npx tsc --noEmit

      - name: Lint
        run: npm run lint

      - name: Format check
        run: npm run format:check

      - name: Unit tests
        run: npm test

      - name: Integration tests
        run: npm run test:integration
        env:
          DATABASE_URL: postgresql://smh:smh_test@localhost:5433/smh_test
          DATABASE_URL_TEST: postgresql://smh:smh_test@localhost:5433/smh_test
          NODE_ENV: test
          SESSION_SECRET: test-session-secret

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/staging')

    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Set environment variables
        run: |
          echo "IMAGE_NAME_LC=${IMAGE_NAME,,}" >> "$GITHUB_ENV"
          if [ "${{ github.ref }}" = "refs/heads/main" ]; then
            echo "IMAGE_TAG=latest" >> "$GITHUB_ENV"
            echo "DEPLOY_ENV=production" >> "$GITHUB_ENV"
            echo "COMPOSE_FILE=docker/docker-compose.production.yml" >> "$GITHUB_ENV"
          else
            echo "IMAGE_TAG=staging" >> "$GITHUB_ENV"
            echo "DEPLOY_ENV=staging" >> "$GITHUB_ENV"
            echo "COMPOSE_FILE=docker/docker-compose.staging.yml" >> "$GITHUB_ENV"
          fi

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: docker/Dockerfile
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME_LC }}:${{ env.IMAGE_TAG }}
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME_LC }}:${{ github.sha }}

      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_SSH_PORT }}
          envs: DEPLOY_ENV,IMAGE_TAG,COMPOSE_FILE
          script: |
            cd ~/sellmyhouse-v2
            git pull --ff-only origin ${{ github.ref_name }}
            docker compose -f $COMPOSE_FILE pull
            docker compose -f $COMPOSE_FILE up -d
            sleep 5
            docker compose -f $COMPOSE_FILE ps
            docker image prune -f
            echo "Deployed $IMAGE_TAG to $DEPLOY_ENV: ${{ github.sha }}"
```

Key changes:
- Triggers on both `main` and `staging` branches
- Sets `IMAGE_TAG`, `DEPLOY_ENV`, and `COMPOSE_FILE` based on branch
- `git pull --ff-only` on VPS to get latest compose files
- No more `prisma migrate deploy` in the SSH script — handled by entrypoint
- References the environment-specific compose file

- [ ] **Step 2: Verify the workflow YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat(ci): update deploy workflow for staging/production with OVHcloud secrets"
```

---

### Task 10: VPS One-Time Setup

This task is not code — it documents the manual steps to run on the VPS. These steps are performed once by the developer via SSH.

**Prerequisites:** VPS has Docker installed, deploy user exists, DNS A records point to VPS IP for `sellmyhouse.sg`, `www.sellmyhouse.sg`, and `staging.sellmyhouse.sg`.

- [ ] **Step 1: Create the shared Docker network**

```bash
docker network create smh_net
```

- [ ] **Step 2: Install PostgreSQL 16 on the host**

```bash
sudo apt update && sudo apt install -y postgresql-16
```

- [ ] **Step 3: Create databases and users**

```bash
sudo -u postgres psql <<'SQL'
CREATE USER smh_prod WITH PASSWORD 'GENERATE_STRONG_PASSWORD';
CREATE DATABASE smh_prod OWNER smh_prod;

CREATE USER smh_staging WITH PASSWORD 'GENERATE_STRONG_PASSWORD';
CREATE DATABASE smh_staging OWNER smh_staging;
SQL
```

- [ ] **Step 4: Configure PostgreSQL to accept Docker connections**

Edit `/etc/postgresql/16/main/postgresql.conf`:
```ini
listen_addresses = 'localhost,172.17.0.1'
```

Edit `/etc/postgresql/16/main/pg_hba.conf` — add before existing local rules:
```
host    smh_prod     smh_prod     172.0.0.0/8    scram-sha-256
host    smh_staging  smh_staging  172.0.0.0/8    scram-sha-256
```

Restart:
```bash
sudo systemctl restart postgresql
```

- [ ] **Step 5: Create OVHcloud credentials directories and files**

```bash
mkdir -p /opt/sellmyhouse/{production,staging}
mkdir -p /opt/sellmyhouse/nginx/{certbot/conf,certbot/www}

# Create production credentials (fill in real values from OVHcloud console)
cat > /opt/sellmyhouse/production/.ovh-credentials << 'EOF'
OVH_ENDPOINT=ovh-eu
OVH_APP_KEY=<your-prod-app-key>
OVH_APP_SECRET=<your-prod-app-secret>
OVH_CONSUMER_KEY=<your-prod-consumer-key>
OVH_PROJECT_ID=<your-project-id>
OVH_REGION=sgp1
OVH_VAULT_ID=<your-prod-vault-uuid>
EOF
chmod 600 /opt/sellmyhouse/production/.ovh-credentials

# Create staging credentials
cat > /opt/sellmyhouse/staging/.ovh-credentials << 'EOF'
OVH_ENDPOINT=ovh-eu
OVH_APP_KEY=<your-staging-app-key>
OVH_APP_SECRET=<your-staging-app-secret>
OVH_CONSUMER_KEY=<your-staging-consumer-key>
OVH_PROJECT_ID=<your-project-id>
OVH_REGION=sgp1
OVH_VAULT_ID=<your-staging-vault-uuid>
EOF
chmod 600 /opt/sellmyhouse/staging/.ovh-credentials
```

- [ ] **Step 6: Create the staging htpasswd file**

```bash
sudo apt install -y apache2-utils
htpasswd -c /opt/sellmyhouse/nginx/.htpasswd-staging <your-username>
```

- [ ] **Step 7: Clone the repo on the VPS (if not already present)**

```bash
cd ~ && git clone git@github.com:<your-org>/sellmyhouse-v2.git
```

- [ ] **Step 8: Get SSL certificates**

First, temporarily comment out the `ssl_certificate` lines and the entire HTTPS `server` block in both `docker/nginx/conf.d/production.conf` and `docker/nginx/conf.d/staging.conf`, then start Nginx in HTTP-only mode:

```bash
cd ~/sellmyhouse-v2
docker compose -f docker/nginx/docker-compose.yml up -d
```

Get the certificates:
```bash
# Production
docker run --rm \
  -v /opt/sellmyhouse/nginx/certbot/conf:/etc/letsencrypt \
  -v /opt/sellmyhouse/nginx/certbot/www:/var/www/certbot \
  certbot/certbot certonly --webroot \
  --webroot-path /var/www/certbot \
  --email you@sellmyhouse.sg --agree-tos --no-eff-email \
  -d sellmyhouse.sg -d www.sellmyhouse.sg

# Staging
docker run --rm \
  -v /opt/sellmyhouse/nginx/certbot/conf:/etc/letsencrypt \
  -v /opt/sellmyhouse/nginx/certbot/www:/var/www/certbot \
  certbot/certbot certonly --webroot \
  --webroot-path /var/www/certbot \
  --email you@sellmyhouse.sg --agree-tos --no-eff-email \
  -d staging.sellmyhouse.sg
```

Restore the HTTPS server blocks in both nginx config files, then restart Nginx:
```bash
docker compose -f docker/nginx/docker-compose.yml restart
```

- [ ] **Step 9: Set up SSL auto-renewal cron**

```bash
crontab -e
```

Add:
```
0 3 * * * docker run --rm -v /opt/sellmyhouse/nginx/certbot/conf:/etc/letsencrypt -v /opt/sellmyhouse/nginx/certbot/www:/var/www/certbot certbot/certbot renew --quiet && docker exec nginx-proxy nginx -s reload 2>/dev/null
```

- [ ] **Step 10: Log in to GHCR on the VPS**

```bash
echo "<GITHUB_PAT_WITH_READ_PACKAGES>" | docker login ghcr.io -u <your-github-username> --password-stdin
```

- [ ] **Step 11: First deploy — production**

```bash
cd ~/sellmyhouse-v2
GITHUB_REPOSITORY=<your-org>/sellmyhouse-v2 docker compose -f docker/docker-compose.production.yml pull
GITHUB_REPOSITORY=<your-org>/sellmyhouse-v2 docker compose -f docker/docker-compose.production.yml up -d
# Container will: fetch secrets → run migrations → start app
docker logs -f app-prod
```

- [ ] **Step 12: First deploy — staging**

```bash
GITHUB_REPOSITORY=<your-org>/sellmyhouse-v2 docker compose -f docker/docker-compose.staging.yml pull
GITHUB_REPOSITORY=<your-org>/sellmyhouse-v2 docker compose -f docker/docker-compose.staging.yml up -d
docker logs -f app-staging
```

- [ ] **Step 13: Verify both environments are live**

```bash
# Production
curl -s https://sellmyhouse.sg/health | jq .

# Staging (requires Basic Auth)
curl -s -u <username>:<password> https://staging.sellmyhouse.sg/health | jq .
```

Expected: `{ "status": "ok", "timestamp": "..." }` from both.
