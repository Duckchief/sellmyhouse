# OVHcloud Secret Manager Integration — Design Spec

**Date:** 2026-03-26
**Status:** Draft

## Problem

The current deployment stores all application secrets in `.env` files on the VPS filesystem. This creates several PDPA compliance risks:

- Any filesystem access exposes every credential including `ENCRYPTION_KEY` (protects NRIC documents at rest), `DATABASE_URL` (full access to all personal data), and API keys for external services
- No audit trail of when credentials were accessed or by whom — PDPA accountability obligation cannot be demonstrated
- Secret rotation requires SSH access to update files on each server
- Staging and production secrets coexist on the same server with no access boundary

## Architecture

### Overview

```
VPS (OVHcloud Singapore)
├── /opt/sellmyhouse/
│   ├── production/
│   │   ├── docker-compose.yml
│   │   └── .ovh-credentials       ← bootstrap key only (chmod 600)
│   └── staging/
│       ├── docker-compose.yml
│       └── .ovh-credentials       ← separate service account
│
│   Nginx container (ports 80/443) → app-prod / app-staging

OVHcloud Public Cloud — Secret Manager
├── Vault: smh-production
│   ├── DATABASE_URL
│   ├── SESSION_SECRET
│   ├── ENCRYPTION_KEY              ← highest sensitivity (NRIC AES-256)
│   ├── JWT_SECRET
│   ├── AI_ANTHROPIC_API_KEY
│   ├── WHATSAPP_TOKEN
│   ├── WHATSAPP_PHONE_ID
│   ├── WHATSAPP_VERIFY_TOKEN
│   ├── WHATSAPP_WEBHOOK_VERIFY_TOKEN
│   ├── SMTP_HOST
│   ├── SMTP_PORT
│   ├── SMTP_USER
│   ├── SMTP_PASS
│   ├── SMTP_FROM
│   └── DATAGOV_API_KEY
└── Vault: smh-staging
    └── (same keys, staging-specific values — staging DB, test API keys)
```

### Container Startup Sequence

```
Container starts
  → entrypoint.sh runs
      → fetch-secrets.js authenticates to OVHcloud API
         (reads .ovh-credentials, computes HMAC-SHA1 signature)
      → fetches all secrets from the assigned vault
      → secrets loaded into process environment (never written to disk)
      → npx prisma migrate deploy
      → exec node dist/server.js   ← app process inherits env vars
```

The app never starts unless both secret fetch and migrations succeed. If either fails, the container exits and Docker's `unless-stopped` restart policy retries (with backoff from Docker's restart logic). The previous healthy container continues serving traffic until the new one is healthy.

### Bootstrap Credential

The `.ovh-credentials` file on each environment contains only:

```ini
OVH_ENDPOINT=ovh-eu
OVH_APP_KEY=<application key>
OVH_APP_SECRET=<application secret>
OVH_CONSUMER_KEY=<consumer key>
OVH_PROJECT_ID=<public cloud project ID>
OVH_REGION=sgp1
OVH_VAULT_ID=<vault UUID>
```

This service account has:
- Read-only access to one specific vault
- No write access to secrets
- No access to any other OVHcloud resource
- No access to the other environment's vault

This is the only sensitive file on disk. All actual application secrets live in OVHcloud Secret Manager and exist on the VPS only in container process memory.

## Implementation

### New Files

#### `scripts/fetch-secrets.ts`

Node.js script that authenticates to the OVHcloud API v6 and fetches all secrets from a vault. Uses only Node.js built-ins (`https`, `crypto`, `fs`) — no external dependencies.

Responsibilities:
- Read `.ovh-credentials` from a path specified by `OVH_CREDENTIALS_PATH` environment variable
- Compute OVHcloud API authentication headers (HMAC-SHA1 signature per OVHcloud API spec)
- Fetch the time delta from OVHcloud API (`GET /auth/time`) to synchronise timestamps
- List all secrets in the vault (`GET /cloud/project/{projectId}/region/{region}/secret`)
- Fetch each secret's payload
- Output `export KEY=VALUE` lines to stdout (values shell-escaped)
- Exit with code 1 on any failure (network error, auth error, missing secrets)

