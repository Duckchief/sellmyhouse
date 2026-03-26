# Deployment Guide

## Local Development Setup

### 1. Prerequisites

- Node.js >= 22
- Docker Desktop
- `.env` file with all required variables set (see `.env.example`)

### 2. Generate required secrets

```bash
# ENCRYPTION_KEY (32-byte hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# JWT_SECRET (32-byte hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Start the database

```bash
npm run docker:dev
```

### 4. Apply database migrations

> **Known issue with Prisma 6 + `prisma.config.ts`:** `prisma migrate dev` and
> `prisma migrate deploy` both report "Already in sync / No pending migrations"
> on a fresh empty database without actually creating any tables. This appears
> to be a bug in how Prisma 6's config-file format tracks migration state.
>
> **Workaround:** Apply the migration SQL directly via psql instead of using the
> Prisma CLI:

```bash
cat prisma/migrations/*/migration.sql | docker exec -i docker-db-1 psql -U smh -d smh_dev
```

### 5. Seed the database

Loads system settings and ~970k HDB transaction records:

```bash
npx tsx prisma/seed.ts
```

### 6. Create the first admin user

```bash
# Generate a bcrypt hash for your chosen password
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('yourpassword', 12).then(h => console.log(h))"
```

Then insert via psql:

```bash
docker exec -it docker-db-1 psql -U smh -d smh_dev
```

```sql
INSERT INTO agents (id, name, email, phone, password_hash, role, cea_reg_no, is_active, created_at, updated_at)
VALUES (
  'admin001',
  'Admin',
  'admin@smh.local',
  '+6500000000',
  '<bcrypt-hash-here>',
  'admin',
  'ADMIN001',
  true,
  NOW(),
  NOW()
);
```

### 7. Build and start the dev server

```bash
npm run build
npm run dev
```

App is available at **http://localhost:3000**.

Login at `/auth/login` → Agent tab using the email and password from step 6.

---

## Production Deployment (Hostinger VPS)

### Database connection

PostgreSQL runs on the host (not in Docker). The app container reaches it via
`host.docker.internal`, which is mapped to the host gateway by the
`extra_hosts` entry in `docker-compose.yml`.

Set `DATABASE_URL` in your `.env` on the VPS:

```
DATABASE_URL=postgresql://smh:yourpassword@host.docker.internal:5432/sellmyhouse
```

Make sure PostgreSQL is configured to accept connections on `127.0.0.1` (it
usually is by default). No changes to `pg_hba.conf` are needed because
Docker's host-gateway routes through the loopback interface.

### Database migrations

Use the same psql workaround as local development — do **not** rely on
`prisma migrate deploy` until the Prisma 6 config-file migration bug is resolved:

```bash
cat prisma/migrations/*/migration.sql | psql "$DATABASE_URL"
```

### Environment variables

All variables in `.env.example` are required in production. Pay particular attention to:

- `SESSION_SECRET` — random 64-char string, never reuse across environments
- `ENCRYPTION_KEY` — 32-byte hex, used for AES-256-GCM encryption of CDD documents
- `JWT_SECRET` — 32-byte hex, separate from `SESSION_SECRET`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — must match Meta app configuration
- `NODE_ENV=production` — enables secure cookie flag

### Build

```bash
npm run build
```

### Start

```bash
npm start
```
