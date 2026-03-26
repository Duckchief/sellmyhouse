# CLAUDE.md

## Project: SellMyHouse.sg v2
AI-powered HDB resale transaction platform operating under Huttons Asia Pte Ltd.
Fixed fee $1,499 + GST per transaction. TypeScript + Express + Prisma + PostgreSQL.
Deployed via Docker on Hostinger VPS (Singapore).

## Documentation
- `docs/superpowers/specs/2026-03-10-v2-rewrite-design.md` — Master design spec for the v2 rewrite
- `docs/superpowers/plans/` — Implementation plans per phase
- `docs/phase-0-shared-context.md` — Shared business context (read before every phase)
- `docs/phase-{1-6}-*.md` — Phase-specific business requirements

## Build Rules
- Always read the v2 design spec (`docs/superpowers/specs/2026-03-10-v2-rewrite-design.md`) before starting any work
- Always read `docs/phase-0-shared-context.md` before starting any phase — it contains shared business context needed across all phases
- Read the relevant phase doc (e.g., `docs/phase-1-foundation.md`) for business requirements context
- Follow the database schema exactly as specified — do not add or remove fields without asking
- Run tests after building each section: `npm test && npm run test:integration`
- Every feature uses Superpowers workflow: brainstorm → spec → plan → TDD

## Architecture Rules

### Domain Modules
- Code is organized by business domain in `src/domains/`
- Each domain has: types, service, repository, router, validator, tests
- **Services never call Prisma directly** — all DB access goes through the repository layer
- Cross-domain communication: import services, never repositories
- Shared cross-cutting code lives in `src/domains/shared/`

### Typed Errors
- Use error classes from `src/domains/shared/errors.ts` — never throw plain strings
- `NotFoundError`, `ForbiddenError`, `ValidationError`, `ComplianceError`, `UnauthorizedError`, `ConflictError`

### i18n
- Wrap all user-facing strings in Nunjucks `{{ "string" | t }}` filter (English passthrough for now, architecture-ready for future languages)

### HTMX Responses
- Check `req.headers['hx-request']` to determine fragment vs full page response
- HTMX requests get rendered partials; normal requests get full page with layout

### AI Provider
- **AI provider-agnostic:** Never import a specific AI SDK in application code. Always go through `src/domains/shared/ai/ai.facade.ts`. Provider is selected via SystemSetting, not hardcoded.
- **Human-in-the-loop:** No AI-generated content reaches a client without agent review and approval. Status flow: `ai_generated → pending_review → approved → sent`. Cannot skip from `ai_generated` to `sent`.

### Notifications
- **Three-channel:** WhatsApp (primary), email (fallback), in-app (always)
- Check `seller.notificationPreference` before sending
- Marketing requires explicit marketing consent (separate from service consent)

### Files
- Never serve `/uploads/` directly via nginx. Application checks auth before serving any file.

## Compliance Rules (Non-Negotiable)

### PDPA
- **Hard delete** for personal data: Prisma `delete` + `fs.unlink()` for files. Never soft delete personal data.
- **Granular consent:** Service and marketing consent are always separate fields. Marketing consent is never pre-ticked.
- **Consent records are append-only** — immutable once created, new records track changes.
- **Agent anonymisation:** name → "Former Agent [ID]", email → `anonymised-{id}@deleted.local`.

### AML/CFT
- The **5-year AML/CFT retention obligation is fulfilled by Huttons Asia Pte Ltd**, not this platform. Agents download sensitive documents from the platform and submit them to Huttons' case submission system for the legally required 5-year retention.
- Do **NOT** implement 5-year retention on this platform. Do **NOT** store data longer than the periods in the Data Lifecycle section below.
- Transaction records and CDD documents are auto-purged 7 days post-completion regardless of download status. Nothing blocks this purge.

### Audit
- Audit logs are **append-only**. Never delete or modify audit log entries.

### NRIC
- Store only last 4 characters in database. Full NRIC documents encrypted at rest (AES-256). Masked display: SXXXX567A.

### CEA
- All listings must include: agent name, CEA registration number, agency name (Huttons Asia Pte Ltd), agency licence number, agent contact number.

### DNC
- Check Singapore DNC registry before WhatsApp or phone-based outreach.

### Financial
- **Commission is fixed:** Always $1,499 + GST ($1,633.91). Read from SystemSetting at runtime, never hardcoded. Never calculate percentage-based commission.
- **No financial advice.** Estimates only. Every output includes disclaimers.
- **No formal valuations.** Indicative ranges from public data only.
- **OTP is physical.** Platform tracks status and stores scanned copies. Does not generate or modify the OTP.
- **Commission invoice from Huttons.** Platform stores and distributes only.