Expected runtime: ~300-500ms (single API round-trip to Singapore region).

Skip behaviour: if `NODE_ENV=development` or `OVH_CREDENTIALS_PATH` is not set, the script outputs nothing and exits 0 — local dev continues to use `.env` files unchanged.

#### `docker/entrypoint.sh`

```bash
#!/bin/sh
set -e

# Fetch secrets from OVHcloud Secret Manager
if [ -f "$OVH_CREDENTIALS_PATH" ]; then
  echo "Fetching secrets from OVHcloud Secret Manager..."
  eval "$(node /app/dist/scripts/fetch-secrets.js)"
  echo "Secrets loaded."
fi

# Run database migrations
echo "Running database migrations..."
npx prisma migrate deploy

# Start the application
echo "Starting application..."
exec node /app/dist/server.js
```

### Modified Files

#### `docker/Dockerfile`

Changes:
- Copy `scripts/` directory into the builder stage so `fetch-secrets.ts` is compiled to `dist/scripts/fetch-secrets.js`
- Copy `docker/entrypoint.sh` into the runtime stage
- Change `CMD` to `ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]`

#### `docker/docker-compose.yml` (production)

```yaml
services:
  app-prod:
    image: ghcr.io/${GITHUB_REPOSITORY}:${IMAGE_TAG:-latest}
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

Staging compose is identical except:
- `container_name: app-staging`
- `IMAGE_TAG: staging`
- `BASE_URL: https://staging.sellmyhouse.sg`
- Bind mount: `/opt/sellmyhouse/staging/.ovh-credentials`

Key changes from current compose:
- `env_file` removed — no `.env` file on disk
- Non-sensitive vars (`NODE_ENV`, `PORT`, `BASE_URL`) set inline in `environment`
- `.ovh-credentials` bind-mounted read-only to `/run/secrets/`

#### `.github/workflows/deploy.yml`

Changes:
- Remove the `prisma migrate deploy` step from the deploy job — migrations now run inside the container entrypoint
- Deploy script becomes:

```yaml
script: |
  cd /opt/sellmyhouse/$DEPLOY_ENV
  docker compose pull
  docker compose up -d
  # Wait for container to be healthy (migrations + app start)
  sleep 5
  docker compose ps
  docker image prune -f
  echo "Deployed $IMAGE_TAG to $DEPLOY_ENV: ${{ github.sha }}"
```

No app secrets exist anywhere in the CI/CD pipeline.

### No Changes

- **Local development**: continues using `.env` file. `fetch-secrets.ts` detects `NODE_ENV=development` (or absence of `OVH_CREDENTIALS_PATH`) and skips the OVHcloud fetch.
- **CI test job**: continues using inline `DATABASE_URL` for the test Postgres service container. No OVHcloud access needed in CI.
- **Application code**: no changes. The app reads from `process.env` as before — it doesn't know or care whether env vars came from `.env`, Docker `environment`, or the entrypoint script.

## OVHcloud Setup (One-Time)

### 1. Enable Secret Manager

In OVHcloud Control Panel → Public Cloud → your project → Security → Secret Manager.

### 2. Create Vaults

Create two vaults in the Singapore (`sgp1`) region:
- `smh-production`
- `smh-staging`

### 3. Create Service Accounts

In OVHcloud IAM, create two service accounts:
- `smh-prod-reader` — read-only access to `smh-production` vault only
- `smh-staging-reader` — read-only access to `smh-staging` vault only

### 4. Generate API Credentials

For each service account, generate OVHcloud API credentials (application key + secret + consumer key). These go into the `.ovh-credentials` files on the VPS.

### 5. Populate Secrets

Add all secrets to each vault via the OVHcloud console or API. Secret names must match the environment variable names exactly (e.g., `DATABASE_URL`, `ENCRYPTION_KEY`).

