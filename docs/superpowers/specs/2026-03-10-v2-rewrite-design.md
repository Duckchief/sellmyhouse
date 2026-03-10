# SellMyHomeNow.sg v2 — Full Rewrite Design

**Date:** 2026-03-10
**Status:** Approved

## Overview

Full rewrite of the SellMyHomeNow.sg platform. The v1 codebase (16.5K LOC, 6 phases, 523+ tests) is functionally complete but was built without structured development workflows. v2 rebuilds from scratch with TypeScript, modern architecture patterns, proper test infrastructure, and Superpowers-driven development (TDD, brainstorming, planning for every feature).

**Superpowers** is a Claude Code plugin that enforces structured development workflows: brainstorming (collaborative design before code), writing specs, writing implementation plans, and test-driven development. Every feature in v2 goes through this full cycle.

**v1 is not yet live with production data.** There is no data migration requirement. The v1 codebase and its phase docs serve as reference for business requirements.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Language | TypeScript (strict mode) |
| Node.js version | 22 LTS (current LTS as of 2026) |
| Backend framework | Express.js |
| ORM | Prisma |
| Template engine | Nunjucks (replacing EJS) |
| Frontend interactivity | HTMX (deliberate departure from v1's React/Preact plan — HTMX is simpler and sufficient for form-heavy dashboards) |
| CSS | Tailwind |
| Database | PostgreSQL 16 (containerized) |
| Deployment | Docker on Hostinger VPS (Singapore) |
| CI/CD | GitHub Actions → ghcr.io → VPS |
| Testing | Jest (unit + integration) + Playwright (E2E) |
| Development workflow | Superpowers: brainstorm → spec → plan → TDD |
| Rewrite strategy | Fresh start in new directory, phase-mirrored sequence with domain-driven structure |
| Primary key format | cuid2 (sortable, URL-safe, collision-resistant) |

## 1. Project Structure

```
sellmyhomenow-v2/
├── src/
│   ├── domains/              # Business domain modules
│   │   ├── auth/
│   │   ├── property/
│   │   ├── seller/
│   │   ├── transaction/
│   │   ├── compliance/
│   │   ├── notification/
│   │   ├── content/
│   │   └── shared/           # Cross-cutting (audit, settings, AI facade)
│   ├── infra/                # Infrastructure layer
│   │   ├── database/         # Prisma client, migrations helper
│   │   ├── http/             # Express app factory, middleware, error handling
│   │   ├── jobs/             # Cron job runner
│   │   └── storage/          # File storage abstraction (local disk, per-seller 200MB limit, 80% disk alert)
│   ├── views/                # Nunjucks templates
│   │   ├── layouts/
│   │   ├── pages/
│   │   ├── partials/
│   │   └── emails/
│   └── server.ts             # Entry point
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── tests/
│   ├── fixtures/             # Shared test data factories
│   ├── helpers/              # Test setup, DB helpers
│   ├── integration/          # Integration tests (real DB via Docker Postgres)
│   └── e2e/                  # Playwright specs
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   ├── docker-compose.test.yml
│   └── .dockerignore
├── .github/
│   └── workflows/
│       └── deploy.yml
├── docs/
│   └── superpowers/specs/
├── data/                     # HDB CSV seed data
├── tsconfig.json
├── package.json
├── tailwind.config.ts
└── CLAUDE.md
```

## 2. Domain Module Architecture

Each domain module follows a consistent internal pattern:

```
src/domains/<domain>/
├── <domain>.types.ts        # Types, interfaces, enums
├── <domain>.service.ts      # Business logic
├── <domain>.repository.ts   # Database queries (Prisma isolated here)
├── <domain>.router.ts       # Express route handlers
├── <domain>.validator.ts    # Input validation schemas
├── <domain>.service.test.ts # Unit tests (mock repository)
└── <domain>.router.test.ts  # Route-level tests
```

### Key separation: service vs repository

Services contain business logic and never call Prisma directly. Repositories isolate all database access behind a typed interface. This makes services unit-testable by mocking the repository layer rather than Prisma internals.

### Cross-domain communication

Domains import each other's services, never repositories. Example: `transaction.service.ts` can call `propertyService.getById()` but never `propertyRepo.findById()`.

### Shared domain (`src/domains/shared/`)

Cross-cutting concerns that don't belong to a specific business domain:

- `audit.service.ts` — append-only audit logging with typed events
- `settings.service.ts` — SystemSetting reads (commission, AI provider)
- `ai/` — AI facade (provider-agnostic, selected via SystemSetting at runtime)
- `errors.ts` — Typed error classes: `NotFoundError`, `ForbiddenError`, `ValidationError`, `ComplianceError`

### Typed errors

Replace string throws with error classes:

```typescript
throw new NotFoundError('Property', propertyId);
// Caught by error middleware → 404 with structured message
```

## 3. Schema Redesign Principles

The full schema is designed in Phase 1's brainstorm. These principles guide it:

1. **cuid2 for all primary keys.** Sortable, URL-safe, collision-resistant. No auto-increment integers.
2. **Consistent naming.** camelCase in code, snake_case in DB columns via Prisma `@map`.
3. **Explicit state machines.** Allowed transitions defined as typed constants alongside enums.
4. **Soft delete vs hard delete.** Hard delete is required for personal data (PDPA). Soft delete (`deletedAt`) is used only for entities that contain no personal data and benefit from recoverability. The rule: if an entity is directly linked to an identifiable person (Seller, Buyer, ConsentRecord, CddRecord, DataDeletionRequest, DataCorrectionRequest), it gets hard delete. Infrastructure entities with no personal data (SystemSetting, VideoTutorial, HdbTransaction) may use soft delete. Entities like Property, Listing, Offer, and Transaction are linked to personal data subjects and must be hard-deleted when a PDPA deletion cascades from the parent Seller.
5. **Typed audit events.** `entityType` + `entityId` pair for fast querying. Typed payload per action.
6. **Indexes from query patterns.** Compound indexes based on actual app queries.
7. **Decimal for money.** Prisma `Decimal` type for all financial fields. No floats.

### All models (carried from v1, refined in Phase 1)

Core: Agent, Seller, Buyer, Property, Listing, Transaction, Offer, OTP, ViewingSlot, Viewing
Financial: FinancialReport, EstateAgencyAgreement
Compliance: ConsentRecord, CddRecord, DataDeletionRequest, DataCorrectionRequest, AuditLog
Notifications: Notification
Content: VideoTutorial, MarketContent, Testimonial, Referral
Other: CaseFlag, SystemSetting, Lead, HdbTransaction

### Consent records are append-only

ConsentRecord entries are immutable once created — new records are appended to track consent changes over time. This is distinct from, but similar to, the audit log append-only rule.

### What stays the same

- Core model relationships: Agent → Sellers → Properties → Transactions
- Separate service consent vs marketing consent
- Offer self-join for counter-offer chains

## 4. HTMX + Nunjucks Frontend

### Template engine

Nunjucks replaces EJS. Provides template inheritance (extends/block), macros (reusable components), and filters.

### i18n

All user-facing strings wrapped in Nunjucks i18n filter (e.g., `{{ "Welcome" | t }}`). English only for now, but architecture-ready for future languages via i18next integration with Nunjucks.

### Layout hierarchy

```
layouts/base.njk          # HTML shell, head, scripts, Tailwind
  layouts/public.njk      # Nav + footer for public pages
  layouts/seller.njk      # Seller sidebar + nav
  layouts/agent.njk       # Agent sidebar + nav
  layouts/admin.njk       # Admin sidebar + nav (separate from agent)
```

Admin gets its own layout instead of sharing with agent (v1 used conditional nav).

### HTMX patterns

| Feature | HTMX Pattern |
|---------|-------------|
| Approval actions | `hx-post` → swap status badge inline |
| Review queue | Approve/reject swaps row in-place |
| Onboarding wizard | Single page, steps load via `hx-get` |
| Viewing calendar | `hx-trigger="every 30s"` for live updates |
| Dashboard stats | Lazy-load cards with `hx-trigger="load"` |
| Search/filter | `hx-get` with `hx-trigger="keyup changed delay:300ms"` |

### Fragment vs full page

Route handlers check for HTMX requests:

```typescript
if (req.headers['hx-request']) {
  res.render('partials/offer-row', { offer });  // fragment
} else {
  res.render('pages/agent/offers', { offers });  // full page
}
```

### Reusable components

Nunjucks macros for shared UI elements (status badges, form fields, data tables).

## 5. Testing Strategy

### Unit tests (co-located with domain modules)

- Live next to source: `property.service.test.ts` alongside `property.service.ts`
- Mock repository layer, not Prisma internals
- Financial calculations: regression suite with 20+ edge cases (carried from v1)
- State machine transitions tested exhaustively

### Integration tests (`tests/integration/`)

- Real PostgreSQL via Docker Compose test service
- Tests run on the host against containerized Postgres (Node.js + test deps on host, not in container)
- Each test file uses its own Prisma client with small pool (2-3 connections)
- Integration suites run with `--runInBand` to prevent pool exhaustion
- Test data factories: `factory.seller()`, `factory.property()`, etc.
- Database cleanup via truncation between tests

### E2E tests (`tests/e2e/`)

- Playwright against Docker Compose stack (app + DB)
- Runnable locally and in CI (Docker makes this possible)
- Key flows: seller onboarding, agent review cycle, transaction completion, PDPA deletion

### TDD workflow

Every feature built test-first using Superpowers test-driven-development skill:
1. Write failing test
2. Write minimum code to pass
3. Refactor
4. Repeat

## 6. Infrastructure

### Session management

- PostgreSQL-backed sessions via `connect-pg-simple` (same as v1, works in Docker)
- Session timeout: 30 minutes for 2FA-verified users, 24 hours for non-2FA
- Concurrent sessions allowed
- Session invalidation on password change
- No sticky sessions needed — single container deployment

### Structured logging

- Pino for structured JSON logging
- Logs go to container stdout (Docker captures them)
- Log rotation handled by Docker's logging driver (`json-file` with `max-size` and `max-file`)
- Replaces PM2 log rotation from v1

### Image processing

- sharp for image optimization: resize to 2000px max, JPEG quality 80, minimum 800px validation
- Store original + optimized versions
- Abstract behind `infra/storage/` interface — service code calls `storage.savePhoto()`, not sharp directly
- Mock the storage interface in tests (avoids sharp native binding issues from v1)

### Storage

- `infra/storage/` provides a typed interface for file operations (save, read, delete, exists)
- Local disk storage (abstracted for future cloud migration)
- Per-seller storage limit: 200MB
- Admin alert at 80% disk usage
- File validation: jpg/jpeg/png/pdf only, max 5MB photos / 10MB documents

### Maintenance mode

- Admin toggle via SystemSetting
- When active: 503 responses to all non-admin routes, paused cron jobs, blocked logins
- Admin dashboard remains accessible

### Admin CSV export

- PDPA-safe field exclusions (no NRIC, no full names in bulk exports)
- Carried from v1

### Docker (multi-stage build)

```dockerfile
FROM node:22-alpine AS builder
# Install deps, generate Prisma (target: linux-musl-openssl-3.0.x for Alpine), compile TS, build Tailwind

FROM node:22-alpine AS runner
# Copy compiled output, node_modules, prisma, views, public assets
CMD ["node", "dist/server.js"]
```

**Prisma Docker note:** Both build and runtime stages use the same Alpine base, so Prisma's generated client (which includes platform-specific query engine binaries) is compatible. If stages ever differ, set `binaryTargets` in `schema.prisma`.

### Docker Compose variants

- **Production:** App pulls image from ghcr.io, Postgres with persistent volume, uploads volume
- **Development:** Source mounted for hot reload, exposed DB port for local tools
- **Test:** Separate Postgres on different port, developer runs tests on host against containerized DB

### Process management

Docker replaces PM2 from v1:
- Container restart policy (`restart: unless-stopped`) replaces PM2 auto-restart
- Docker health checks (`HEALTHCHECK CMD curl -f http://localhost:3000/health`) replace PM2 monitoring
- Docker logging driver replaces PM2 log rotation

### GitHub Actions CI/CD

**On pull request:**
- Run lint, unit tests, integration tests (Postgres service container in Actions)
- No deploy

**On merge to main:**
- Run all tests
- Build Docker image
- Push to GitHub Container Registry (ghcr.io)
- SSH into VPS → `docker pull` → `docker compose up -d`
- Run `prisma migrate deploy` in container

### VPS setup

- Nginx runs **on the host** (not containerized) as reverse proxy → `localhost:3000`
- Let's Encrypt SSL via Certbot on host Nginx
- `.env` stays on VPS (never in image or repo)
- Rollback = re-deploy previous image tag

## 7. Phase Breakdown

Each phase gets its own Superpowers cycle: brainstorm → spec → plan → TDD.

### Phase 0: Project Scaffolding
- TypeScript + Express setup, tsconfig (target ES2022, CommonJS modules, strict mode, path aliases via `@/domains/*`), ESLint (`@typescript-eslint/recommended` + Prettier integration), Prettier
- Docker + Docker Compose (dev, test, prod)
- GitHub Actions pipeline
- Prisma config with bootstrap schema (SystemSetting + AuditLog models only — enough for shared infrastructure to function)
- Nunjucks + HTMX + Tailwind setup (JIT mode, custom brand colors defined in Phase 1)
- Base layouts (public, seller, agent, admin)
- Shared infrastructure: error types, audit service, settings service, AI facade
- Test harness: factories, Docker test DB, Jest config
- Health check endpoint

### Phase 1: Foundation
- Full schema design (cuid2, Decimal, typed audit, state machines, all models)
- HDB data ingestion (migrate seed logic from v1)
- Auth domain (register, login, 2FA, sessions)
- Notification domain (WhatsApp, email, in-app — check `seller.notificationPreference` before sending)
- Public website (homepage, privacy, terms)
- PWA manifest + service worker (installable on mobile, offline caching for static assets and previously viewed pages)

### Phase 2: Seller Dashboard
- Seller onboarding wizard (HTMX multi-step)
- Property domain (CRUD, photos via storage interface, listing)
- Financial engine + AI report generation (with "estimates only, not financial advice" disclaimers)
- Viewing scheduler (HTMX live updates)
- Case flags

### Phase 3: Agent & Admin Dashboards
- Agent pipeline, leads, seller detail
- Review gate + compliance gate (state machines)
- Agent review queue (HTMX inline actions)
- Admin: team, settings, HDB data, analytics, CSV export
- Separate admin layout

### Phase 4: Transaction Management
- Offer domain (counter-offer chains)
- Portal-ready listings (CEA advertising compliance)
- OTP lifecycle (6-step state machine — OTP is physical, platform tracks status and stores scanned copies only, does not generate or modify)
- Invoice generation (commission invoice comes from Huttons, platform stores and distributes only)
- Completion + post-completion cron

### Phase 5: PDPA Compliance
- Consent management (granular service/marketing, consent records append-only)
- DNC registry compliance (check DNC before WhatsApp/phone outreach)
- Retention scanning + hard delete (cascade to all personal-data-linked entities)
- Seller data access, corrections, deletion
- Secure download & delete
- Agent anonymisation

### Phase 6: Content & Referrals
- Tutorials (admin CRUD)
- Market content engine (AI + human review)
- Testimonials
- Referral program

## 8. Documentation Strategy

Each phase reads:
1. **v2 shared context** — new Phase 0 spec with TypeScript patterns, domain conventions, Docker setup, testing patterns, schema principles
2. **Original v1 phase doc** — reference for business requirements and edge cases
3. **That phase's v2 spec** — brainstormed design for how v2 implements it

v1 docs become reference material for "what does the feature need to do." v2 specs describe "how to build it."

## 9. CLAUDE.md for v2

### New rules
- Domain module convention: types, service, repository, router, validator, tests
- Repository layer: services never call Prisma directly
- Typed errors: use error classes, not string throws
- HTMX responses: check `hx-request` header, return fragment or full page
- Co-located unit tests next to source files; integration tests in `tests/integration/`
- Factory pattern for test data
- Docker for dev, test, and prod
- Superpowers workflow for every feature (brainstorm → spec → plan → TDD)
- i18n: wrap all user-facing strings in translation filter

### Rules carried over (unchanged)
- AI provider-agnostic facade
- Human-in-the-loop (ai_generated → pending_review → approved → sent)
- Three-channel notifications (check `seller.notificationPreference` before sending; marketing requires explicit marketing consent separate from service consent)
- Files served through application routes (never directly via nginx)
- PDPA hard delete for personal data (Prisma `delete` + `fs.unlink`)
- Granular consent (service vs marketing, never pre-ticked)
- Consent records append-only (immutable once created)
- AML/CFT 5-year retention (overrides PDPA deletion during retention)
- Append-only audit logs (never delete or modify)
- NRIC: last 4 chars in DB, full docs encrypted AES-256, masked display SXXXX567A
- CEA advertising: agent name, CEA reg #, agency name (Huttons Asia Pte Ltd), agency licence #, contact on all listings
- Commission fixed: $1,499 + GST ($1,633.91) from SystemSetting, never hardcoded, never percentage-based

### Security rules (specific values)
- Passwords: bcrypt cost factor 12
- 2FA: mandatory for agents/admin, optional for sellers (TOTP)
- File uploads: jpg/jpeg/png/pdf only, max 5MB photos / 10MB documents, sanitize filenames, reject path traversal
- Rate limiting: 5 auth attempts/15min, 100 API requests/min, 3 lead submissions/hour, 3 viewing bookings/phone/day
- CDD documents: encrypted at rest (AES-256), agent-only access
- `.env`: never committed to git

## 10. Compliance Rules (Non-Negotiable)

These are legal/regulatory requirements carried from v1 and cannot be changed in the rewrite:

### PDPA
- **Hard delete** for personal data (Prisma `delete` + `fs.unlink` for files)
- **Granular consent** — service and marketing always separate, marketing never pre-ticked
- **Consent records immutable** — append-only, new records track changes
- **Notification preference** — check `seller.notificationPreference` before sending
- **Marketing consent required** — marketing messages require explicit marketing consent, separate from service consent

### AML/CFT
- **5-year retention** for transaction records and CDD documents — overrides PDPA deletion requests during retention period

### Audit
- **Append-only** — never delete or modify audit log entries

### NRIC
- **Last 4 chars only** stored in database
- **Full NRIC documents** encrypted at rest (AES-256)
- **Masked display**: SXXXX567A

### CEA
- **Advertising requirements** — all listings must include: agent name, CEA registration number, agency name (Huttons Asia Pte Ltd), agency licence number, agent contact number

### DNC (Do Not Call)
- Check Singapore DNC registry before any WhatsApp or phone-based outreach
- Separate from PDPA consent

### Financial
- **Commission fixed** — $1,499 + GST ($1,633.91) from SystemSetting at runtime, never hardcoded, never percentage-based
- **No financial advice** — all estimates include disclaimers: "This is an estimate only and does not constitute financial advice"
- **No formal valuations** — indicative ranges from public HDB data only
- **OTP is physical** — platform tracks status and stores scanned copies, does not generate or modify the OTP document
- **Commission invoice from Huttons** — platform stores and distributes only, does not generate the invoice itself

## Out of Scope (carried from v1)

- Buyer-side workflow (stub only — schema in place, no dashboard)
- Advanced team management (basic admin CRUD, no round-robin/lead routing)
- Multi-language (English only, but i18next wrapper for future)
- Suspicious Transaction Reporting (handled in Huttons' internal system)
- Direct portal API integration (PropertyGuru/99.co don't offer public APIs — generate portal-ready content for manual posting)