## Security Rules
- All passwords: bcrypt cost factor 12
- 2FA: mandatory for agents/admin, optional for sellers (TOTP via otplib)
- File uploads: validate type (jpg/jpeg/png/pdf only), max 5MB photos / 10MB documents, sanitize filenames, reject path traversal (`../`)
- Rate limiting: 5 auth attempts/15min, 100 API requests/min, 3 lead submissions/hour, 3 viewing bookings/phone/day
- CDD documents: encrypted at rest (AES-256), agent-only access
- `.env`: never committed to git

## Testing
- `npm test` — unit tests (Jest, co-located with source in domain modules)
- `npm run test:integration` — integration tests (Jest + Supertest, Docker Postgres)
- `npm run test:e2e` — end-to-end tests (Playwright)
- Always mock external APIs (WhatsApp, AI providers) in tests — never call real APIs
- Use factory pattern for test data: `factory.seller()`, `factory.property()`, etc.
- Financial calculations: regression suite with 20+ edge cases

## Key Commands
```bash
npm test                    # Unit tests
npm run test:integration    # Integration tests
npm run test:e2e           # E2E tests
npm run build              # Compile TypeScript + build Tailwind
npm run dev                # Development with hot reload
npm run lint               # ESLint
npm run format             # Prettier
npm run docker:dev         # Start dev database
npm run docker:test:db     # Start test database
npm run db:migrate         # Run migrations (development)
npm run db:migrate:deploy  # Run migrations (production)
```

## Data Lifecycle — Process and Purge

This platform is a **transactional processing tool, NOT a long-term data repository**. Sensitive data is processed during the HDB resale transaction, then downloaded by the agent and submitted to Huttons Asia Pte Ltd's case submission system for 5-year retention.

### Retention Tiers

| Tier | Data | Retention | Action |
|------|------|-----------|--------|
| 1 | NRIC/FIN, CDD docs, OTP scans, invoices | 7 days post-completion | **Auto-delete** (direct, no flag-and-review) |
| 2 | Financial data (offer amounts, agreed price, option fee) | 7 days post-completion | **Auto-redact** to 0/null |
| 3 | Seller PII + transaction metadata | 30 days post-completion | **Auto-anonymise** seller, retain analytics numbers |
| — | Consent records | 1 year post-withdrawal | Flag for review |
| — | Audit logs | 2 years | Append-only, infra-level |
| — | Leads (no transaction) | 12 months inactivity | Flag for review |
| — | Closed listings | 6 months | Flag for review |

### System Settings (retention)
| Key | Default | Description |
|-----|---------|-------------|
| `sensitive_doc_retention_days` | 7 | Tier 1 auto-delete cutoff |
| `financial_data_retention_days` | 7 | Tier 2 auto-redact cutoff |
| `transaction_anonymisation_days` | 30 | Tier 3 auto-anonymise cutoff |
| `lead_retention_months` | 12 | Lead inactivity flag threshold |
| `consent_post_withdrawal_retention_years` | 1 | Post-withdrawal consent retention |
| `listing_retention_months` | 6 | Closed listing retention |

**Removed settings (do not re-add):** `data_retention_years`, `transaction_retention_years`, `cdd_retention_years`

### Data Model Notes
- `Transaction.anonymisedAt` — set when Tier 3 anonymisation runs; guards against double-processing
- `DeletionRequestStatus` values: `flagged | pending_review | approved | executed | rejected` — **no `blocked` status**
- `DeletionTargetType` values: `lead | transaction | cdd_documents | consent_record | nric_data | listing | financial_data | sensitive_documents`
- Consent withdrawal does **not** block deletion — creates a `flagged` request with `post_completion_purge` retention rule

### Dashboard Reminder
- `getPendingDocumentDownloads()` in compliance.service surfaces transactions with un-downloaded docs
- Agent dashboard shows a warning banner with days remaining before auto-delete
- This is a **reminder only**, not a gate — auto-delete runs regardless of download status

## Out of Scope
- Buyer-side workflow (stub only — schema in place, no dashboard)
- Advanced team management (basic admin CRUD, no round-robin/lead routing)
- Multi-language (English only, but i18next wrapper for future)
- Suspicious Transaction Reporting (handled in Huttons' internal system)
- Direct portal API integration (generate portal-ready content for manual posting)