### 6. Deploy Credentials to VPS

```bash
# As deploy user on VPS
# Production
cat > /opt/sellmyhouse/production/.ovh-credentials << 'EOF'
OVH_ENDPOINT=ovh-eu
OVH_APP_KEY=<prod app key>
OVH_APP_SECRET=<prod app secret>
OVH_CONSUMER_KEY=<prod consumer key>
OVH_PROJECT_ID=<project id>
OVH_REGION=sgp1
OVH_VAULT_ID=<prod vault uuid>
EOF
chmod 600 /opt/sellmyhouse/production/.ovh-credentials

# Staging (same structure, different credentials)
cat > /opt/sellmyhouse/staging/.ovh-credentials << 'EOF'
OVH_ENDPOINT=ovh-eu
OVH_APP_KEY=<staging app key>
OVH_APP_SECRET=<staging app secret>
OVH_CONSUMER_KEY=<staging consumer key>
OVH_PROJECT_ID=<project id>
OVH_REGION=sgp1
OVH_VAULT_ID=<staging vault uuid>
EOF
chmod 600 /opt/sellmyhouse/staging/.ovh-credentials
```

## PDPA Controls

| PDPA Obligation | How This Design Addresses It |
|-----------------|------------------------------|
| **Protection** (s24) | `ENCRYPTION_KEY` and `DATABASE_URL` never on disk. Exist only in container process memory. VPS compromise exposes only the bootstrap key, not personal data credentials. |
| **Accountability** (s12) | Every secret access logged in OVHcloud with timestamp and service account identity. Logs retained per OVHcloud policy. |
| **Breach notification** (s26D) | On suspected breach: revoke the service account in OVHcloud console → all secrets inaccessible within seconds, even if attacker retains the `.ovh-credentials` file. Clear audit trail shows exactly what was accessed and when. |
| **Access limitation** (s18) | Staging cannot access production secrets. Each environment has its own service account with access to its own vault only. |

### Breach Response Procedure

1. Revoke the compromised service account in OVHcloud IAM (immediate effect)
2. Review OVHcloud Secret Manager access logs to determine what was accessed
3. Rotate all secrets in the affected vault
4. Create a new service account and deploy new credentials to the VPS
5. Restart containers (they'll fetch the new secrets)

## What This Does NOT Address

- **Automated secret rotation scheduling** — rotation is manual (update in OVHcloud console → restart container). Automated rotation could be added later via OVHcloud API.
- **Alerting on unusual access patterns** — OVHcloud logs exist but no automated monitoring or alerting is configured. Could integrate with OVHcloud Logs Data Platform in future.
- **HSM-backed key storage** — `ENCRYPTION_KEY` is stored as a regular secret. For higher assurance, OVHcloud KMS (Key Management Service) could be used, but that requires application code changes to use KMS for encryption/decryption operations directly.
- **Multi-region redundancy** — secrets are in `sgp1` only. If OVHcloud Singapore has an outage, containers cannot restart (but running containers are unaffected since secrets are already in memory).

## OVHcloud API Reference

The fetch-secrets script interacts with these OVHcloud API v6 endpoints:

- `GET /auth/time` — server timestamp for signature computation
- `GET /cloud/project/{projectId}/region/{region}/secret` — list secrets in the region
- `GET /cloud/project/{projectId}/region/{region}/secret/{secretId}` — get secret metadata and payload

Authentication uses the OVHcloud signature scheme:
```
X-Ovh-Application: {APP_KEY}
X-Ovh-Consumer: {CONSUMER_KEY}
X-Ovh-Timestamp: {TIMESTAMP}
X-Ovh-Signature: $1${SHA1(APP_SECRET + "+" + CONSUMER_KEY + "+" + METHOD + "+" + URL + "+" + BODY + "+" + TIMESTAMP)}
```

Note: The exact Secret Manager API endpoints should be verified against the OVHcloud API console (`api.ovh.com/console`) as this is a newer service and endpoints may have been updated since this spec was written.
